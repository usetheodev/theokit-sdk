# D230 — `Workflow` is a static class with `Workflow.create({...})` factory + `.run()` method

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`Workflow` is exposed as a class with a private constructor. `Workflow.create(options)` validates options via Zod and returns a `WorkflowBuilder`. After chainable DSL calls, `.commit()` returns an immutable `Workflow` instance. `Workflow#run(input, opts?)` returns `Promise<WorkflowRun>`. `Workflow.resume(opts)` is a static method.

## Rationale

Consistent with five other public façades — `Agent.create`, `Eval.create` (D202), `Handoff.create` (D222), `Cron.create`, `Memory.create` — all use static factory + private constructor. Breaking consistency would be expensive to standardize later. `.commit()` is the only concession to Mastra; required because the builder chain is mutable during DSL phase.

## Consequences

- Type-tests are trivial: `expectError<WorkflowBuilder>(w.run())`.
- Builder is not exposed directly — only via `Workflow.create()`.
- Workflow is immutable after commit; modifications require a fresh `Workflow.create`.
- `.resume` static mirrors `Agent.resume` ergonomics.
