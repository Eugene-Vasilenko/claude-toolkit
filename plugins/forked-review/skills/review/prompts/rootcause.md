# Review Root Cause

Review code changes focusing on **Root Cause vs Symptom**. The question here is "does this change remove the cause of the problem?".

## Arguments & Output

Follow the output contract below for arguments (`base`, `scope`, `spec`), the output format, and the rules. Clean result token: `NO_ROOTCAUSE_ISSUES`.

Here, `Evidence` means: the cause chain and the step where the diff does or does not intervene. A symptom fix is `[SEVERITY: WARNING]` at least; `BLOCKER` when the real cause still corrupts data or breaks the flow. Put the verdict line (`ROOT_FIX`, `SYMPTOM_FIX` or `CAUSE_UNCLEAR`) at the top of the report, above the checklist. Severity does not depend on precedents in the repo (a copied symptom fix is still a symptom fix).

## Method

1. **Cause before diff.** Do not open the diff yet (you run cold, without the baseline session: you get only the spec and `base`/`scope`). From the spec, the issue and the code, write the cause chain: what the user sees, what the code does, and the first wrong step (wrong data, wrong state, wrong contract, wrong assumption). Anchoring on the diff is the failure mode of this review; do not skip this step. No spec: say so and derive the chain from the code and commit messages.
2. **Locate the intervention.** Open the diff. Does it change the first wrong step, or a later one? A later step is a patch: null check, `try/catch`, default value, `if` on a special case, re-fetch or re-sync after the fact, a flag that hides the broken state.
3. **Removal test.** Imagine the fix reverted and the cause chain fixed at the point you named. Would the symptom vanish without the diff? If yes, the diff is a symptom fix.
4. **Siblings.** Grep for the same pattern elsewhere (same helper, same assumption, same query shape). A fix in one of several affected places is incomplete: list the others.
5. **Verdict.**
   - `ROOT_FIX`: the diff changes the first wrong step.
   - `SYMPTOM_FIX`: the diff hides a later step. State the real cause and the place to fix it as the `Fix`.
   - `CAUSE_UNCLEAR`: the cause cannot be shown from the code. State what must be checked (log, data, repro) instead of guessing.

## Mental Checklist:

- A guard or default added where the value is already wrong; who produces the wrong value?
- Fix at the call site while the shared function or contract keeps the defect.
- Cleanup, re-sync or retry that repairs the state after the broken write instead of preventing it.
- The test or repro passes now, but the path that produced the bad state is unchanged.
- A real fix that is deliberately partial: if the spec accepts a stopgap, do not flag it, put the follow-up under Product Decisions.

For a feature diff (no defect being fixed), the cause is the missing capability; the verdict is `ROOT_FIX` unless the diff works around a limit in shared code instead of extending it.
