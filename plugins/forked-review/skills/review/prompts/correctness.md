# Review Correctness

Review code changes focusing on **Correctness, Edge Cases & Runtime Reliability**.

## Arguments & Output

Follow the output contract below for arguments (`base`, `scope`), the output format, and the rules. Clean result token: `NO_CORRECTNESS_ISSUES`. Spec requirements: if the baseline numbered them (`R1..Rn`), check those your lens applies to against the code, also where the diff is silent about them (a requirement the PR leaves untouched still has to hold: open that code). List the ones you verified in the `Requirements checked` line. A requirement the code violates is a finding; do not just tick it.

Here, `Evidence` means: the concrete input or condition that triggers the failure. Severity does not depend on precedents in the repo (a copied leaked resource is still a bug). If the PR adds a new caller, route, or data path that reaches a pre-existing defect, the newly exposed path is in scope: report it as `Introduced by PR: yes`, name the changed line that opens the path, and give the fix at the shared code.

## Mental Checklist:

- **Async & Concurrency Hazards**:
  - Are async results or errors dropped (unawaited promises/futures/tasks, ignored error returns, fire-and-forget calls)?
  - Can race conditions occur if requests, events, threads, or state updates arrive out of expected order? Is shared mutable state properly guarded?
- **Resource Lifecycle & Cleanup**:
  - Are resources (subscriptions, event listeners, timers, file handles, connections, locks, threads) released on every path, including errors and teardown?
  - Are closures or caches inadvertently retaining large memory structures?
- **Edge & Boundary Conditions**:
  - What happens if inputs are empty collections, empty strings, `0`, or null/nil/undefined/None?
  - Are off-by-one errors possible in loops, array slicing, or pagination boundaries?
- **Error Propagation & Silent Failures**:
  - Are errors caught or ignored only to be silently swallowed (empty `catch`, discarded error value), hiding bugs and leaving the app in an indeterminate state?
  - Are partial failures handled safely without corrupting application state?
