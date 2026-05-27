# D364 — `TaskStore` is pluggable (InMemory default + JsonFile opt-in)

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

`WorkflowSnapshotStore` (D235) already provides the pattern: an interface + 2 implementations (InMemory default, JsonFile opt-in). Reproducing the same shape avoids inventing a new persistence model for Tasks.

## Decision

- `interface TaskStore { insert, update, get, list, delete, evictTerminalOlderThan }`.
- `InMemoryTaskStore` is the default; `JsonFileTaskStore` opt-in via `Task.configure({ store: { backend: "json", dir } })`.
- SQLite cross-process backend is deferred to v0.2.

## Rationale

- Mirrors D235 (Workflow snapshot store) — zero new mental model.
- SQLite adds a peer dependency + file-lock complexity (D61) for a use case (multi-process observability) that is not core in v1.
- JsonFile single-process is enough for a single bot/CLI/process scenario, which is the dominant SDK use today.

## Consequences

- v1 ships without cross-process safe writes from multiple processes (single-process invariant documented).
- v0.2 will add `SqliteTaskStore` behind the same interface — caller migration is reconfiguration only.
- `Task.configure()` semantics must honor `EC-13` (no-op after first submit + stderr warn).
