# Review Simplicity

Review code changes focusing on **Necessity & Simplest Design**. The question here is "does this need to exist?", not "is it implemented correctly?".

## Arguments & Output

Follow the output contract below for arguments (`base`, `scope`, `spec`), the output format, and the rules. Clean result token: `NO_SIMPLICITY_ISSUES`.

**Extra section (this pass only).** The report file starts with a `### Minimal Design` block of 3-5 lines, written before you open any code or the diff (you run cold, without the baseline session; you get only the spec and `base`/`scope`): the problem, the user flow, and the smallest change that satisfies the spec (name the files or layers it touches). Then the usual sections follow. A clean result is that block followed by the `NO_SIMPLICITY_ISSUES` line. The block lets the author check the design you compared against; findings must follow from the gap between it and the diff.

Here, `Evidence` means: the scenario the mechanism protects against and why it is unrealistic or cheaper to handle otherwise. `Fix` is a deletion or a smaller design, stated concretely. Use `[SEVERITY: WARNING]` when a mechanism can be removed with no loss of required behavior, `NIT` for smaller trims. Before rating a style or structure pattern WARNING or higher, grep for precedents: a pattern already used in 2+ places is at most Deferred, not a defect of this PR.

## Method

1. **Design first, diff second.** Before judging the diff, write down in the `### Minimal Design` block the smallest design that satisfies the spec: the problem, the actual user flow, the minimum code. Anchoring on the diff is the failure mode of this review; do not skip this step.
2. **Compare.** List everything in the diff that your minimal design does not need.
3. **Interrogate every knob.** For each new constant, threshold, parameter, flag, state field, queue, retry, cache, or extra code path ask:
   - What exact scenario does it protect against?
   - Can that scenario happen in the real flow (check the code that triggers the operation, e.g. which page, which user action, how often)?
   - What breaks if it is removed? Is that cheaper than carrying it (extra parameters, injected clocks, tests, docs)?
4. **Check alternatives.** Is there an existing mechanism (a different trigger point, an existing cleanup, a DB constraint, a platform feature) that makes this one redundant? Grep before claiming it.
5. **Count the cost.** Note lines, parameters and call sites added for each mechanism. A mechanism that touches many files for a rare edge case is a strong candidate.

## Mental Checklist:

- Defensive code for a scenario the flow cannot produce (time windows, grace periods, locks, retries).
- The same cleanup/sync/validation performed at several trigger points when one suffices.
- New abstractions, options or injected dependencies used by a single caller.
- Behavior added beyond what the spec asks, with its own failure modes.
- Machinery that exists only to support an earlier design decision of this same PR.

If a mechanism is a real protection that the spec or an accepted risk requires, do not flag it. If you cannot tell whether the protected scenario is real, put it under Product Decisions as a question, with the flow facts you checked.
