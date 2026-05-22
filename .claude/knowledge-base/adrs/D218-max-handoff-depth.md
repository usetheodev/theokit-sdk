# D218 — Max handoff depth = 5 per `send()` call (configurable)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

A single `agent.send()` invocation can chain at most **5 handoffs** by
default. Exceeding throws `HandoffLoopError(depth, chain)`. Override via
`Agent.create({ maxHandoffDepth: N })`.

## Rationale

- Without a cap, ping-pong loops (A→B→A→B…) burn tokens infinitely.
  CrewAI's 2026 hierarchical-process bug is exactly this.
- 5 is enough for triage → specialist → escalation flows; not enough to
  bankrupt the caller.
- Configurable for legitimate deep chains; default is safe.

## Consequences

- Enables safe production deployment.
- Constrains: complex multi-hop flows must explicitly raise the cap;
  default protects naive users.
