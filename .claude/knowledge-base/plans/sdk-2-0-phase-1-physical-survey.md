---
slug: sdk-2-0-phase-1-physical-survey
artifact: extraction-survey
created_at: 2026-06-08
parent: sdk-2-0-phase-1-2-adr.md
purpose: Map the Phase 1 (Memory) physical source extraction blast radius before attempting the move
---

# Phase 1 physical extraction — pre-move survey

After iter 18 shipped `MemoryProvider` interface inversion + `@theokit/sdk-memory@0.1.0`
(cohort-ready), the remaining work is the **physical source move** of
`internal/memory/*` (6613 LOC) out of `@theokit/sdk` into the new
package. ADR-001 listed 4 kernel runtime consumers — survey iter 18+
finds **10 kernel runtime files** import from `internal/memory/*`
(dependency surface grew since ADR-001).

## Scope

- `internal/memory/*` directory: **6613 LOC** (was 4070 in ADR-001 — grew during iter intervals).
- Subsystems inside: `active-memory*`, `circuit-breaker`, `index-*`,
  `lance-*`, `memory-index`, `embedding-*`, `dreaming/`, `storage/`,
  `adapters/`, `migrate-sqlite-to-lance`, `tools.ts`, `types.ts`.

## Kernel runtime files importing `internal/memory/*` (iter 18+ grep)

```
packages/sdk/src/internal/runtime/local-agent-memory.ts
packages/sdk/src/internal/runtime/local-agent-dispatch.ts
packages/sdk/src/internal/runtime/local-agent.ts
packages/sdk/src/internal/runtime/local-run.ts
packages/sdk/src/internal/runtime/local-agent-runtime-extensions.ts
packages/sdk/src/internal/runtime/memory-provider-noop.ts  ← new from iter 18 T1.2
packages/sdk/src/internal/runtime/post-run-lifecycle.ts
packages/sdk/src/internal/runtime/memory-store.ts
packages/sdk/src/internal/runtime/fixtures/fixture-types.ts
packages/sdk/src/internal/runtime/fixtures/fixture-scripts.ts
```

10 files (vs. 4 documented in ADR-001). Most touch the hot path of the
agent loop directly or indirectly.

## Public-API blast radius

`src/memory.ts`, `src/migrate.ts`, `src/theokit.ts` all import from
`internal/memory/*`. These are top-level exports — `Memory` class,
`migrateSqliteToLance`, `Theokit` namespace.

## Why the move is multi-iter

Per ADR-003: moving `internal/memory/*` to sdk-memory and having the
kernel runtime files import from `@theokit/sdk-memory` creates a
kernel → extension dependency, which violates the layer direction. The
ONLY way to do this cleanly is to refactor every kernel call site to
use the `MemoryProvider` port (already shipped iter 18 T1.1) instead
of importing from `internal/memory/*` directly.

That refactor:

1. Add port methods covering everything the 10 kernel files use today.
2. Migrate each kernel file from direct-import to port-call (10 PRs OR
   one big PR per file group).
3. Move source files to sdk-memory.
4. Ship sdk-memory's rich impl satisfying the expanded port surface.

The expanded port surface includes:
- `runActiveMemory(...)` (currently from `internal/memory/active-memory.ts`)
- `ActiveMemoryCache` (currently from `internal/memory/active-memory-cache.ts`)
- `EmbeddingRuntime` (currently from `internal/memory/embedding-adapter.ts`)
- `IndexManager` (currently from `internal/memory/index-manager.ts`)
- `MemoryIndex` (currently from `internal/memory/memory-index.ts`)
- `createMemoryGetTool`, `createMemorySearchTool` (currently from
  `internal/memory/tools.ts`)
- `MEMORY_EMBEDDING_ADAPTERS` (currently from `internal/memory/...`)
- `CircuitBreaker` (currently from `internal/memory/circuit-breaker.ts`)
- `writeSessionSummary` (currently from `internal/memory/dreaming/`)
- `markdown-store` operations (currently from
  `internal/memory/storage/markdown-store.ts`)
