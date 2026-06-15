---
slug: decorator-workflow
created_at: 2026-06-15
milestone_id: none
goal: Ship a decorator-driven workflow authoring surface (@Step + buildWorkflow) that compiles a decorated class into a @theokit/sdk Workflow, closing the ergonomic residual of cross-val Gap 2 without duplicating the workflow engine.
---

# Plan: Decorator-driven workflow (cross-val Gap 2, narrowed)

> **Version 1.0** — DISCOVER showed Gap 2 ("no event-driven decorator-style workflow") is an authoring-style residual: `@theokit/sdk` `Workflow` already orchestrates sequential/branching/fan-out/looping imperatively. This adds a `@Step` method decorator + a `buildWorkflow` materializer that COMPILES a decorated class into a `Workflow` (composition — zero new engine, same principle as `createSquad`). Own identity (`@Step`, not crewAI's `@start`/`@listen`).

## Goal

> "A developer can author a workflow as decorated methods, measured by: (a) `@Step()`/`@Step({ after })` on class methods declares steps + their single upstream dependency; (b) `buildWorkflow(instance)` returns a `@theokit/sdk` `Workflow` that, when run, executes the methods in `after`-topological order threading each return value to the next; (c) it compiles to the existing `Workflow` engine (no duplicate orchestration); (d) invalid declarations (no steps / unknown `after` / cycle) fail fast with a clear error."

## Context / Baseline (current state)

| File | Role | Invariant to preserve |
|---|---|---|
| `packages/sdk/src/workflow.ts` | `Workflow.create()`, `fn()`, `agentStep()` — the engine | reuse as-is; do NOT modify |
| `packages/di-agent/src/decorators/workflow.ts` | `@Workflow` class marker (options metadata) | reuse for the workflow name/options |
| `packages/di-agent/src/decorators/sub-agent.ts` | reflect-metadata decorator pattern | mirror for `@Step` |
| `packages/di-agent/src/agent-provider.ts` | structural bridge precedent | mirror the bridge approach |
| `packages/di/src/internal/metadata.ts` | `METADATA_KEYS` | add `STEP` key |

Already covered (NOT rebuilt): sequential/branching/fan-out/looping orchestration (`Workflow`).

## Drawbacks & Risks

- **Materializer imports the sdk peer:** di-agent decorators are metadata-only by convention. Mitigation: the decorator stays metadata-only; only the SEPARATE `workflow-builder.ts` bridge imports `@theokit/sdk` (a peer dep already imported by di-agent tests) — documented.
- **Scope creep toward a DAG engine:** crewAI Flow has router/and_/or_. Mitigation: MVP is a LINEAR chain via single `after`; branching stays the imperative `Workflow.branch/parallel` surface. No router/join engine.
- **Risk of duplicating Workflow:** Mitigation — `buildWorkflow` MUST delegate to `Workflow`+`fn`; a test asserts the produced object is a real `Workflow` whose `.run()` returns a `WorkflowRun`.

## Tasks

### Task 1 — `@Step` method decorator + `readStepMetadata` (TDD)
- #### Why this step: the decorator is the authoring surface; metadata-only keeps di-agent's convention + satisfies the decorator mandate (Rule 9).
- #### TDD: `test_Step_stores_metadata` (decorate methods, read back order + after); `test_Step_defaults_after_undefined`; `test_supports_multiple_steps`; `test_empty_for_undecorated`. Add `METADATA_KEYS.STEP` to `@theokit/di`.
- #### Acceptance: `@Step({ after?, name? })` stores `Map<methodKey, { after?, name? }>` via reflect-metadata; `readStepMetadata(class)` returns it.

### Task 2 — `buildWorkflow(instance)` materializer composing Workflow (TDD)
- #### Why this step: makes the decorator real/wired (no-unwired-code rule) by compiling steps into the existing engine (DRY).
- #### TDD: `test_buildWorkflow_runs_steps_in_after_order_threading_output` (decorated class with 3 steps a→b→c; run, assert each method receives prior output, final result = last); `test_buildWorkflow_rejects_no_steps`; `test_rejects_unknown_after`; `test_rejects_cycle`; `test_run_is_a_WorkflowRun` (status/steps shape from the engine).
- #### Acceptance: `buildWorkflow(instance)` reads `@Step`/`@Workflow` metadata, topo-orders by `after` (linear chain), returns a committed `@theokit/sdk` `Workflow`; `.run(input)` threads outputs; invalid declarations throw a clear error before building.

### Task 3 — Docs + CHANGELOG
- #### Why this step: new public API → docs.md (source of truth) + CHANGELOG (Rule 6).
- #### Acceptance: docs.md "Decorator-driven workflows (`@Step` + `buildWorkflow`)" subsection noting it compiles to `Workflow` and that branching = imperative `Workflow`; `packages/di-agent/CHANGELOG.md` + `packages/di/CHANGELOG.md` + root CHANGELOG `[Unreleased] § Added`.

## Coverage Matrix

| Goal claim | Task |
|---|---|
| `@Step`/`@Step({after})` declares steps + dependency | T1 |
| buildWorkflow runs methods in after-order threading outputs | T2 |
| compiles to the existing Workflow engine (no duplicate) | T2 |
| invalid (no steps / unknown after / cycle) fails fast | T2 |
| decorator surface (mandate) | T1 |
| docs + changelog | T3 |

## Test Plan
- Unit: `@Step` metadata round-trip (T1) — di-agent package config (reflect-metadata).
- Unit/integration: `buildWorkflow` ordering + threading + validation with a fake decorated class (no real LLM) (T2).
- Composition proof: produced object is a `Workflow`; `.run()` returns a `WorkflowRun` (status/steps).
- Regression: di-agent + di + sdk workflow suites green.

## Unresolved Questions
- (none for MVP) — fan-out/router/join intentionally deferred to the imperative `Workflow.branch/parallel`; `after` is a single upstream dependency (linear chain).

## Prior Art
- In-repo: `createSquad` (composition-over-engine precedent), `Workflow`+`fn` (engine), di-agent decorators (metadata pattern), `agent-provider` (structural bridge).
- Reference: crewAI Flow `@start`/`@listen`/`@router` (authoring inspiration; engine NOT copied).

## Rationale & Alternatives
- **Chosen:** `@Step` + `buildWorkflow` compiling to `Workflow`. DRY, KISS, own identity, decorator mandate.
- **Rejected:** a new event-driven DAG engine (router/and_/or_) — duplicates `Workflow` (DRY/YAGNI/"don't reinvent").
- **Rejected:** copying `@start`/`@listen`/`Flow` names — identity requirement (no competitor naming).
