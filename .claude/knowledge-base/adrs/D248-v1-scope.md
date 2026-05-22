# D248 — Initial v1 scope: 7 primitives, no saga, no cloud, JSON persistence

**Date:** 2026-05-22
**Status:** Accepted

## Decision

v1 ships:
- 7 control-flow primitives: `.then`, `.parallel`, `.branch`, `.foreach`, `.dowhile`, `.sleep`, `.suspend`.
- 2 persistence backends: `InMemoryWorkflowSnapshotStore` (default) + `JsonFileWorkflowSnapshotStore` (opt-in).
- Retry policy (D237) on `FnStep` and `AgentStep`.
- OTel telemetry (D241).
- AbortSignal cancellation at boundaries (D245).

v1 does NOT ship:
- Saga compensation engine (D238 — slot reserved, throws NotImplementedError).
- `CloudAgent` workflow steps (D244 — throws UnsupportedRunOperationError).
- SQLite/Postgres persistence backends (v1.1).
- Cron-trigger integration (`Cron.create({ workflow })`) (v1.x).

## Rationale

7 primitives match Mastra parity. Saga + cloud + extra backends + cron defer until demand evidence. KISS first ship; iterate based on real workflow patterns observed.

## Consequences

- Documented v1 scope prominently in `docs.md`.
- Roadmap entries v1.1+ rastreados em CLAUDE.md.
- API forward-compat: adding the deferred features later doesn't change the v1 surface.