- `migrateLegacyJson` (currently from `internal/memory/migration.ts`)

That's a meaningful port API expansion (~12 new methods/types). Not a
single-iter project.

## Strategy recommendation — REVISED iter 19

The original survey recommendation ("expand the port surface with 12+
new methods") was wrong-headed. Closer inspection of the 3 kernel
files that actually import from `internal/memory/*` (not 10 — most
others use the intermediate `memory-store.ts` kernel file):

| Kernel file | actual internal/memory imports |
|---|---|
| `local-agent-memory.ts` | 8 symbols — runActiveMemory, ActiveMemoryCache, MEMORY_EMBEDDING_ADAPTERS, CircuitBreaker, EmbeddingRuntime, IndexManager, MemoryIndex, createMemory{Get,Search}Tool |
| `post-run-lifecycle.ts` | writeSessionSummary |
| `memory-store.ts` | migrateLegacyJson |

`LocalAgentMemory` exposes 3 public methods that ALREADY map 1:1 to
the existing `MemoryProvider` port surface:

| LocalAgentMemory method | Maps to MemoryProvider |
|---|---|
| `ensureTools()` | `provider.buildTools(handle, agent)` |
| `runActiveMemoryIfEnabled()` | `provider.runActivePass(handle, args)` |
| `syncIfReady()` | **NEW** `provider.sync(handle)` — iter 19 shipped |

This means the port already covers 95% of what the kernel needs. The
12-method "expand the port" plan was a strawman.

### Revised stages

**Stage 1 (iter 19 — shipped):** Add optional `sync(handle)` method to
`MemoryProvider` port. Wire in agent-loop post-run path (gated on
`finalStatus === "finished"`). sdk-memory's `createInMemoryMarkdownProvider`
implements as no-op (LanceDB-backed impl in future will fire
`IndexManager.sync()`). 6 new tests; back-compat preserved
(existing impls without `sync` keep working — TS optional method).

**Stage 2 (split into 2a + 2b):**
- **2a (iter 19 — SHIPPED):** ship `createLocalAgentMemoryProvider`
  adapter wrapping `LocalAgentMemory` as a MemoryProvider impl. Bridges
  legacy + port paths. 9 tests; `buildTools` initially returned [] (gap).
- **2b (iter 19 — SHIPPED partial):** close the buildTools gap by
  adding `LocalAgentMemory.getCachedTools()` sync accessor that the
  adapter reads. Adapter now surfaces the rich `memory_search` +
  `memory_get` tools via `buildTools()` with shape translation
  (`MemoryToolSpec.execute` → `CustomTool.handler`).
- **2b proper (DEFERRED — next iter):** refactor `LocalAgent.send()`
  to auto-install the adapter as `inputs.memoryProvider` (when consumer
  didn't supply one) + skip the legacy `memoryGlue.ensureTools()` +
  `memoryGlue.runActiveMemoryIfEnabled()` direct calls. Risk: timing
  + ordering of memoryTools + systemPromptAdditions injection
  differs between legacy and port paths. Needs careful equivalence
  testing under `options.memory.enabled === true`.

**Stage 3:** Move `internal/memory/*` sources to
`packages/sdk-memory/src/`. Ship sdk-memory's LanceDB-backed rich
provider (current `createInMemoryMarkdownProvider` is the foundation).
Update `post-run-lifecycle.ts` + `memory-store.ts` to use the
optional-peer pattern.

**Stage 4:** Drop the public `Memory` class + `migrateSqliteToLance`
re-exports from sdk-core via optional-peer pattern (mirrors
sdk-handoff iter 6).

Total: ~3 focused iterations on top of iter 19. Each stage is
shippable independently.

## Honest assessment

Iter 18 closed the FAANG-style interface inversion (the hard
architectural decision). The physical source move is the bundle-size
cleanup — straightforward but multi-step. The next iteration MUST
start with Stage 1 (port surface expansion); skipping it risks
re-introducing the ADR-003 violation that motivated the inversion in
the first place.

Do NOT attempt without a fresh focused session; the kernel hot-path
risk is highest of any extraction in the SDK 2.0 plan.
