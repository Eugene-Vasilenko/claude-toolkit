// Shared by every command: constants, the paths of one run, state.json, small helpers.
import { appendFileSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------

export const PLUGIN = 'forked-review';
export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const ANGLES = ['architecture', 'correctness', 'hygiene', 'reuse', 'rootcause', 'security', 'simplicity'];
// Cold angles must form their verdict before seeing the diff, so they never fork the baseline session.
export const COLD = new Set(['rootcause', 'simplicity']);

export const SCOPES = ['committed', 'working-tree', 'both'];

// --max-turns per kind of pass.
export const TURNS = { baseline: '25', angle: '25', coldAngle: '30', analyze: '15', consolidate: '40', wrapUp: '3' };

// ---------------------------------------------------------------------------------------------------------------
// Paths: everything of one run lives in <tmpdir>/review-<slug>/
// ---------------------------------------------------------------------------------------------------------------

// The real path: macOS tmpdir is behind the /var -> /private/var symlink, Windows may return an 8.3 short
// name; permission rules and `--add-dir` match real paths.
export const TMP = realpathSync.native(tmpdir());
// One private directory per slug: reviewers get `--add-dir` for it only, not for the whole tmpdir.
export const slugDir = (slug) => join(TMP, `review-${slug}`);
export const tmp = (slug, name) => join(slugDir(slug), name);

export const statePath = (slug) => tmp(slug, 'state.json');
export const specPath = (slug) => tmp(slug, 'spec.md');
export const hintPath = (slug) => tmp(slug, 'hint.md');
// Part i of a big PR has its own diff and file table; a small PR is one part.
export const diffPath = (slug, i) => tmp(slug, `diff-${i}.patch`);
export const filesPath = (slug, i) => tmp(slug, `files-${i}.tsv`);
export const allFilesPath = (slug) => tmp(slug, 'files-all.tsv');
export const partsPath = (slug) => tmp(slug, 'parts.md');
export const reportPath = (slug, angle) => tmp(slug, `${angle}.md`);
export const reportsPath = (slug) => tmp(slug, 'reports.md');
export const finalPath = (slug) => tmp(slug, 'final.md');
export const analyzePath = (slug) => tmp(slug, 'analyze.md');

// Parts of a big PR: each gets its own baseline; angle passes run per part, at most LIMIT processes at once.
// At least 1: a value like 0.5 or -1 would make planShards grow its limit forever.
export const MAX_PARTS = Math.max(1, Math.floor(Number(process.env.REVIEW_MAX_SHARDS) || 4));
export const LIMIT = 6;
// Cold angles whose question concerns the whole change ("is this mechanism needed at all?"): one pass for the whole PR.
export const WHOLE = new Set(['simplicity']);

/** Runs `fn` over `items`, at most `limit` at a time; results keep the order of `items`. */
export async function pool(items, limit, fn) {
  const out = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const log = (slug, line) => appendFileSync(tmp(slug, 'progress.log'), `${line}\n`);

export const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'forked-review.mjs');

/** `fail` plus how to continue: the run directory stays and `resume` picks up what is not done. */
export function failResumable(s, message) {
  fail(`${message}\nTo continue where it stopped: /forked-review:review resume   (or: node ${SCRIPT} resume ${s.slug})`);
}

export function fail(message) {
  console.error(message);
  process.exit(1);
}

export const fmt = (n) => `$${n.toFixed(2)}`;

export function checkAngles(angles) {
  const bad = angles.filter((a) => !ANGLES.includes(a));
  if (bad.length) {
    fail(`unknown angle(s) ${bad.join(', ')}: use ${ANGLES.join(', ')}`);
  }
  // ANGLES is written by hand: catch an angle that has no skill before any process starts.
  const missing = angles.filter((a) => !existsSync(join(PLUGIN_ROOT, 'skills', `review-${a}`, 'SKILL.md')));
  if (missing.length) {
    fail(`no skills/review-<angle>/SKILL.md for: ${missing.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// State: state.json is how the commands of one run, each in its own shell, share what `prepare` found
// ---------------------------------------------------------------------------------------------------------------

export function load(slug) {
  if (!slug || !existsSync(statePath(slug))) {
    fail(`no state for "${slug}": run prepare first`);
  }
  return JSON.parse(readFileSync(statePath(slug), 'utf8'));
}

export const save = (s) => writeFileSync(statePath(s.slug), JSON.stringify(s));

/** Removes the whole private directory of this slug (state, reports, logs, spec). */
export function cleanup(slug) {
  load(slug); // refuses a slug with no state, so it cannot delete an arbitrary path
  rmSync(slugDir(slug), { recursive: true, force: true });
}
