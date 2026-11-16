---
name: review-architecture
description: >
  Review recent code changes with primary lens on architecture, invariants, boundary separation, and solution altitude.
  Use when conducting an architectural review pass or invoked via `/forked-review:review-architecture`.
allowed-tools: Read Glob Grep
disable-model-invocation: true
---

# Review Architecture

Review code changes focusing on **Architecture, Invariants & Solution Altitude**.

## Arguments & Output

Follow `${CLAUDE_PLUGIN_ROOT}/references/review-output.md` for arguments (`base`, `scope`), the output format, and the rules. Clean result token: `NO_ARCHITECTURE_ISSUES`.

Here, `Evidence` means: structural risk, boundary or contract broken. Before flagging a structural pattern (e.g. a circular import between modules, a service calling another feature's service), grep for existing uses; with 2+ precedents it is project convention, not a defect of this PR.

## Mental Checklist:

- **Separation of Concerns & Layering**:
  - Do modules, classes, or layers leak internal abstractions or cross architectural boundaries improperly?
  - Is business logic placed in the domain/service layer rather than in UI, request handlers, or glue code?
- **Generalization**:
  - Does it introduce special-case branches (e.g. `if (caller == "xyz")`) instead of generalizing the abstraction?
- **Necessity of Mechanisms**:
  - For every new constant, threshold, parameter, flag, queue, or extra trigger point: which exact scenario does it protect against, and can that scenario happen in the real flow (read the caller, page, or user action)?
  - If not, or if removing it is cheaper than carrying it (extra parameters, injected clocks, extra call sites), flag it with the deletion as the `Fix`.
- **Domain Invariants & Contracts**:
  - Are public APIs, data contracts, database schemas, or state transitions preserved without breaking backward compatibility?
  - Are domain entity invariants safely maintained across all mutation paths?
  - When schemas or shared models are touched, are the derived artifacts (migrations, generated code, API docs) updated with them?
- **Error Architecture**:
  - Is error handling aligned with the project's established approach (error types, structured error responses), or does it invent an ad-hoc one?
