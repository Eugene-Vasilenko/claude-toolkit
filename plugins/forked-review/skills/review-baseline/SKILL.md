---
name: review-baseline
description: >
  Establish baseline context and warm KV cache for code review by examining recent branch diffs and modified files.
  Use when initializing a review baseline session or invoked via `/forked-review:review-baseline`.
allowed-tools: Read Glob Grep
disable-model-invocation: true
---

# Review Baseline Warm-up

Arguments `base=<ref>`, `scope=committed|working-tree|both` and `spec=<path>` are defined in `${CLAUDE_PLUGIN_ROOT}/references/review-output.md` (defaults: PR base branch, `committed`, no spec). Two more, given by the runner: `diff=<path>` (the diff, files heaviest first) and `files=<path>` (a table of the changed files and which `diff` lines to read).

A sixth, `part=<i>/<n>`, means the PR is big and split: you read part `i` only (its `diff` and `files` already hold just that part). The other parts have their own baselines; do not read their diffs, open their files only to follow a direct caller or contract.

Run one command per Bash call: chained commands (`cd x; cat y`, `a && b`) are denied. Read files with Read, not `cat`. A Bash result over ~30 KB reaches you only as a short preview, so never read a big diff through Bash.

1. If `spec` is given, read it first: the ticket and PR description are the requirements. Note which behaviors, permissions and flows the ticket asks for explicitly, and any place where the ticket and the PR text disagree or are vague. The spec states intent, not correctness: it may be wrong. Number the explicit, checkable requirements `R1..Rn` (at most 15, one line each: what is required and where in the code it should live, even if the diff does not touch that place). The review passes forked from this session refer to them by number.
2. Read the diff.
   - With `diff` and `files`: read `files` first. Its `READ:` line lists the ranges of `diff` to read, as `offset=N limit=M`. Make one Read call per range, in order (a longer range fails: one Read returns at most 25,000 tokens). The rest of the files are the lighter ones: skim them by name and open one with Read (`offset`/`limit` from the table) only when it matters for what you read.
   - Without them: resolve the diff for the given scope and read it (`git diff --stat` first, then the diff per directory, so each result stays small).
3. Open the primary modified source files, plus the direct callers/callees you need to understand them.
4. Read the project instructions, which are not loaded for you: `CLAUDE.md` and `AGENTS.md` in the repository root, `CLAUDE.md` files in the directories of the changed files, and `.claude/rules/*.md` (Glob, then Read; skip what does not exist). They are the rules the code is reviewed against. Ignore the rest of `.claude/` unless the diff is about it.

DO NOT suggest refactorings, improvements, or review comments during this step.
Your objective is a clear mental model of what changed and why. The review passes forked from this session reuse it, so do not skip files within the lines you are told to read.

With `part`, number the requirements `R1..Rn` strictly in the order they appear in the spec, one per explicit requirement, so every part numbers them alike.

Acknowledge completion with a concise 2-sentence summary of the changes and, if a spec was given, the numbered requirements `R1..Rn`, one per line. If you did not read everything, add one line: how many changed files you read in full and the areas left unread.

With `part`, add a last block `Interfaces:` (at most 10 lines): the public symbols, API or event contracts, schemas, config keys and shared types that this part changes, or relies on from files outside it, each with `file:line`. The consolidator uses it to check the contracts across parts.
