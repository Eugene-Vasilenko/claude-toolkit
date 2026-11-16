---
name: review-analyze
description: >
  Pick the review angles for the change already read in this session and name them.
  Internal step of `/forked-review:review`; invoked by its runner, not meant to be run by hand.
allowed-tools: Read
disable-model-invocation: true
---

# Review Analyze

You run in a fork of the baseline session: you already know what changed. Arguments: `base`, `scope`, and optionally `hint=<path>` (a file with the user's wishes about the review). No critique here. With `all=<path>` the PR is split into parts and you know only part 1: read that file (every changed file and its part) and pick the angles for the whole PR. Every angle then runs on every part.

1. If `hint` is given, read it. Treat it as the user's wishes: it can name angles to add, to skip, or to run alone, or describe the risk ("auth change"). Follow it over the matrix below, but only with angles from the table.
2. Pick the angles with the matrix. Do NOT always run all of them: choose from the scope, risk and nature of the diff you read.
3. Your final message is exactly two lines, nothing else, and you run no commands:

   `ANGLES: <angle>,<angle>,...`
   `WHY: <one sentence: why these angles>`

   The runner reads the first line, runs the angles and consolidates them. Do not write a review and do not repeat any report.

## Angle matrix

| PR Scope / Nature                                                      | Fork Count | Recommended Angles                                   | Rationale                                                                                         |
| :--------------------------------------------------------------------- | :--------: | :--------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| **Quick Bugfix / Minor Edit** (<50 lines)                              |   **2**    | `correctness` + `rootcause`                          | Verify logic and regressions, and that the fix removes the cause instead of hiding the symptom.   |
| **Any bugfix** (`fix(...)` commits, issue describes a defect)          |   **+1**   | `rootcause` _(if not already chosen)_                | A fix at the wrong step passes correctness but the defect returns elsewhere.                      |
| **Frontend / UI Components & Forms**                                   |   **3**    | `reuse` + `hygiene` + `correctness`                  | Reuse shared UI pieces, keep types and code clean, and catch resource leaks and async races in the UI. |
| **Backend / API / DB Services**                                        |   **2**    | `architecture` + `correctness`                       | Verify layering, data contracts, API contracts, async error handling, and transactional consistency.        |
| **Major Feature / Complex PR / Refactoring**                           |  **3–4**   | `architecture` + `reuse` + `hygiene` + `correctness` | Full multi-dimensional quality gate before merging.                                               |
| **Security-Sensitive / Auth / File Uploads**                           |   **+1**   | `security` _(on-demand)_                             | Enforce permissions, tenant isolation (if multi-tenant), input validation, and leak prevention.                            |
| **Adds a mechanism** (sweep, retry, cache, threshold, background step) |   **+1**   | `simplicity`                                         | Challenge whether the mechanism is needed at all, not only whether it is correct.                 |

## Angles

`architecture`, `correctness`, `hygiene`, `reuse`, `rootcause`, `security`, `simplicity` (focus of each: its `review-<angle>` skill).
