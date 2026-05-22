# D217 — Handoffs are peer-to-peer (not parent-child)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Receiver takes ownership of the next turn. The sender does NOT wait for
"completion" or receive a return value — once handed off, the receiver is
the new owner of the conversation. Differs from `Agent.fork()` (D110-D114)
which is parent-child with a return value.

## Rationale

- Clean responsibility split — each agent has full ownership during its turn.
- Mirrors OpenAI Agents semantics.
- Avoids "where did the response come from?" ambiguity that subagent /
  fork patterns can create.

Alternatives rejected:

- **Parent waits for receiver and continues** — that's `fork`. Don't duplicate.
- **Receiver returns to sender after one turn** — adds routing graph
  complexity; deferred to v2 if real demand emerges.

## Consequences

- Enables clean per-agent ownership semantics.
- Constrains: no "come back to sender" in v1; callers wanting that pattern
  add the sender back as a handoff on the receiver.
