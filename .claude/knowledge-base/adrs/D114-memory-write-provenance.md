# D114 — Memory write provenance via `metadata.forkOrigin`

**Date:** 2026-05-19
**Status:** Accepted

## Decision

`AgentOptions.metadata?: Record<string, unknown>` is a new optional
field. `forkAgentImpl` sets `metadata.forkOrigin: string` (default
`"fork"`, override via `ForkOptions.forkOrigin`) and
`metadata.parentAgentId: string` on the auxiliary agent's options.

Memory plugins consume these fields when writing memories so the user
can later see which fork (curator, background review, judge) created
which memory entry.

## Rationale

Without provenance, a fork that writes 3 memories during a background
review is indistinguishable from 3 user-confirmed memories. Undo
becomes a guess. Hermes uses `_memory_write_origin = "background_review"`
on the AIAgent instance; SDK ports the same idea via a structured
metadata bag.

## Consequences

- **Enables:** UIs can show "These 3 memories were created by
  `forkOrigin: curator` — undo all?" Fork-aware audit trails.
- **Constrains:** `AgentOptions.metadata` is wide-open `Record<string,
  unknown>`. Memory layer reads only the known fields; unknown fields
  are ignored.
