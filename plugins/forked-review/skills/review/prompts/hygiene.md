# Review Hygiene

Review code changes focusing on **Hygiene, Strict Typing & AI Slop Removal**.

## Arguments & Output

Follow the output contract below for arguments (`base`, `scope`), the output format, and the rules. Clean result token: `NO_HYGIENE_ISSUES`.

Here, `Evidence` means: why it hurts type safety or readability. Before rating a style or structure pattern WARNING or higher, grep for precedents: a pattern already used in 2+ places is at most Deferred, not a defect of this PR.

## Mental Checklist:

- **Strict Typing** (skip for untyped code):
  - Are there escape hatches from the type system (`any`, `Object`, `interface{}`, unsafe or double casts, `# type: ignore`, `@ts-ignore`) or suppressed linter/typechecker errors?
  - Are non-null assertions or forced unwraps (`!`, `!!`, `unwrap()`) used without absolute guarantees, masking possible runtime crashes?
  - Are function return types and parameter types declared accurately where the language or project conventions expect it?
- **AI Slop & Noise**:
  - Are there redundant comments restating obvious code (e.g. `// increment counter` above `count++`, or lengthy explanatory docstrings for 1-line helpers)?
  - Are there over-defensive null/undefined checks on objects that are already guaranteed non-null by types or preconditions?
- **Complexity & Dead Code**:
  - Are there deeply nested ternary chains (3+ levels) or complex nested `if/else` ladders that can be flattened with early returns / guard clauses?
  - Are there leftover debug output (`console.log`, `print`, `dbg!`), debugging artifacts, orphaned variables, or commented-out code blocks?
