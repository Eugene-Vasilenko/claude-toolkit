// Command: baseline
import { writeFileSync } from 'node:fs';

import { denialsNote, finalResult } from './claude.mjs';
import { sh } from './git.mjs';
import { limitHit, noteLimit, partArg, passCoverage, pathArg, runClaude, stagePrompt, specArg } from './pass.mjs';
import { LIMIT, TURNS, diffPath, failResumable, fail, filesPath, fmt, partsPath, pool, save, tmp } from './run.mjs';

/** A resumed run must see the code `prepare` saw: the saved sessions, reports and diff files are of that commit. */
export function checkHead(s) {
  if (sh('git', ['rev-parse', 'HEAD'], s.worktree) !== s.head) {
    fail('HEAD moved since prepare: run prepare again');
  }
}

/** One baseline session for part `i`. Never fails the process: the others are still running (and costing money). */
async function baselinePart(s, i) {
  if (limitHit()) {
    return { error: `baseline ${i + 1} not started: ${limitHit()}` };
  }
  const res = await runClaude(
    s,
    stagePrompt(
      s,
      'baseline',
      specArg(s),
      partArg(s, i),
      pathArg('diff', diffPath(s.slug, i)),
      pathArg('files', filesPath(s.slug, i)),
    ),
    { maxTurns: TURNS.baseline },
  );
  const last = finalResult(res.stdout);
  const errLog = tmp(s.slug, `baseline-${i}.err`);
  writeFileSync(errLog, res.stderr + denialsNote(last.denials));

  if (last.isError) {
    noteLimit(s, last.text);
  }
  if (!last.session || last.isError) {
    return { error: `baseline ${i + 1} failed${last.text ? `: ${last.text.slice(0, 300)}` : ''}, see ${errLog}` };
  }
  // A baseline cut off by the turn limit has not read the whole diff: forks would inherit a partial context.
  if (last.subtype === 'error_max_turns') {
    return { error: `baseline ${i + 1} hit --max-turns before reading its diff: raise REVIEW_BASELINE_TURNS or REVIEW_MAX_SHARDS` };
  }
  const cov = passCoverage(s, res.stdout, last.denials.length, [], i);
  return { shard: { session: last.session, cost: last.cost, covered: cov.data.diffFiles }, text: last.text, cov: `${cov.text} | turns=${last.turns}`, };
}

export async function baseline(s) {
  checkHead(s);
  const n = s.shards.length;
  // Resume: a part that already has a session is kept.
  const todo = s.shards.map((_, i) => i).filter((i) => !s.shards[i].session);
  const results = await pool(todo, LIMIT, async (i) => {
    let r;
    try {
      r = await baselinePart(s, i);
    } catch (e) {
      r = { error: `baseline ${i + 1} crashed: ${e instanceof Error ? e.message : e}` };
    }
    if (!r.error) {
      // Saved as soon as it is done, not after the others: if this process dies, the paid parts survive.
      s.shards[i] = { ...r.shard, text: r.text }; // the forks inherit what the baseline read
      save(s);
      console.log(`part ${i + 1}/${n} session=${r.shard.session} cost=${fmt(r.shard.cost)} coverage: ${r.cov}`);
    }
    return r;
  });
  const errors = results.filter((r) => r.error).map((r) => r.error);
  if (errors.length) {
    failResumable(s, `${errors.join('\n')}\nThe finished parts are kept.`);
  }
  if (todo.length < n) {
    console.log(`${n - todo.length} of ${n} parts were already done`);
  }
  if (n > 1) {
    // Each part's summary and Interfaces: the consolidator checks the contracts that cross parts.
    writeFileSync(partsPath(s.slug), s.shards.map((p, i) => `===== part ${i + 1}/${n}\n${p.text}`).join('\n\n'));
  }
}
