// Command: prepare
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { changedFileCount, nearestParent, planShards, sh, writeDiffFiles } from './git.mjs';
import { MAX_PARTS, SCOPES, allFilesPath, checkAngles, diffPath, fail, filesPath, hintPath, save, slugDir, specPath } from './run.mjs';

/** The PR of the current branch (number, base, file count), or undefined when there is none or no `gh`. */
function findPr(worktree) {
  try {
    return JSON.parse(sh('gh', ['pr', 'view', '--json', 'number,baseRefName,changedFiles'], worktree));
  } catch {
    return undefined;
  }
}

/** The base branch: the PR's, else --base, else the nearest parent branch. */
function resolveBase(opts, pr, worktree, branch) {
  if (pr && opts.has('base') && opts.get('base') !== pr.baseRefName) {
    fail(`--base ${opts.get('base')} contradicts the PR base ${pr.baseRefName}: drop --base`);
  }
  return pr?.baseRefName ?? opts.get('base') ?? nearestParent(worktree, branch);
}

/** Spec = PR text + linked issue (the PR's closing reference only). Empty when there is no PR. */
function buildSpec(worktree) {
  const gh = (...args) => JSON.parse(sh('gh', args, worktree));
  const parts = [];
  try {
    const p = gh('pr', 'view', '--json', 'number,url,title,body');
    parts.push(`# PR #${p.number}: ${p.title}\nSource: ${p.url}\n${p.body}`);
  } catch {
    // no PR
  }
  let issue;
  try {
    // The URL, not the number: the issue may live in another repository.
    issue = String(gh('pr', 'view', '--json', 'closingIssuesReferences').closingIssuesReferences?.[0]?.url ?? '');
  } catch {
    // no PR
  }
  if (issue) {
    try {
      const i = gh('issue', 'view', issue, '--json', 'number,url,title,body');
      parts.push(`# Issue #${i.number}: ${i.title}\nSource: ${i.url}\n${i.body}`);
    } catch {
      // issue not readable
    }
  }
  return parts.join('\n\n');
}

export function prepare(opts) {
  const worktree = sh('git', ['rev-parse', '--show-toplevel'], process.cwd());
  const pr = findPr(worktree);
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], worktree);
  // A random suffix: two runs on the same branch (or same-named branches of different repos) never share a directory.
  // A slug must start with a word character (a leading '-' would read as a flag): a branch named in non-ASCII
  // letters loses them all, hence the fallback.
  const name = pr ? `pr${pr.number}` : branch.replace(/[^\w.-]/g, '-').replace(/^[-.]+/, '') || 'branch';
  const slug = `${name}-${randomBytes(3).toString('hex')}`;
  const base = resolveBase(opts, pr, worktree, branch);

  if (pr) {
    // A stale or unpushed local branch would be reviewed silently otherwise.
    const local = changedFileCount(worktree, base, 'committed');
    if (local !== pr.changedFiles) {
      fail(
        `local diff has ${local} files, the PR has ${pr.changedFiles}: fetch, pull or push so the branch matches the PR`,
      );
    }
  }

  const scope = opts.get('scope') ?? 'committed';
  if (!SCOPES.includes(scope)) {
    fail(`unknown scope "${scope}": use committed, working-tree or both`);
  }
  const angles = [...new Set((opts.get('angles') ?? '').split(',').filter(Boolean))];
  checkAngles(angles);
  const changedFiles = changedFileCount(worktree, base, scope);
  if (changedFiles === 0) {
    fail(`nothing to review: scope "${scope}" has no changes`);
  }
  const { parts, grown } = planShards(worktree, base, scope, MAX_PARTS);
  if (grown) {
    console.error(
      `warning: the diff needs more than ${MAX_PARTS} parts of the usual size, so parts are bigger than a baseline reads in full: ` +
        'it reads the heaviest files first and names the rest as unread. Raise REVIEW_MAX_SHARDS to cover more.',
    );
  }

  mkdirSync(slugDir(slug), { mode: 0o700 });
  // From here a failure removes the directory: cleanup needs state.json, which is written last.
  try {
    if (opts.get('hint')) {
      writeFileSync(hintPath(slug), opts.get('hint'));
    }
    const spec = buildSpec(worktree);
    if (spec) {
      writeFileSync(specPath(slug), spec);
    }
    parts.forEach((paths, i) =>
      writeDiffFiles(diffPath(slug, i), filesPath(slug, i), worktree, base, scope, parts.length > 1 ? paths : undefined),
    );
    if (parts.length > 1) {
      writeFileSync(allFilesPath(slug), parts.flatMap((paths, i) => paths.map((p) => `${p}\tpart ${i + 1}`)).join('\n') + '\n');
    }

    save({
      slug,
      worktree,
      base,
      scope,
      hasSpec: Boolean(spec),
      hasHint: Boolean(opts.get('hint')),
      head: sh('git', ['rev-parse', 'HEAD'], worktree),
      angles,
      shards: parts.map(() => ({})), // session, cost, covered files: filled by `baseline`
    });
    console.log(
      `slug=${slug} base=${base} scope=${scope} spec=${spec ? 'yes' : 'no'} parts=${parts.length} angles=${angles.join(',') || 'auto'}`,
    );
  } catch (e) {
    rmSync(slugDir(slug), { recursive: true, force: true });
    throw e;
  }
}
