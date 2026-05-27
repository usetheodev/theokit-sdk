# D351 — `serveAcp({ agent })` accepts a factory function for per-session isolation

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

ACP `new_session` creates a fresh session with its own conversation history. A single shared `SDKAgent` across sessions would leak history between users in the same process.

## Decision

`serveAcp({ agent })` accepts EITHER an `SDKAgent` instance (single-tenant, memoized) OR a factory function `(sessionId: string) => Promise<SDKAgent>` (per-session isolated).

## Rationale

Forces callers to think about per-session isolation. Backward-compatible — single agent is still expressible. When a single instance is passed, the resolver warns ONCE to stderr that this defeats per-session isolation and memoizes it for all subsequent sessions.

## Consequences

- Public API includes `AgentFactory = (sessionId: string) => Promise<SDKAgent>` type.
- `resolveAgentFactory()` internal helper normalizes both shapes.
- Factory error → ACP `internal_error` with message; session NOT inserted into store.
- Documented in README + concept page.
