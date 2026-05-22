# D235 — Persistence default is in-memory; JSON opt-in via `persistence: { backend: "json", dir }`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Default snapshot store is `InMemoryWorkflowSnapshotStore` (a `Map<runId, snapshot>`). Users opt-in to filesystem persistence via `Workflow.create({ persistence: { backend: "json", dir: ".theokit/workflows" } })`, which uses `atomicWriteJson` + `readVersionedJson` from `internal/persistence/` (D59-D64).

## Rationale

Most workflows run in-process and die with the process (test runs, scripts, ephemeral compute). Forcing disk writes would kill DX. JSON is the simplest disk format that requires no native deps. SQLite/Postgres backends ship in v1.1 behind the same `WorkflowSnapshotStore` interface (D143 pattern).

## Consequences

- `Workflow.resume({ runId })` throws `WorkflowSnapshotNotFoundError` if persistence is unconfigured and the process restarted.
- JSON-only snapshots (D235 + EC-4) means non-serializable values (BigInt, circular refs, class instances with cycles) fail at suspend time with a typed error.
- Backend abstraction is `interface WorkflowSnapshotStore { save / load / delete / list }` — easy to extend.
