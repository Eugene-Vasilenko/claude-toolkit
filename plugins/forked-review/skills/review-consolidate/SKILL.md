---
name: review-consolidate
description: >
  Merge, verify and filter the reports of the review angles into one final report.
  Internal step of `/forked-review:review`; invoked by its runner, not meant to be run by hand.
allowed-tools: Read Glob Grep
disable-model-invocation: true
---

# Review Consolidate

You run in a fork of the baseline session: you know the diff. Arguments: `base`, `scope`, `reports=<path>` (all angle reports in one file, each under `===== <angle> (<status>)`) and optionally `spec=<path>` and `parts=<path>`. With `parts` the PR was reviewed in parts: report sections are named `<angle>-<part>`, and you know only part 1 from the session. Format and rules: `${CLAUDE_PLUGIN_ROOT}/references/review-output.md`. Your final message is the report, nothing else: it starts with the first heading or line of the report, with no remark about what you checked before it. Call an angle by its plain word in the report's language (in Russian: "направление", not a transliteration).

1. **Read** the reports file (and the spec if given). `NO_<ANGLE>_ISSUES` = that angle found nothing in what it read; its `Not reviewed (in focus)` line says what it did not read. `<angle> FAILED` = the angle did not run: list it as failed, never as clean. `(reused)` = a complete report saved by an earlier run of the same review: treat it as done. `(partial)` = it hit its turn limit: read its `Not reviewed:` line and name it in the report.
2. **Deduplicate by root cause.** One item, severity = the highest any angle gave, angles listed in brackets (e.g. `[security, architecture]`).
3. **Cross-part check** (only with `parts`): read it (each part's summary and its `Interfaces:`). For every contract that one part changes and another part uses or implements (signature, event, schema, config key, shared type), open both sides and check they agree. A mismatch is a finding: it goes through the steps below like any other, with `Introduced by PR: yes`.
4. **Verify every BLOCKER and WARNING yourself.** Open the cited `file:line`, follow the `Repro`, and confirm the defect happens in the current code. Not reproducible = drop. Do this before any other filtering; reviewers over-report.
5. **Check against the spec** (if it exists):
   - treat the spec as a claim, not as truth: it can be outdated or wrong, and the ticket and PR text can disagree;
   - the finding is a risk that follows from a requested behavior (e.g. the ticket names the permission or flow it flags): it is not a coding defect. Move it to Product Decisions with the risk stated; it stays in the report, and security or data-loss risks keep their severity;
   - the finding is a flaw in how the requested behavior is implemented: it stays a defect regardless of the spec;
   - the finding's `Spec` field says `contradicts`: confirm the quote in the spec file yourself;
   - the spec is empty, vague or inconsistent: say so in the report and review on code merits alone.
6. **Drop** findings that:
   - (never drop a `rootcause` `SYMPTOM_FIX` finding as a nit: it is at least WARNING; verify the cause chain it names yourself)
   - lack a verified `file:line`, or hedge ("probably", "likely", "any future field…"). A code-trace `Repro` (see `review-output.md`) counts as verified when every hop checks out;
   - propose band-aids (ad-hoc null checks, type suppression) that hide a wrong value instead of fixing its source. A guard against a verified, reachable crash or data loss is not a band-aid: keep it, and add the source fix as the preferred `Fix`;
   - propose legacy patterns the project has moved away from (e.g. type-system escape hatches, hand-rolled helpers for something the framework provides) instead of the standards in the project's docs and rules (`CLAUDE.md`, `AGENTS.md`, contributing guide, lint config);
   - are pedantic nits with no effect on architecture, correctness, security or maintainability;
   - contradict the project's documented conventions (`CLAUDE.md`, `AGENTS.md`, contributing guide);
   - flag a style or structure pattern (`architecture`, `reuse`, `hygiene`, `simplicity`) that already has 2+ precedents in the repo (check with grep): at most Deferred. `security`, `correctness` and `rootcause` findings keep their severity whatever the precedents.
7. **Separate scope.** In-scope defects (`Introduced by PR: yes`) go to the Actionable Checklist. Pre-existing or systemic issues go to Deferred Project Tech Debt (keep them, never discard), except a `security` or `correctness` defect whose new path the PR opens (see `review-output.md`): that one stays in the checklist. Design-driven risks go to Product Decisions.
8. **Requirements table** (only if the baseline numbered `R1..Rn`): for each Rn, union the angles' `Requirements checked` (with `parts`, do not trust the unions: verify each Rn yourself). An Rn nobody checked: verify it yourself (open the code it names; one or two Read/Grep calls) and mark it ok or violated (a violation is a finding: run steps 4-7 on it). Still unverified after that: mark it `not checked`, never `ok`.
9. **Report**: whether a spec was found, the requirements table (`Rn | requirement | ok / violated (see item) / not checked`), the checklist ordered BLOCKER > WARNING > NIT (each marked verified), Product Decisions (keep the Situation / Options format, the author must be able to answer without reading the diff), Deferred items, dropped findings with a one-line reason each, failed or partial angles, and coverage: per angle the `Not reviewed (in focus)` areas. Name the `not checked` requirements there too, with the list; never write just "nobody checked it". An angle with a long unread list is reported as "nothing found in what it read", never as plainly clean.
