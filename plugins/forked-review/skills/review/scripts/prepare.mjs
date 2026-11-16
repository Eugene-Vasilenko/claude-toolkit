// Command: prepare
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { changedFileCount, nearestParent, planShards, sh, untrackedFiles, writeDiffFiles } from './git.mjs';
import { MAX_PARTS, SCOPES, allFilesPath, checkAngles, diffPath, fail, filesPath, hintPath, save, slugDir, specPath } from './run.mjs';

/**
 * The PR of the current branch with everything `prepare` needs, from one `gh` call. Undefined when there is no PR or
 * no `gh`; any other `gh` failure (auth, network) is a warning, not a silent "no PR".
 */
function findPr(worktree) {
  try {
    return JSON.parse(
      sh(
        'gh',
        ['pr', 'view', '--json', 'number,url,title,body,baseRefName,baseRefOid,headRefOid,closingIssuesReferences'],
        worktree,
      ),
    );
  } catch (e) {
    const msg = String(e.stderr ?? '');
    if (e.code !== 'ENOENT' && !/no pull requests found|none of the git remotes/i.test(msg)) {
      console.error(`warning: gh failed, reviewing without the PR text (${msg.trim().split('\n')[0] || e.message})`);
    }
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
function buildSpec(pr, worktree) {
  if (!pr) {
    return '';
  }
  const parts = [`# PR #${pr.number}: ${pr.title}\nSource: ${pr.url}\n${pr.body}`];
  // The URL, not the number: the issue may live in another repository.
  const issue = String(pr.closingIssuesReferences?.[0]?.url ?? '');
  if (issue) {
    try {
      const i = JSON.parse(sh('gh', ['issue', 'view', issue, '--json', 'number,url,title,body'], worktree));
      parts.push(`# Issue #${i.number}: ${i.title}\nSource: ${i.url}\n${i.body}`);
    } catch {
      console.error(`warning: the linked issue ${issue} could not be read, the spec has the PR text only`);
    }
  }
  return parts.join('\n\n');
}

// permissions.blockReadsOutsideWorkingDirectories (the read confinement of every pass) needs this version: an older
// CLI ignores the setting without a word, and the passes could then read any file while reading untrusted diffs.
const MIN_CLAUDE = [2, 1, 257];

function checkClaudeVersion() {
  let out;
  try {
    out = sh('claude', ['--version'], process.cwd());
  } catch {
    return; // not on PATH under this name: the passes fail loudly at start
  }
  const v = /(\d+)\.(\d+)\.(\d+)/.exec(out)?.slice(1).map(Number);
  const i = v ? MIN_CLAUDE.findIndex((n, k) => v[k] !== n) : -1;
  if (i >= 0 && v[i] < MIN_CLAUDE[i]) {
    fail(`claude ${v.join('.')} is too old: forked-review needs ${MIN_CLAUDE.join('.')} or newer (read confinement)`);
  }
}

export function prepare(opts) {
  checkClaudeVersion();
  const worktree = sh('git', ['rev-parse', '--show-toplevel'], process.cwd());
  const pr = findPr(worktree);
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], worktree);
  // A random suffix: two runs on the same branch (or same-named branches of different repos) never share a directory.
  // A slug must start with a word character (a leading '-' would read as a flag): a branch named in non-ASCII
  // letters loses them all, hence the fallback.
  const name = pr ? `pr${pr.number}` : branch.replace(/[^\w.-]/g, '-').replace(/^[-.]+/, '') || 'branch';
  const slug = `${name}-${randomBytes(3).toString('hex')}`;
  const base = resolveBase(opts, pr, worktree, branch);

  const head = sh('git', ['rev-parse', 'HEAD'], worktree);
  if (pr && head !== pr.headRefOid) {
    // A stale or unpushed local branch would be reviewed silently otherwise.
    fail('local HEAD is not the PR head: fetch, pull or push so the branch matches the PR');
  }
  // The PR's own base commit when this clone has it (a stale origin/<base> would show other people's commits), else the remote branch.
  let ref = `origin/${base}`;
  if (pr?.baseRefOid) {
    try {
      sh('git', ['cat-file', '-e', `${pr.baseRefOid}^{commit}`], worktree);
      ref = pr.baseRefOid;
    } catch {
      // not fetched: origin/<base>
    }
  }

  const scope = opts.get('scope') ?? 'committed';
  if (!SCOPES.includes(scope)) {
    fail(`unknown scope "${scope}": use committed, working-tree or both`);
  }
  const angles = [...new Set((opts.get('angles') ?? '').split(',').filter(Boolean))];
  checkAngles(angles);
  const changedFiles = changedFileCount(worktree, ref, scope);
  if (changedFiles === 0) {
    fail(`nothing to review: scope "${scope}" has no changes`);
  }
  const untracked = scope === 'committed' ? [] : untrackedFiles(worktree);
  if (untracked.length) {
    console.error(`warning: ${untracked.length} untracked file(s) are not in the diff and will not be reviewed (git add them first)`);
  }
  const { parts, grown } = planShards(worktree, ref, scope, MAX_PARTS);
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
    const spec = buildSpec(pr, worktree);
    if (spec) {
      writeFileSync(specPath(slug), spec);
    }
    parts.forEach((paths, i) =>
      writeDiffFiles(diffPath(slug, i), filesPath(slug, i), worktree, ref, scope, parts.length > 1 ? paths : undefined),
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
      head,
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
