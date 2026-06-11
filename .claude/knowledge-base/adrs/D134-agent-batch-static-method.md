# D134 — `Agent.batch(prompts, options)` is a static method on the façade

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`Agent.batch(prompts, options)` lives on the existing `Agent` static façade,
mirroring `Agent.prompt` / `Agent.streamObject` / `Agent.generateObject`. It
fans out N prompts via bounded concurrency, creating and disposing one agent
per prompt internally, and returns `Promise<BatchResult[]>`.

Implementation in `packages/sdk/src/batch.ts:batchImpl`; façade wraps via
`async import("./batch.js")` so consumers that never call `batch` don't pay
the import cost.

## Rationale

The pattern is already established for static one-shot operations
(`prompt`, `generateObject`, `streamObject`). A caller wanting N parallel
prompts should reach for the next method on the same surface, not a new
namespace.

Constraints we did NOT pick:
- Standalone module (`@theokit/sdk/batch`): worse discoverability.
- Method on a constructed `Agent` instance: would tempt callers to reuse
  a single agent across prompts, breaking session isolation (D138).
- Free function on `Theokit` namespace: misaligned with the agent-mental-model
  (Theokit is account / catalog, Agent is execution).

## Consequences

- **Enables:** discoverable on `Agent` namespace; consistent with existing
  facade; TypeScript autocomplete surfaces it next to `prompt`.
- **Constrains:** caller cannot reuse a single agent across prompts —
  by design per D138 isolation.
