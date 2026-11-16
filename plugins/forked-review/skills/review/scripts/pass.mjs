// One headless `claude -p` pass (a fork of the baseline, or a cold start), and the prompts that start it.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { coverage, denialsNote, exec, finalResult, fmtCoverage, permArgs as claudePermArgs } from './claude.mjs';
import { readDiffIndex } from './git.mjs';
import { PLUGIN_ROOT, TURNS, diffPath, filesPath, log, save, slugDir, specPath, tmp } from './run.mjs';

// A pass that hits --max-turns returns no report. Its own session still holds everything it read,
// so one short extra pass turns that work into a (partial) report instead of losing it.
const WRAP_UP =
  'Turn limit reached. Call no more tools. Write your final report now, in the required output format, ' +
  'from what you have already read. Add a line "Not reviewed:" naming the files or areas you did not get to.';

// Set once a pass reports the account limit: nothing more is started, the run stops and can be resumed.
let limitMsg = '';
export const limitHit = () => limitMsg;
const LIMIT_RE = /hit your .*limit|usage limit|rate.?limit/i;

/** Remembers the limit message (also in state.json, for `resume`). Call it with the text of an error result only. */
export function noteLimit(s, text) {
  if (!limitMsg && LIMIT_RE.test(text)) {
    limitMsg = text.trim().split('\n')[0].slice(0, 200);
    s.limit = limitMsg;
    save(s);
  }
}

// Slash-command arguments split on spaces: quote a path that has any (Windows user names).
export const pathArg = (name, p) => (/\s/.test(p) ? `${name}="${p}"` : `${name}=${p}`);
/** `spec=<path>` when the run has a spec, else false (so it drops out of `stagePrompt`). */
export const specArg = (s) => s.hasSpec && pathArg('spec', specPath(s.slug));

const contract = readFileSync(join(PLUGIN_ROOT, 'references', 'review-output.md'), 'utf8');

/**
 * The prompt of a review stage: `prompts/<stage>.md`, the output contract, and the arguments (`base=... scope=... <extra>`).
 * Everything the pass needs is in the prompt, so no plugin has to be loaded in the child and no Read is spent on the contract.
 */
export const stagePrompt = (s, stage, ...args) =>
  [
    readFileSync(join(PLUGIN_ROOT, 'skills', 'review', 'prompts', `${stage}.md`), 'utf8'),
    contract,
    `# Arguments\n\n${[`base=${s.base}`, `scope=${s.scope}`, ...args.filter(Boolean)].join('\n')}`,
  ].join('\n\n---\n\n');

/** `part=<i>/<n>` for part `i` (0-based) of a split PR, else false (so it drops out of `stagePrompt`). */
export const partArg = (s, i) => s.shards.length > 1 && `part=${i + 1}/${s.shards.length}`;

const permArgs = (slug) => claudePermArgs(slugDir(slug));

/** One headless `claude -p` run. `resume` is `[]` for a cold start or the `--resume ...` flags. */
export const runClaude = (s, promptText, { resume = [], maxTurns, onLine }) =>
  exec(
    'claude',
    [
      '-p',
      promptText,
      ...resume,
      ...permArgs(s.slug),
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      maxTurns,
    ],
    s.worktree,
    onLine,
  );

/** What a pass looked at (see `coverage`), as the data and as one line. */
export function passCoverage(s, stdout, denied, inherited = [], part = 0) {
  // part null: a pass over the whole PR, which has no diff file of its own (no N/M figure).
  const index = part === null ? [] : readDiffIndex(filesPath(s.slug, part));
  const c = coverage(stdout, { file: part === null ? undefined : diffPath(s.slug, part), index, repo: s.worktree });
  return { data: c, text: fmtCoverage(c, denied, index.length, inherited) };
}


/** Mirrors a pass's assistant text and tool calls into progress.log. */
function progress(slug, name, line) {
  try {
    const event = JSON.parse(line);
    if (event.type !== 'assistant') {
      return;
    }
    for (const c of event.message.content) {
      if (c.type === 'text') {
        log(slug, `[${name}] ${c.text}`);
      } else if (c.type === 'tool_use') {
        const i = c.input ?? {};
        const target = String(i.file_path ?? i.command ?? i.pattern ?? i.path ?? '');
        log(slug, `[${name}] ▸ ${c.name} ${target.slice(0, 140)}`);
      }
    }
  } catch {
    // not a JSON line
  }
}

/**
 * Runs one pass and saves its final message to `out`.
 * Returns the status (done|partial|error), the cost of this pass alone and a one-line coverage summary.
 */
export async function runPass(s, name, promptText, { cold = false, maxTurns, out, part = 0, whole = false }) {
  if (limitHit()) {
    return { status: 'skipped', cost: 0, coverage: `not started: ${limitHit()}`, reason: '' };
  }
  rmSync(out, { force: true });
  rmSync(`${out}.partial`, { force: true });
  const base = s.shards[part];
  const res = await runClaude(s, promptText, {
    resume: cold ? [] : ['--resume', base.session, '--fork-session'],
    maxTurns,
    onLine: (line) => progress(s.slug, name, line),
  });
  const result = finalResult(res.stdout);
  let stdout = res.stdout;
  let stderr = res.stderr;
  let status = res.code === 0 ? 'done' : 'error';
  let cost = result.cost;

  if (result.ok && result.text.trim()) {
    writeFileSync(out, result.text);
  } else if (result.subtype === 'error_max_turns' && result.session) {
    log(s.slug, `[${name}] turn limit reached, asking for a partial report`);
    const wrap = await runClaude(s, WRAP_UP, { resume: ['--resume', result.session], maxTurns: TURNS.wrapUp });
    stdout += wrap.stdout;
    stderr += wrap.stderr;
    const w = finalResult(wrap.stdout);
    if (w.ok && w.text.trim()) {
      writeFileSync(out, w.text);
      status = 'partial';
      writeFileSync(`${out}.partial`, ''); // a resumed run must not show this report as complete
      cost = w.cost;
      }
  }

  // An error result with exit code 0 (a rate limit) still leaves no report.
  if (status === 'done' && !existsSync(out)) {
    status = 'error';
  }
  writeFileSync(tmp(s.slug, `${name}.jsonl`), stdout);
  // Why it failed (a limit, an API error): the text of the error result, not only in the .jsonl.
  const reason = result.isError ? result.text.trim().split('\n')[0].slice(0, 200) : '';
  if (reason) {
    noteLimit(s, reason);
  }
  writeFileSync(tmp(s.slug, `${name}.err`), stderr + denialsNote(result.denials) + (reason ? `\n[error] ${result.text}\n` : ''));
  return {
    reason,
    status,
    turns: result.turns,
    cache: result.cache,
    // A resumed run reports the whole conversation total, baseline included: subtract it for forks.
    // Older CLIs report only the fork's own total: then there is nothing to subtract.
    cost: cold || cost < base.cost ? cost : cost - base.cost,
    coverage: passCoverage(s, res.stdout, result.denials.length, cold ? [] : base.covered, whole ? null : part).text,
  };
}

