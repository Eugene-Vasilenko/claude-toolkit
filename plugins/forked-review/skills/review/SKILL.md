---
name: review
description: >
  Deep multi-angle code review of the current branch or PR: one warm baseline session, several parallel focused
  passes (architecture, correctness, security, reuse, hygiene, simplicity, root cause), findings verified and merged
  into one checklist. Runs several headless Claude sessions, so it costs noticeably more than a normal review.
  Run it explicitly with `/forked-review:review`.
allowed-tools: Read Glob Grep Bash(node ${CLAUDE_SKILL_DIR}/scripts/forked-review.mjs *) Bash(node "${CLAUDE_SKILL_DIR}/scripts/forked-review.mjs" *)
disable-model-invocation: true
---

# Forked Agent Review

Perform multi-angle, deep code reviews using session forking (`--fork-session`) and prompt caching in Claude Code.

## Quick start

- Run `/forked-review:review` on the branch you want reviewed. A run that stopped (account limit, crash) is continued with `/forked-review:review resume`. Optional: name the angles ("security and correctness only"), the base branch, or `working-tree` to include uncommitted changes.
- Result: one checklist ordered BLOCKER > WARNING > NIT, plus questions for the author and deferred tech debt. Nothing is written into the repo; temp files live in the system temp dir and are removed at the end.
- Cost: a baseline session (one per part for a big PR), an analyze fork, parallel angle sessions and a consolidation fork. The runner prints an estimated cost (client-side, not the bill). For a trivial change ask for one or two angles.
- Needs: `git`, Node.js 18+, the `claude` CLI (on Windows the native `claude.exe`), and this plugin installed. `gh` (authenticated) is optional: with it the base branch and the spec (PR text and linked issue) come from the PR; without it pass `--base <branch>` and there is no spec.

## How it works

You are only the orchestrator: you never read the diff and never see the angle reports. Everything runs in forks of one warm baseline session:

```
you ─ prepare ─► baseline (reads the diff, warms the cache)
you ─ analyze ─► fork: analyze  picks the angles
                   └─ names the angles; the runner then runs:
                      fork per angle, in parallel ─► reports in the temp dir
                      └► fork: consolidate  verifies and merges ─► final report
you ◄────────── the final report
```

A big PR is split into parts: one baseline per part, every angle runs on every part (at most 6 processes at once), except `simplicity`, which runs once on the whole PR, and the consolidation also checks the contracts that cross parts.

The reviewed repository's own hooks, MCP servers and settings never run in these sessions (`--setting-sources user`); the baseline reads its `CLAUDE.md` and rules explicitly.

Details (permissions, cold angles, turn limits) are explained in comments in `scripts/forked-review.mjs`.

## Workflow

`RUN` below stands for `node ${CLAUDE_SKILL_DIR}/scripts/forked-review.mjs`. Write the whole command out in every Bash call: no shell variable for the path (`RUN=...; node $RUN`), no chaining or pipes (`;`, `&&`, `|`), and quote the path only if it has spaces. The skill pre-approves exactly that form, so any other Bash command asks the user. Run it from the repository (or worktree) root and never `cd` elsewhere. The runner keeps everything in `<tmpdir>/review-<slug>/state.json`, so after `prepare` every command needs only the slug.

### Resume

The user asks to resume or continue a stopped review, or runs `/forked-review:review resume`: do not run `prepare`. Run `RUN resume` with `run_in_background` (add `--keep` only if the user wants follow-up questions); it finds the newest unfinished run of this worktree itself (`RUN resume $SLUG` names one). It redoes only what is missing: the baseline parts without a session, then every pass without a report. Then continue at Phase 3. It fails with `HEAD moved since prepare` if the code changed since `prepare`: tell the user to start over. If the account limit is still active it stops at once and says so: tell the user when it resets (the message names the time).

### Phase 0: Resolve inputs

`RUN prepare [--base <branch>] [--scope committed|working-tree|both] [--angles a,b] [--hint "<text>"]`. Scope default `committed` ("ignore local changes" = committed). Pass the user's wishes about angles like this:

- An exact set ("only security and correctness"): `--angles security,correctness`. No analyze fork runs then.
- Any other wish ("also security", "skip simplicity", "this is risky auth code"): `--hint "<the user's words>"`. Do not interpret it, the analyze fork knows the diff. When unsure whether it is an exact set, use `--hint`.
- Nothing said: pass neither.

`prepare` resolves the PR (slug `pr<number>-<random>`, base branch) and builds the spec file (PR text plus the linked issue). Without a PR the slug is the branch name plus a random suffix and the base is the nearest parent branch; on a tie it fails: pass `--base`. With a PR, run it without `--base`. With a PR it fails if the local file count differs from the PR (fetch, pull or push, then repeat). It also writes the diff (heaviest files first) and a file table into the temp directory for the baseline. A diff over ~150 KB is split into parts of whole files (`parts=N`, at most 4, env `REVIEW_MAX_SHARDS`; if the diff needs bigger parts than a baseline reads in full, `prepare` warns on stderr): each part gets its own baseline, so the cost grows roughly N times. It prints `slug=... base=... scope=... spec=yes|no parts=N angles=...`; use the slug as `$SLUG`. `spec=no`: say so in the report.

### Phase 1: Baseline warm-up

`RUN baseline $SLUG` (Bash `timeout` 400000 ms). Failure prints the path of the `.err` log: read it. An account limit is not a reason to give up: the message ends with how to continue (`RUN resume`); it redoes only the parts that failed. Run `RUN cleanup $SLUG` only if the failure is not transient.

### Phase 2: Analyze, angles, consolidation

`RUN analyze $SLUG` with `run_in_background`; it runs for minutes. Wait for it, do not poll. It removes the run directory itself after printing the report (the permission to run `RUN` may not reach the turn in which the background run ends). Add `--keep` only if the user wants to ask follow-up questions about the run. Progress is in `<tmpdir>/review-$SLUG/progress.log`, read it only if the user asks.

Success: stdout is the `Angles:` and `WHY:` lines and the final report, stderr is the cost summary with, per pass, `turns` and `cache` (the share of input served from the prompt cache; a low value on a fork means the baseline's cache was lost) and what it actually looked at (`diff N/M files` = changed files whose diff it read, for a fork including what the baseline read; `other files read`, greps, `truncated` = a tool result cut to a preview, `denied` = refused commands). Failure (exit 1) prints the paths of the logs: read them. The run can be resumed: tell the user the reason (the error text is in the output) and, for a limit, when it resets; then `RUN resume` reuses the chosen angles and every report already saved (a partial one too) and runs only the rest (`reused` in the cost summary). Run `RUN cleanup $SLUG` only if you give up. A failed angle does not fail the run: the report lists it as failed. A partial angle (turn limit) is named in the report; to review it deeper, run again with a higher `REVIEW_MAX_TURNS`.

### Phase 3: Report

Give the user the final report as it is, with the `Angles:` line and the cost summary (including the coverage figures) on top. Do not re-verify or reshape it. If you ran `analyze` with `--keep`, run `RUN cleanup $SLUG` when the user is done.

For questions afterwards, answer from the report; for more depth read the code, or the baseline transcript (its session id is in the state file; both are gone unless `--keep` was used).
