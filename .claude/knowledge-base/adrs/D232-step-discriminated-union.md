# D232 — `Step` is a discriminated union by `kind`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`Step` is `FnStep | AgentStep | ParallelStep | BranchStep | ForeachStep | DowhileStep | SleepStep | SuspendStep`, discriminated by literal `kind` field. Each variant has only the fields it needs.

## Rationale

Pattern established in this codebase: `Plugin` (D98), `GoalEvent` (D115), `SDKMessage`. Wide-optional interface (all 12 fields optional) loses type safety; discriminated union enforces exhaustive switch handling. TypeScript's `never` exhaustiveness check catches missed kinds at compile time.

## Consequences

- Executor switch must handle all kinds or fail compile.
- Adding a new kind = new variant + new case (non-viral; localized).
- Tests can snapshot per kind without runtime guards.
- Helper factory functions (`fn()`, `agentStep()`) hide the `kind` field from end users.
