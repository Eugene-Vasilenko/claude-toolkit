// Command: analyze (angles in parallel, then consolidation)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { checkHead } from './baseline.mjs';
import { limitHit, partArg, pathArg, runPass, stagePrompt, specArg } from './pass.mjs';
import {
  ANGLES, COLD, LIMIT, TURNS, WHOLE, allFilesPath, analyzePath, checkAngles, cleanup, diffPath, fail, failResumable,
  filesPath, finalPath, fmt, hintPath, partsPath, pool, reportPath, reportsPath, tmp,
} from './run.mjs';

const passLine = (name, r, file) =>
  `${name} ${r.status} ${existsSync(file) ? 'file' : 'nofile'} cost=${fmt(r.cost)} turns=${r.turns ?? '-'} cache=${r.cache ?? '-'}% | ${r.coverage}${r.reason ? ` | ${r.reason}` : ''}`;

/** One file for the consolidator: a failed pass is named, so it is reported as failed, not as clean. */
function writeReportsFile(s, names, results) {
  writeFileSync(
    reportsPath(s.slug),
    names
      .map((n, i) =>
        existsSync(reportPath(s.slug, n))
          ? `===== ${n} (${results[i].status})\n${readFileSync(reportPath(s.slug, n), 'utf8')}`
          : `===== ${n} FAILED: no report`,
      )
      .join('\n\n'),
  );
}

/** A report saved by an earlier run of this slug (a partial one too): a resumed run does not redo it. */
const reusable = (out) => existsSync(out) && readFileSync(out, 'utf8').trim() !== '';

/**
 * Runs every angle on every part (a pool; a WHOLE angle once on the whole PR), then the consolidation pass.
 * A pass whose report is already saved is not run again. Writes final.md or fails (resumable).
 */
async function pipeline(s, angles, extraCost) {
  const multi = s.shards.length > 1;
  const jobs = angles.flatMap((a) =>
    multi && WHOLE.has(a)
      ? [{ a, part: 0, name: a, whole: true }]
      : s.shards.map((_, part) => ({ a, part, name: multi ? `${a}-${part + 1}` : a })),
  );
  const results = await pool(jobs, LIMIT, ({ a, part, name, whole }) => {
    const out = reportPath(s.slug, name);
    if (reusable(out)) {
      return { status: existsSync(`${out}.partial`) ? 'partial' : 'reused', cost: 0, coverage: 'report from an earlier run' };
    }
    // A cold angle has no baseline: it gets the diff and file table of its part (only the table of the whole PR, for a WHOLE one).
    const cold = COLD.has(a);
    const files = whole ? allFilesPath(s.slug) : filesPath(s.slug, part);
    return runPass(
      s,
      name,
      stagePrompt(
        s,
        a,
        !whole && partArg(s, part),
        cold && specArg(s),
        cold && !whole && pathArg('diff', diffPath(s.slug, part)),
        cold && pathArg('files', files),
      ),
      {
        cold,
        maxTurns: cold ? TURNS.coldAngle : TURNS.angle,
        out,
        part,
        whole,
      },
    );
  });
  writeReportsFile(s, jobs.map((j) => j.name), results);
  const lines = () => jobs.map((j, i) => passLine(j.name, results[i], reportPath(s.slug, j.name))).join('\n');
  if (limitHit()) {
    // The account limit: a consolidation of what is left would be a thin report, and it would hit the limit too.
    console.error(lines());
    failResumable(s, `Stopped: ${limitHit()}`);
  }
  if (!jobs.some((j) => existsSync(reportPath(s.slug, j.name)))) {
    // Nothing to consolidate: do not pay for an empty consolidation.
    console.error(lines());
    failResumable(s, 'Every angle pass failed: see the lines above and the .err files');
  }
  // Not reused: it reads reports.md, which may have changed.
  const consolidate = await runPass(
    s,
    'consolidate',
    stagePrompt(s, 'consolidate', pathArg('reports', reportsPath(s.slug)), specArg(s), multi && pathArg('parts', partsPath(s.slug))),
    { maxTurns: TURNS.consolidate, out: finalPath(s.slug) },
  );

  if (consolidate.status === 'partial' && existsSync(finalPath(s.slug))) {
    const f = finalPath(s.slug);
    writeFileSync(f, `> Warning: the consolidation hit its turn limit, so findings may be unverified or unfiltered.\n\n${readFileSync(f, 'utf8')}`);
  }

  const baselines = s.shards.reduce((n, p) => n + p.cost, 0);
  const total = baselines + extraCost + consolidate.cost + results.reduce((n, r) => n + r.cost, 0);
  console.error(
    [
      lines(),
      passLine('consolidate', consolidate, finalPath(s.slug)),
      `total cost (all baselines + the passes of this run, client-side estimate): ${fmt(total)}`,
    ].join('\n'),
  );
  if (!existsSync(finalPath(s.slug))) {
    failResumable(s, `No final report${consolidate.reason ? `: ${consolidate.reason}` : ''}, see ${tmp(s.slug, 'consolidate.err')}`);
  }
}

/**
 * Forks the baseline into the analyze pass (it only names the angles), runs the pipeline, prints the final report and
 * removes the run directory (`keep`: leave it for follow-up questions; a failed run always leaves it, for its logs).
 */
export async function analyze(s, keep) {
  if (!s.shards.every((p) => p.session)) {
    fail('run baseline first');
  }
  checkHead(s);
  let angles = s.angles;
  let cost = 0;
  // With --angles the user named them: no analyze fork. A resumed run reuses the angles of the earlier one.
  if (angles.length === 0) {
    const out = analyzePath(s.slug);
    const named = (text) => [...new Set(/^ANGLES:\s*(.+)$/m.exec(text)?.[1].split(/[\s,]+/).filter(Boolean) ?? [])];
    // Reused only when every angle in it is known: a bad saved answer would fail every resume the same way.
    const saved = existsSync(out) ? named(readFileSync(out, 'utf8')) : [];
    let status = 'reused';
    if (!(saved.length && saved.every((a) => ANGLES.includes(a)))) {
      const a = await runPass(
        s,
        'analyze',
        stagePrompt(
          s,
          'analyze',
          s.hasHint && pathArg('hint', hintPath(s.slug)),
          s.shards.length > 1 && pathArg('all', allFilesPath(s.slug)),
        ),
        { maxTurns: TURNS.analyze, out },
      );
      cost = a.cost;
      status = a.status;
      if (limitHit()) {
        failResumable(s, `Stopped: ${limitHit()}`);
      }
    }
    const text = existsSync(out) ? readFileSync(out, 'utf8') : '';
    angles = named(text);
    checkAngles(angles);
    if (angles.length === 0) {
      fail(`analyze (${status}) named no angles: see ${tmp(s.slug, 'analyze.err')} and ${tmp(s.slug, 'analyze.jsonl')}`);
    }
    console.log(text.trim().replace(/^ANGLES:/m, 'Angles:') + '\n');
  }
  await pipeline(s, angles, cost);
  console.log(readFileSync(finalPath(s.slug), 'utf8'));
  if (!keep) {
    cleanup(s.slug);
  }
}
