# D352 — ACP session lifecycle maps 1:1 to SDK `agentId`

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

ACP defines `new_session`, `load_session`, `resume_session`, `fork_session`, `cancel`. Our SDK has parallel primitives: `Agent.create`, `Agent.resume`, `agent.fork()`, lifecycle abort.

## Decision

ACP `sessionId` === SDK `agentId`. `new_session` → `Agent.create`. `load_session` → `Agent.resume({ agentId: sessionId })`. `cancel` → `lifecycleAbortController.abort()`. `fork_session` → `agent.fork()`.

## Rationale

We already have all four primitives shipped (D304-D325 for storage, D110-D114 for fork, D319 for lifecycle abort). Reusing them avoids parallel state machines and means upstream SDK improvements flow through ACP automatically.

## Consequences

- Callers wanting different mapping can use a factory: `agent: (sessionId) => Agent.resume({ agentId: customMap(sessionId) })`.
- Documented in README.
- Means our `agentId` is exposed to ACP clients — that's fine (UUIDs, no PII).
