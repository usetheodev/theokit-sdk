# D79 — `internal/security/path-guard.ts` canonical module

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D65, D66, D68, plan `security-block-completion-plan.md`

## Decision

A single module `packages/sdk/src/internal/security/path-guard.ts` exports
the only canonical APIs for joining user-supplied input with a path or
validating an identifier:

- `safePathJoin(base, ...parts)` — resolve then prefix-check (D80).
- `assertNoSymlinkEscape(path, base)` — `realpathSync`-based chain
  resolution (EC-1 fix).
- `sanitizeIdentifier(input, { maxLen })` — strict grammar (D81).
- `PathTraversalError extends ConfigurationError` with code
  `"path_traversal"` (D65 — no new error hierarchy).

Wired via `internal/security/index.ts` barrel. Lint gate
`tests/lint/no-unguarded-path-input.test.ts` (D85) prevents regression.

## Rationale

Pre-T3, the codebase had 17+ `join(cwd, ".theokit", ...)` callsites with
divergent inline defenses (some checked `..`, some `isAbsolute`, some
none). Hermes shipped and fixed 7+ path-traversal vectors (v0.2 #220
#65 #192 #63 #386 #61, v0.5 #3250 zip-slip, v0.7 #4318 tar zip-slip,
v0.13 #21228 SSRF). Centralization means 1 point to harden when a new
vector appears.

## Consequences

- **Enables:** uniform defense across all path callsites; future audits
  read one module.
- **Constrains:** callers MUST import from the barrel; lint test gates
  regression.
