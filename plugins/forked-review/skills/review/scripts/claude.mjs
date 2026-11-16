/**
 * Plumbing for headless `claude -p` runs: permissions, spawning, reading the stream-json output.
 * It knows nothing about the review flow (forked-review.mjs builds the prompts and decides what to run), only the
 * layout of diff.patch and files.tsv that `coverage()` maps Read calls onto.
 */
import { spawn } from 'node:child_process';
import { sep } from 'node:path';

// ---------------------------------------------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------------------------------------------

// Layers: `--tools` limits which tools exist; `blockReadsOutsideWorkingDirectories` and `--setting-sources user`
// (below) confine reads and drop the repo's own settings; dontAsk plus the allowlist only decide what is asked.
// dontAsk denies everything not listed, on any model and provider (no auto-mode classifier needed).
// Reviewers read untrusted diffs and have no Bash at all: no git option, `-c` or `--output` trick can write a file or
// read outside the repo, and the runner has already written the diff to files.

// Without this the Read, Glob and Grep rules allow any file on the machine, and the reviewers read untrusted
// text: an injected "read ~/.ssh/id_ed25519 and quote it" would end up in the report.
// disableAllHooks, `--setting-sources user` and `--strict-mcp-config` (below): under `-p` there is no trust dialog, so
// the reviewed repo's own hooks, `env` and `.mcp.json` would run. The repo's CLAUDE.md goes with the project settings,
// so the baseline reads the project instructions itself (baseline prompt, step 4).
const SETTINGS = JSON.stringify({ disableAllHooks: true, permissions: { blockReadsOutsideWorkingDirectories: true } });

/**
 * Permission flags shared by every pass. Reads are limited to the working directory plus `slugDir` (spec, diff
 * files).
 */
export const permArgs = (slugDir) => [
  '--permission-mode',
  'dontAsk',
  // The real boundary: only these tools exist in the session, whatever the user's allow rules or mods say.
  // Identical for every pass, so forks keep the baseline's prompt cache.
  '--tools',
  'Read,Glob,Grep',
  '--allowedTools',
  'Read,Glob,Grep',
  '--settings',
  SETTINGS,
  '--setting-sources',
  'user',
  '--strict-mcp-config',
  '--add-dir',
  slugDir,
];

// ---------------------------------------------------------------------------------------------------------------
// Running a process
// ---------------------------------------------------------------------------------------------------------------

/**
 * Runs a command to the end. Never rejects: a failed start comes back as `code: null` with the reason in `stderr`.
 * `onLine` gets every complete line of stdout while the process runs.
 */
export function exec(cmd, args, cwd, onLine) {
  return new Promise((resolve) => {
    // No shell: the prompts contain spaces and quotes, and quoting differs per OS.
    // stdin ignored: an open pipe makes `claude -p` wait 3 s for input on every pass.
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pending = '';
    // Without this a multi-byte character split between two chunks turns into U+FFFD.
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (onLine) {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        lines.forEach(onLine);
      }
    });
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.on('error', (err) =>
      resolve({
        code: null,
        stdout,
        stderr: `${stderr}cannot start "${cmd}": ${err.message} (a .cmd shim cannot be spawned without a shell: use the native claude.exe)`,
      }),
    );
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the stream-json output
// ---------------------------------------------------------------------------------------------------------------

/** The pass's report is the `result` of the last stream-json event. */
export function finalResult(stdout) {
  for (const line of stdout.split('\n').reverse()) {
    try {
      const e = JSON.parse(line);
      if (e.type === 'result') {
        // Share of input tokens served from the prompt cache (a fork that misses it pays the full baseline again).
        const u = e.usage ?? {};
        const read = u.cache_read_input_tokens ?? 0;
        const input = (u.input_tokens ?? 0) + read + (u.cache_creation_input_tokens ?? 0);
        return {
          turns: Number(e.num_turns ?? 0),
          cache: input ? Math.round((100 * read) / input) : 0,
          text: String(e.result ?? ''),
          ok: e.subtype === 'success' && !e.is_error,
          isError: Boolean(e.is_error),
          denials: e.permission_denials ?? [],
          subtype: e.subtype,
          session: e.session_id,
          cost: Number(e.total_cost_usd ?? 0),
        };
      }
    } catch {
      // not a JSON line
    }
  }
  return { text: '', ok: false, isError: true, denials: [], cost: 0 };
}

/** The refused commands as a line for the .err log; empty when nothing was refused. */
export const denialsNote = (denials) =>
  denials.length ? `\n[permission_denials] ${JSON.stringify(denials)}\n` : '';

/** The text of a tool_result block (a string, or a list of text blocks). */
const resultText = (content) =>
  typeof content === 'string' ? content : (content ?? []).map((x) => x.text ?? '').join('');

/**
 * What a pass actually looked at, from its stream-json events:
 * - `diffFiles`: changed files whose whole block in diff.patch was read with Read (`diff.file`; `diff.index` maps
 *   files to line ranges, see `readDiffIndex`);
 * - `sources`: other files of the reviewed repo (`diff.repo`) opened with Read; files outside it (the run directory,
 *   the installed plugin) are not the review's business;
 * - Grep calls and tool results that were cut off (they start with
 *   "<persisted-output>": the model sees only a preview; the same text inside a diff that was read is not a cut-off).
 */
export function coverage(stdout, diff = {}) {
  const { file: diffFile, index = [], repo } = diff;
  const sources = new Set();
  const lines = [];
  let greps = 0;
  let truncated = 0;
  for (const line of stdout.split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // not a JSON line
    }
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c.type === 'tool_use') {
        const path = c.input?.file_path;
        if (c.name === 'Read' && path === diffFile) {
          const offset = Number(c.input.offset) || 1;
          lines.push([offset, offset + (Number(c.input.limit) || 2000) - 1]);
        } else if (c.name === 'Read' && path && (!repo || path.startsWith(repo + sep))) {
          sources.add(path);
        } else if (c.name === 'Grep') greps++;
      } else if (c.type === 'tool_result' && resultText(c.content).trimStart().startsWith('<persisted-output>')) {
        truncated++;
      }
    }
  }
  return { diffFiles: filesInRanges(index, lines), sources: sources.size, greps, truncated };
}

/** The paths of the index entries (`{ path, first, last }`) whose lines lie inside the union of `ranges`. */
function filesInRanges(index, ranges) {
  const merged = [];
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return index.filter((f) => merged.some(([from, to]) => from <= f.first && f.last <= to)).map((f) => f.path);
}

/**
 * `coverage()` as one line. `total` is the number of changed files; `inherited` are the files a fork already
 * knew from the baseline session it was forked from.
 */
export function fmtCoverage(c, denied, total, inherited = []) {
  const diffFiles = new Set([...inherited, ...c.diffFiles]).size;
  return (
    `diff ${diffFiles}${total ? `/${total}` : ''} files${inherited.length ? ` (${inherited.length} from the baseline)` : ''}, ` +
    `${c.sources} other files read, ${c.greps} grep, ${c.truncated} truncated, ${denied} denied`
  );
}
