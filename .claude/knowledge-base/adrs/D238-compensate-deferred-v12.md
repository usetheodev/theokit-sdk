# D238 — Saga compensation is opt-in via `compensate?` per step, **DEFERRED to v1.2**

**Date:** 2026-05-22
**Status:** Accepted (slot reserved; engine not implemented)

## Decision

`FnStep.compensate?: (input, output, error) => Promise<void>` is reserved in the interface but NOT implemented by the executor in v1. If passed, the executor throws `NotImplementedError` with a clear message pointing to v1.2 roadmap.

v1.2 will implement LIFO compensation (Temporal-shape): on fatal error mid-workflow, traverse `compensations: Array<() => Promise<void>>` in reverse insertion order and run each inside a `nonCancellable` scope.

## Rationale

Saga is a real gap in all 4 reference projects (Mastra, Inngest, LangGraph, Temporal-TS) — only Temporal-Java has it as a first-class primitive. Shipping it correctly is non-trivial (parallel branches with partial compensation, branch step whose compensation depends on the matched path). v1 ships without saga = reaches parity. v1.2 ships with saga = differentiates.

## Consequences

- API signature is stable; users can write `compensate` callbacks today as documentation but get a runtime error.
- Forward-compat: when v1.2 enables, no API change required.
- EC-A absorbed: `compensate?: undefined` is equivalent to omitted — no throw.
- Docs.md explicitly labels saga as "v1.2 preview, throws NotImplementedError today".
