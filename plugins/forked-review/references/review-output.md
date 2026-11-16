# Review Output Contract

Shared by all `review-*` skills and `review`. Do not restate it in each skill.

## Arguments

- Output: your final message is the complete report. The runner saves only that message, so leave no findings in earlier messages.
- `base=<ref>`: base branch of the diff (e.g. `main`). Default: `gh pr view --json baseRefName`. No PR: the nearest parent, i.e. the `origin/*` branch with the fewest commits behind `HEAD` (`git rev-list --count <ref>..HEAD`); a tie means ask for `base=`. State the chosen base and commit count at the top of the report.
- `scope=committed|working-tree|both`: what to review. Default `committed`.
  - `committed`: `git diff "origin/$base...HEAD"`. Ignore uncommitted changes.
  - `working-tree`: `git diff HEAD` (staged + unstaged).
  - `both`: the union of the two.
- `spec=<path>`: absolute path of the file with the ticket and PR description (the requirements). Read by the baseline, the cold angles (`rootcause`, `simplicity`) and `consolidate`; other forked passes inherit it. No file: no spec is available, so say so instead of guessing.
- `part=<i>/<n>` (only when a big PR is reviewed in parts): you review part `i` of `n`. The changed files outside your part belong to other passes: do not report them, read them only to follow a caller or a contract. `files=<path>` (the baseline and the cold angles get it; forked passes know it from their baseline) is the table of your part's files, first column = path; a cold angle also gets `diff=<path>`, the diff of its part, to read as the `READ:` line of `files` says. Report the paths you list in `Reviewed` / `Not reviewed` for your part only. A `files=` table without `part=` lists every changed file of the PR: that pass covers the whole PR (the cold `simplicity` angle runs once like this, because "is this mechanism needed?" concerns the whole change; it gets no `diff=`: the diff of part `i` is `diff-<i>.patch` beside the table).
- Never review files under `.claude/` unless the diff is about them.

## Format

```markdown
### Actionable Review Checklist (In-Scope):

- [ ] [SEVERITY: BLOCKER|WARNING|NIT] `<file:line>`
      Problem: <one line: the defect or risk>
      Evidence: <trigger scenario / exploit vector / existing util at `path:line` / why it hurts>
      Repro: <concrete input or sequence of steps that triggers it today>
      Introduced by PR: <yes (changed line in the diff) | no>
      Spec: <consistent | contradicts "<quote>" (issue #N | PR #N) | not covered>
      Fix: <concrete change>

### Product Decisions (Question for the Author):

- [ ] [DECISION] `<file:line>` <short title in plain words>
      Situation: <what the code or feature does now, 1-2 plain sentences, understandable without opening the code>
      Risk / trade-off: <what can go wrong or what is gained: who is affected, when, what the effect is>
      Options: A) <keep as is: consequence>. B) <change: consequence and rough cost>
      Recommendation: <A or B, one line why. The author decides>
      Spec: <what the ticket / PR says (quote), or "silent">

### Deferred Project Tech Debt (Out of Task Scope):

- [ ] [DEFERRED] `<file:line>`
      Problem: <pre-existing or systemic defect in code this task did not change>
      Context: <why it is deferred, suggested follow-up>

Reviewed: <the changed files you opened or whose diff you read: paths, or a count plus the directories>
Not reviewed (in focus): <changed files your lens applies to that you did not open, or "none">
Requirements checked: <the baseline's R-numbers you verified, or "none">   (only if your skill asks for it; otherwise leave this line out)
```

- Omit a section that has no items. The coverage lines above are always last, also in a clean result.
- A `DECISION` is written for the author who has not read the diff or your report: describe the behavior by what a user or admin sees first, identifiers in backticks second. One decision per item, answerable with "A" or "B". No review jargon, no vague "consider whether".
- No issues at all: the message is your clean-result token (given in the skill, e.g. `NO_SECURITY_ISSUES`) on the first line, then the coverage lines.

## Rules

- Cover your focus before you finish. Compare what you opened with the list of changed files (the baseline's `files` table, or `git diff --stat`). While a changed file your lens applies to is unopened and you have turns left, open it; do not stop after the first few findings. A mechanical change repeated across many files (the same one-line edit) counts as reviewed when you read a sample and grep for the rest: say so in `Reviewed`.

- Requirements (`R1..Rn`, numbered by the baseline): only passes whose skill says so check them; the others ignore them.
- Every finding cites a `file:line` you opened. No "probably" / "likely exists": grep or read first, or drop it.
- Report only defects in lines this task changed as in-scope. Put pre-existing ones under Deferred.
- One finding per root cause. Do not split one problem into several items.
- The spec is the author's stated intent, not the truth. It may be outdated, vague or wrong. Use it only to tell "the code does something other than requested" from "the code does what was requested".
- A requirement does not hide a risk. If the spec asks for the behavior (a permission, a flow, a field) and the risk follows from that design, do not call it a coding defect: put it under Product Decisions with the risk spelled out, so the author can confirm it. Never drop it and never lower a security or data-loss risk just because the spec asks for it.
- A bug in how the requested behavior is implemented (wrong order, partial write, missing check) is a defect whatever the spec says.
- If the ticket and the PR description disagree, or the code does something the spec never mentions, say so under Product Decisions.
- A finding needs a `Repro` you can actually follow in the current code. "Any future field / caller could…" is not a defect: drop it. For races, authorization gaps and other hard-to-run cases, a `Repro` may be a code trace (entry point → each call → the failing line, with `file:line` for every hop, plus the interleaving or caller identity needed). Do not drop such a finding only because it cannot be run step by step.
- `Introduced by PR: no` means the finding goes to Deferred; say in `Context` if the PR makes it easier to reach.
- Your focus comes first, but flag any critical blocker you notice outside it.
