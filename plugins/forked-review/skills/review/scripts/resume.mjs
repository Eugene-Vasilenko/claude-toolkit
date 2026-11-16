// Command: resume
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { analyze } from './analyze.mjs';
import { baseline } from './baseline.mjs';
import { sh } from './git.mjs';
import { TMP, fail, load, save } from './run.mjs';

/** The newest run directory of this worktree (a run that failed keeps its directory), or undefined. */
function findRun(worktree) {
  let best;
  for (const d of readdirSync(TMP)) {
    if (!d.startsWith('review-')) continue;
    try {
      const s = JSON.parse(readFileSync(join(TMP, d, 'state.json'), 'utf8'));
      const time = statSync(join(TMP, d)).mtimeMs;
      if (s.worktree === worktree && (!best || time > best.time)) best = { slug: s.slug, time };
    } catch {
      // not a run of ours, or not readable (another user's, 0700): skip
    }
  }
  return best?.slug;
}

/** Continues an unfinished run: the baseline parts that are missing, then analyze (which reuses the finished reports). */
export async function resume(slug, keep) {
  const worktree = sh('git', ['rev-parse', '--show-toplevel'], process.cwd());
  slug ??= findRun(worktree);
  if (!slug) {
    fail('no unfinished run of this worktree to resume: start one with /forked-review:review');
  }
  const s = load(slug);
  console.error(`Resuming ${slug}${s.limit ? ` (it stopped on: ${s.limit})` : ''}`);
  delete s.limit;
  save(s);
  await baseline(s);
  await analyze(s, keep);
}
