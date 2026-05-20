# D141 — `MemoryAdapter` is a formal typed interface

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Narrow `MemoryProviderFactory` return type from `unknown` to
`MemoryAdapter | Promise<MemoryAdapter>`. `MemoryAdapter` lives in
`packages/sdk/src/types/memory-adapter.ts` with companion types
`MemoryContext`, `MemoryFact`, `MemoryId`, `MemoryRevision`,
`MemoryAdapterCapabilities`. New `MemoryAdapterError` extends
`TheokitAgentError`.

`MemoryId` is a branded string: `${adapterId}:${rawId}`. Helpers
`mkMemoryId(provider, raw)` + `extractRawId(id, expected)` enforce
prefix integrity (EC-B): a `mem0` adapter calling
`extractRawId(supermemoryId, "mem0")` throws `invalid_input`.

## Rationale

The `unknown` return was explicitly a forward declaration ("full
Memory plugin support is out of scope" — `types.ts:65-71`). Typing
it now unblocks third-party adapter packages without breaking
existing callers (no one ships a `kind: "memory"` plugin today).

Capabilities are declared statically (`history`, `sessions`,
`tenancy`, `reasoning`, `toolSchemas`, `prefetch`) so consumers
feature-detect at compile time:

```ts
if (adapter.capabilities.history) {
  await adapter.history!(id);  // narrowed
}
```

## Consequences

- **Enables:** type-safe adapter implementations + consumer
  introspection + Cross-adapter `MemoryId` rejection.
- **Constrains:** future shape changes to `MemoryAdapter` are
  major-version bumps. Optional methods stay optional to allow
  capability evolution without breaking the union.
