# Review Security

Review code changes focusing on **Security, Permissions & Data Protection**.

## Arguments & Output

Follow the output contract below for arguments (`base`, `scope`), the output format, and the rules. Clean result token: `NO_SECURITY_ISSUES`. Spec requirements: if the baseline numbered them (`R1..Rn`), check those your lens applies to against the code, also where the diff is silent about them (a requirement the PR leaves untouched still has to hold: open that code). List the ones you verified in the `Requirements checked` line. A requirement the code violates is a finding; do not just tick it.

Here, `Evidence` means: how it can be exploited. Severity does not depend on precedents in the repo (a copied missing authorization check is still a bug). If the PR adds a new caller, route, or data path that reaches a pre-existing defect, the newly exposed path is in scope: report it as `Introduced by PR: yes`, name the changed line that opens the path, and give the fix at the shared code.

## Mental Checklist:

- **Authentication & Authorization / Tenant Isolation**:
  - Do new or modified endpoints enforce authentication and the project's permission model (auth middleware, guards, policy checks)?
  - Object-level access: does a lookup by ID check that the caller owns or may access that object?
  - If the app is multi-tenant: is tenant/workspace isolation respected? Can a user from Tenant A access or mutate resources of Tenant B?
- **Input Validation & Injection**:
  - Are all incoming parameters (body, query, headers) validated with the project's validation approach (schema validators, typed request models)?
  - Query injection: can a request value reach a SQL/NoSQL/ORM query unparameterized? Can it arrive as an object or array instead of a scalar and change a filter's meaning? Are user-built regexes or query operators used with user input?
  - Mass assignment: is a request body spread or passed whole into a create/update call, so a client can set `role`, tenant, ID, or ownership fields?
  - Are shell commands, regexes, or dynamic evaluations safe from injection (ReDoS, command injection)?
  - Are outbound requests built from user-supplied URLs or hosts (SSRF: internal addresses, redirects)?
- **Frontend (web, if the diff touches it)**:
  - Raw HTML injection (`innerHTML` and the framework's equivalents, sanitizer bypasses), dynamic `href`/`src` from data (`javascript:` URLs), `window.open` or `postMessage` without origin checks, direct DOM writes.
  - Tokens or sensitive data placed in `localStorage`, URLs, or logs.
  - Client-side checks used as the only permission control: if the frontend gates a function by permission or role, does the backend call enforce the same rule?
- **Sessions, Tokens & Transport**:
  - Token/session handling (e.g. JWT): signature and expiry verified, algorithm pinned, no secrets in the payload, safe cookie flags (`HttpOnly`, `Secure`, `SameSite`).
  - CORS origins and credentials: no wildcard origin with credentials, no reflected `Origin`.
  - State-changing endpoints reachable by cookie auth without CSRF protection.
- **Dependencies & Config**:
  - Added or bumped dependencies in the manifest / lockfile (npm, pip, Cargo, Maven, NuGet, etc.): unknown or typosquat names, install scripts, unpinned git URLs.
  - New env vars, config defaults, or debug flags that weaken production security.
  - New hooks, `env` entries, MCP servers, or looser permissions in agent/tool config (`.claude/`, `CLAUDE.md`, `AGENTS.md`): they run with the developers' rights.
- **Data Exposure & Secrets**:
  - Are passwords, tokens, API keys, or sensitive PII leaked in logs, error responses, or git commits?
  - Are sensitive model fields omitted or masked before being sent to the client?
- **File & Path Safety**:
  - Are file uploads, paths, and downloads validated against path traversal (`../`) and unauthorized MIME types?
