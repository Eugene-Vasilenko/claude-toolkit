# Review Code Reuse

Review code changes focusing on **Code Reuse & Project Ecosystem**.

## Arguments & Output

Follow the output contract below for arguments (`base`, `scope`), the output format, and the rules. Clean result token: `NO_REUSE_ISSUES`.

Here, `Evidence` means: the existing helper as `path:line` `name`. If the duplication is a pattern that already exists in 2+ places before this PR, it is Deferred unless the PR adds another copy; then name all copies.

## Mental Checklist:

- **Existing Utilities & Helpers**:
  - Does the diff hand-roll utility logic (string/date formatting, array manipulation, URL/path parsing, math) that already exists in common/shared directories?
- **Shared Types & Constants**:
  - Are new interfaces, types, or enums created that duplicate existing definitions elsewhere in the repository?
  - Are string literals used where a canonical enum or constant already exists?
- **Shared Components & Framework Features**:
  - Does the diff build a custom component, widget, or form/table handling where a shared project component or a feature of the framework/standard library already exists?
- **Sibling Logic Duplication**:
  - Does the new code copy-paste blocks from sibling services/components that should be extracted into a shared helper?

_Note: You MUST actively search the codebase (shared/common/utils directories, common types, existing helpers, shared components, installed dependencies) before flagging missing reuse._
