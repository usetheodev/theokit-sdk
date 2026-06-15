# Blueprint — Decorator-driven workflow (cross-val Gap 2, narrowed)

**Date:** 2026-06-15 · From cross-validation Gap 2 ("no event-driven decorator-style workflow").

## Finding (DISCOVER — 4th gap to narrow)
The capability already exists: `@theokit/sdk` `Workflow` is an imperative engine with `.then/.branch/.parallel/.foreach/.dowhile` — it covers sequential, branching, fan-out, and looping orchestration (more shapes than a linear listen-graph). The reference (crewAI Flow) adds a DAG authoring DSL (`@start`/`@listen`/`@router` + `and_`/`or_`) — but that is an authoring STYLE over the same capability theokit's Workflow already provides imperatively.

The existing di-agent `@Workflow` decorator is a CLASS marker only (stores options metadata) — there is NO method-level step decorator. So the genuine residual is an ergonomic, decorator-driven authoring surface.

## Decision (ADR-style)
- Ship a method decorator **`@Step({ after?, name? })`** (own identity — NOT crewAI's `@start`/`@listen`) + a materializer **`buildWorkflow(instance)`** that COMPILES the decorated class into a `@theokit/sdk` `Workflow` (composition — zero new orchestration engine, same principle as `createSquad`).
- MVP = **sequential chain**: `after` declares a single upstream dependency; steps are topologically ordered into a linear `Workflow.then(...)` chain, threading each step's return value to the next. Branching/fan-out remains the imperative `Workflow.branch/parallel` surface (not duplicated).
- Decorator stays metadata-only (consistent with all di-agent decorators). The materializer is a separate bridge module that imports the `@theokit/sdk` peer (`Workflow`, `fn`) — acceptable: sdk is already a peer dep and di-agent tests import it.
- Validation (fail-fast): no `@Step` methods → error; unknown `after` target → error; cycle in `after` graph → error.

## Coverage corners
- Integration: `buildWorkflow(instance).run(input)` runs the decorated methods in `after`-order, threading outputs; the run is a real `WorkflowRun`.
- Dependencies: none new (reuses Workflow + fn + reflect-metadata + ConfigurationError-style errors).
- Tools: n/a.
- Techniques: composition-over-reimplementation (DRY); decorator-driven DX; topological order; fail-fast.

## References
- crewAI: `.claude/knowledge-base/reference/crewAI/lib/crewai/src/crewai/flow/flow.py` (@start/@listen/@router DAG — inspiration; engine NOT copied)
- In-repo engine to reuse: `packages/sdk/src/workflow.ts` (`Workflow`, `fn`, `agentStep`)
- Existing class marker: `packages/di-agent/src/decorators/workflow.ts` (`@Workflow`)
- Decorator pattern: `packages/di-agent/src/decorators/sub-agent.ts`
