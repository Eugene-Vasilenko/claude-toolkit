/**
 * Git helpers for the review runner: running commands, picking the base branch, and writing the diff files the
 * baseline reads.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** Runs a command and returns its trimmed stdout; throws if it fails. */
export function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Which diff, which base
// ---------------------------------------------------------------------------------------------------------------

/**
 * `git diff` arguments for the review scope, as defined in references/review-output.md. `both` is the working
 * tree against the merge-base: comparing it with the tip of the base would show the base's newer commits as
 * reverted changes.
 */
function diffArgs(worktree, base, scope) {
  if (scope === 'working-tree') return ['HEAD'];
  if (scope === 'both') return [sh('git', ['merge-base', `origin/${base}`, 'HEAD'], worktree)];
  return [`origin/${base}...HEAD`];
}

export function changedFileCount(worktree, base, scope) {
  return sh('git', ['diff', '--name-only', ...diffArgs(worktree, base, scope)], worktree).split('\n').filter(Boolean).length;
}

// No PR and no --base: the parent is the remote branch with the fewest commits behind HEAD.
export function nearestParent(worktree, branch) {
  const refs = sh('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], worktree)
    .split('\n')
    .filter((r) => r && r !== 'origin' && r !== 'origin/HEAD' && r !== `origin/${branch}`)
    .map((r) => ({
      name: r.slice('origin/'.length),
      ahead: Number(sh('git', ['rev-list', '--count', `${r}..HEAD`], worktree)),
    }))
    .filter((r) => r.ahead > 0)
    .sort((a, b) => a.ahead - b.ahead);
  if (!refs.length) {
    throw new Error('no PR and no parent branch found: pass --base <branch>');
  }
  if (refs[1]?.ahead === refs[0].ahead) {
    throw new Error(
      `ambiguous parent (${refs[0].name}, ${refs[1].name}, ${refs[0].ahead} commits each): pass --base <branch>`,
    );
  }
  console.log(`base=${refs[0].name} (auto: nearest parent, ${refs[0].ahead} commits)`);
  return refs[0].name;
}

// ---------------------------------------------------------------------------------------------------------------
// The diff as files for the baseline
//
// A Bash result over ~30 KB reaches the model only as a short preview, so a big diff cannot be read with
// `git diff` in the baseline. The runner writes it to files the baseline reads with Read instead:
// - diff.patch: the per-file blocks, heaviest first, so the part worth reading is one contiguous prefix;
// - files.tsv: every file with its place in diff.patch, and which lines to read.
// ---------------------------------------------------------------------------------------------------------------

// The baseline reads at most this much of the diff; a bigger diff is read heaviest files first.
const DIFF_BUDGET_BYTES = 150_000;
// Generated lockfiles are huge and say nothing a reviewer can check: they stay in the table but are not read.
const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/;
// One Read call returns at most 25,000 tokens (~2.5 bytes per token in dense code), so a Read range stays well below.
const READ_CHUNK_BYTES = 45_000;

/** The diff split into one block per file, heaviest (most changed lines) first. `only`: a Set of paths to keep. */
function diffBlocks(worktree, base, scope, only) {
  const text = execFileSync(
    'git',
    ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', ...diffArgs(worktree, base, scope)],
    { cwd: worktree, encoding: 'utf8', maxBuffer: 1 << 30 },
  );
  return text
    .split(/^(?=diff --git )/m)
    .filter((b) => b.startsWith('diff --git '))
    .map((b) => {
      const lines = b.replace(/\n$/, '').split('\n');
      const firstHunk = lines.findIndex((l) => l.startsWith('@@'));
      return {
        path: /^diff --git a\/.* b\/(.*)$/.exec(lines[0])?.[1] ?? lines[0],
        text: lines.join('\n') + '\n',
        lines: lines.length,
        bytes: Buffer.byteLength(b),
        lock: LOCKFILE.test(/^diff --git a\/.* b\/(.*)$/.exec(lines[0])?.[1] ?? ''),
        // Lines before the first hunk are the file header (--- / +++), not changes; a file with no hunk has none.
        changed: firstHunk < 0 ? 0 : lines.slice(firstHunk).filter((l) => /^[+-]/.test(l)).length,
      };
    })
    .filter((b) => !only || only.has(b.path))
    .sort((a, b) => Number(a.lock) - Number(b.lock) || b.changed - a.changed);
}

/**
 * Splits a diff too big for one baseline into parts of at most DIFF_BUDGET_BYTES, each a list of paths. Files are
 * ordered by path so a directory stays in one part. More than `maxParts` parts: the part size grows until it fits
 * (`grown`: a part may then be more than a baseline reads in full). A small diff is one part.
 */
export function planShards(worktree, base, scope, maxParts) {
  const blocks = diffBlocks(worktree, base, scope).sort((a, b) => (a.path < b.path ? -1 : 1));
  for (let limit = DIFF_BUDGET_BYTES; ; limit = Math.ceil(limit * 1.3)) {
    const parts = [];
    let bytes = 0;
    for (const b of blocks) {
      if (!parts.length || (!b.lock && bytes + b.bytes > limit)) {
        parts.push([]);
        bytes = 0;
      }
      parts.at(-1).push(b.path);
      if (!b.lock) bytes += b.bytes; // a lockfile is not read, so it does not fill a part
    }
    if (parts.length <= maxParts) return { parts, grown: limit > DIFF_BUDGET_BYTES };
  }
}

/**
 * Line ranges `[first, last]` (1-based) of the first `blocks`, each small enough for one Read call. A range ends at
 * a file boundary where it can; a single file bigger than a range is cut by lines.
 */
function chunkRanges(blocks, limitBytes) {
  const ranges = [];
  let start = 1;
  let bytes = 0;
  let line = 1; // the next line to place
  const close = () => {
    if (line > start) ranges.push([start, line - 1]);
    start = line;
    bytes = 0;
  };
  for (const b of blocks) {
    if (bytes > 0 && bytes + b.bytes > limitBytes) close();
    if (b.bytes <= limitBytes) {
      line += b.lines;
      bytes += b.bytes;
      continue;
    }
    for (const text of b.text.split('\n').slice(0, -1)) {
      const n = Buffer.byteLength(text) + 1;
      if (bytes > 0 && bytes + n > limitBytes) close();
      line++;
      bytes += n;
    }
  }
  close();
  return ranges;
}

/**
 * One row per file (path, changed lines, first line in diff.patch, line count, cumulative % of changes) and how
 * much of diff.patch to read (as Read ranges): all of it when it fits the budget, otherwise the heaviest files until
 * the budget (the first file is always read; lockfiles never).
 */
function readingPlan(blocks) {
  const totalChanged = blocks.reduce((n, b) => n + b.changed, 0) || 1;
  const totalBytes = blocks.reduce((n, b) => n + b.bytes, 0);
  const rows = [];
  let nextLine = 1;
  let changed = 0;
  let bytes = 0;
  let readFiles = 0;
  for (const b of blocks) {
    const firstLine = nextLine;
    nextLine += b.lines;
    changed += b.changed;
    bytes += b.bytes;
    rows.push(`${b.path}\t${b.changed}\t${firstLine}\t${b.lines}\t${Math.round((100 * changed) / totalChanged)}`);
    if (!b.lock && (totalBytes <= DIFF_BUDGET_BYTES || readFiles === 0 || bytes <= DIFF_BUDGET_BYTES)) {
      readFiles++;
    }
  }
  return {
    rows,
    readFiles,
    readRanges: chunkRanges(blocks.slice(0, readFiles), READ_CHUNK_BYTES),
    totalChanged,
    totalBytes,
    totalLines: nextLine - 1,
  };
}

/** `paths`: write only these files (one part of a big diff); a rename whose old path is in another part reads as an add. */
export function writeDiffFiles(diffFile, filesFile, worktree, base, scope, paths) {
  const blocks = diffBlocks(worktree, base, scope, paths && new Set(paths));
  writeFileSync(diffFile, blocks.map((b) => b.text).join(''));
  const plan = readingPlan(blocks);
  writeFileSync(
    filesFile,
    [
      `# ${blocks.length} files, ${plan.totalChanged} changed lines, diff.patch is ${Math.round(plan.totalBytes / 1000)} KB, ${plan.totalLines} lines.`,
      `# READ (${plan.readFiles} of ${blocks.length} files, heaviest first), one Read call per range, in order: ${plan.readRanges.map(([from, to]) => `offset=${from} limit=${to - from + 1}`).join('; ') || 'nothing'}. The rest: skim by name here, open on demand.`,
      '# path\tchanged lines\tfirst line in diff.patch\tline count\tcumulative % of changed lines',
      ...plan.rows,
    ].join('\n') + '\n',
  );
}

/** files.tsv as `{ path, first, last }` per changed file: where its block lies in diff.patch (1-based lines). */
export function readDiffIndex(filesFile) {
  return readFileSync(filesFile, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [path, , first, count] = l.split('\t');
      return { path, first: Number(first), last: Number(first) + Number(count) - 1 };
    });
}
