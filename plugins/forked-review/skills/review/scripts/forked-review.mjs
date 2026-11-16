#!/usr/bin/env node
/**
 * Runner for the review skill. Works on Linux, macOS and Windows (Node built-ins only).
 *
 *   node forked-review.mjs prepare [--base <branch>] [--scope committed|working-tree|both]
 *                                  [--angles a,b] [--hint "<text>"]
 *   node forked-review.mjs baseline <slug>
 *   node forked-review.mjs analyze <slug> [--keep] prints the final consolidated report, then removes the run
 *                                                  directory (--keep: leave it; `cleanup` removes it later)
 *   node forked-review.mjs resume [slug] [--keep]  continue an unfinished run (default: the newest of this worktree)
 *   node forked-review.mjs cleanup <slug>
 *
 * Run it from inside the worktree. `prepare` prints the slug and stores everything else in the private
 * directory <tmpdir>/review-<slug>/ (state.json, reports, logs), so every command can run in its own shell.
 *
 * A PR too big for one baseline (over ~150 KB of diff) is split into parts of whole files (at most REVIEW_MAX_SHARDS,
 * default 4; git.mjs `planShards`). Each part gets its own baseline, every angle runs on every part (at most 6
 * processes at once) except the WHOLE ones, which run once on the whole PR, and the consolidator also checks the
 * contracts across parts.
 *
 * Resume: `resume [slug]` continues the newest unfinished run of this worktree (baseline, then analyze). After a
 * failure (token limit, crash) running the same command again works too. `baseline` redoes only the parts without a
 * session, `analyze` reuses analyze.md and every report already saved, and runs the rest. Only `cleanup` or a
 * successful `analyze` (without --keep) removes the run directory.
 *
 * Flow: baseline session -> `analyze` forks it (review-analyze picks the angles, unless --angles was given)
 * -> this runner forks the baseline once per angle in parallel, then once more to consolidate.
 * Every pass is a headless `claude -p` process. Env: REVIEW_MAX_TURNS (default 25, cold angles 30).
 * Reviewers never write files: each report is the pass's final message, saved by this runner to
 * <tmpdir>/review-<slug>/<angle>.md. Nothing is written into the reviewed repo. Progress goes to
 * <tmpdir>/review-<slug>/progress.log.
 *
 * Files: this one (argument parsing, dispatch), run.mjs (constants, paths, state, helpers), prepare.mjs, baseline.mjs,
 * analyze.mjs, resume.mjs (the commands), pass.mjs (one `claude -p` pass), git.mjs (git helpers, diff files),
 * claude.mjs (headless `claude` runs: permissions, spawning, reading the stream-json output).
 */
import { parseArgs as parseCli } from 'node:util';

import { analyze } from './analyze.mjs';
import { baseline } from './baseline.mjs';
import { prepare } from './prepare.mjs';
import { resume } from './resume.mjs';
import { cleanup, fail, load } from './run.mjs';

/** `command [slug] [--name value]...` -> the command, the options as a Map, the slug. Unknown flags are an error. */
function parseArgs(argv) {
  const { values, positionals } = parseCli({
    args: argv,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      scope: { type: 'string' },
      angles: { type: 'string' },
      hint: { type: 'string' },
      keep: { type: 'boolean' },
    },
  });
  const [command, slug] = positionals;
  return { command, opts: new Map(Object.entries(values)), slug };
}

async function main() {
  const { command, opts, slug } = parseArgs(process.argv.slice(2));
  // The slug becomes a directory name: no path separators, and it cannot start with a dot, so it is never `.` or `..`.
  if (slug && !/^\w[\w.-]*$/.test(slug)) {
    fail(`bad slug "${slug}"`);
  }

  switch (command) {
    case 'prepare':
      return prepare(opts);
    case 'baseline':
      return baseline(load(slug));
    case 'analyze':
      return analyze(load(slug), opts.has('keep'));
    case 'resume':
      return resume(slug, opts.has('keep'));
    case 'cleanup':
      return cleanup(slug);
    default:
      fail(`unknown command: ${command}`);
  }
}

main().catch((e) => fail(String(e instanceof Error ? e.message : e)));
