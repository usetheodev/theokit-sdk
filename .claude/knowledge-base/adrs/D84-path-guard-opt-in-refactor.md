# D84 — Path-guard wiring is opt-in via explicit refactor

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D79, D85, plan `security-block-completion-plan.md`

## Decision

Path-guard adoption at each callsite is an explicit refactor visible in
`git blame`. No monkey-patching of `node:path.join` or `node:path.resolve`.
No proxy module that auto-wraps `node:path`.

Each callsite is either:

1. Refactored to use `safePathJoin` / `sanitizeIdentifier` (preferred
   when user input is involved).
2. Audited and added to the lint allowlist (`ALLOWLIST` in
   `tests/lint/no-unguarded-path-input.test.ts`) with rationale —
   filesystem-controlled inputs, literal-only joins, etc.

## Rationale

Monkey-patches are invisible to debugger, hide intent from
`git log -p`, and create surprising failure modes when the wrapper is
swapped at module load time. Explicit refactor:

- Makes the security decision visible at every site (review-friendly).
- Allows fine-grained allowlisting (some paths legitimately use
  `node:path.join` because the inputs are already FS-controlled).
- Survives codebase reorganizations cleanly.

## Consequences

- **Enables:** auditable security posture at every callsite.
- **Constrains:** 17+ existing callsites require explicit decisions;
  mitigated by grouping refactors by module (memory/, runtime/, mcp/).
