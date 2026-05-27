# D361 — `Task` is a static class with private constructor

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

The SDK already exposes domain primitives as static classes with private constructors: `Agent`, `Cron`, `Workflow`, `Eval`. Each has `create()` / `register()` / `run()` static methods and rejects `new Agent()` calls. This is a convention.

## Decision

`Task` follows the same shape: `export class Task { private constructor() { throw new Error("Task is static; do not instantiate"); } static submit(...), static list(...), static get(...), static cancel(...), static subscribe(...), static configure(...) }`.

## Rationale

- Consistency across the public API — caller doesn't need to learn a new instantiation pattern.
- Singleton-by-convention — the global `TaskRegistry` is hidden behind the static class.
- Avoids the question "should I share a Task instance?" — there is no instance.

## Consequences

- Caller cannot inject a custom TaskRegistry. Configuration is via `Task.configure()`.
- Testability requires `__resetTaskRegistryForTests()` helper exposed from `internal/task/registry.ts`.
- Mirrors D202 (Eval class factory), D193-D195 (CLI as workspace package + named bin).
