# D375 — `Budget` is a static class with private constructor

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

`Agent`, `Cron`, `Workflow`, `Eval`, `Task` already follow the static-class-with-private-constructor pattern.

## Decision

`Budget` is a static class: `Budget.create / list / get / delete / snapshot`. Private constructor throws on instantiation.

## Rationale

Consistency across the public API surface.

## Consequences

Mirrors D361 (Task), D202 (Eval), D194 (Cron). Caller uses `import { Budget } from "@theokit/sdk"`.
