---
slug: sdk-2-0-phase-1-stage-3-source-move-plan
artifact: stage-3-move-plan
created_at: 2026-06-08
parent: sdk-2-0-phase-1-physical-progress.md
purpose: Concrete file-by-file plan for moving `internal/memory/*` from sdk-core to sdk-memory
---

# Phase 1 physical Stage 3 — source move plan

After iter 24 closed Stage 2b kernel flip + full integration proof,
the next physical step is moving `internal/memory/*` source files
from sdk-core to `@theokit/sdk-memory`. This doc enumerates EVERY
file with its move-decision.

## Source inventory (38 files)

### Embedding adapters (8 files) — MOVE to sdk-memory

| File | LOC est. | Decision | Rationale |
|---|---|---|---|
| `adapters/catalog.ts` | small | MOVE | Re-export hub for the 7 provider adapters |
| `adapters/deepinfra-embedding.ts` | medium | MOVE | DeepInfra provider |
| `adapters/mistral-embedding.ts` | medium | MOVE | Mistral provider |
| `adapters/ollama-embedding.ts` | medium | MOVE | Ollama provider |
| `adapters/openai-compatible.ts` | medium | MOVE | Shared base for OpenAI-compatible APIs |
| `adapters/openai-embedding.ts` | medium | MOVE | OpenAI provider |
| `adapters/openrouter-embedding.ts` | medium | MOVE | OpenRouter provider |
| `adapters/voyage-embedding.ts` | medium | MOVE | Voyage provider |

**Sdk-core consumers:** `theokit.ts` + `memory.ts` both import
`MEMORY_EMBEDDING_ADAPTERS` from `adapters/catalog.ts`. **Resolution:**
re-export from sdk-memory's barrel; sdk-core uses optional-peer
dynamic import (Stage 4 pattern, mirrors sdk-handoff).

### Index implementations (8 files) — MOVE to sdk-memory

| File | Decision | Notes |
|---|---|---|
| `index-db.ts` | MOVE | SQLite-backed index |
| `index-manager-contract.ts` | MOVE | Interface |
| `index-manager-dispatch.ts` | MOVE | Backend chooser |
| `index-manager.ts` | MOVE | Public IndexManager |
| `index-schema.ts` | MOVE | DB schema |
| `lance-index.ts` | MOVE | LanceDB-backed index |
| `lance-memory-adapter.ts` | MOVE | Lance MemoryAdapter impl |
| `memory-index.ts` | MOVE | MemoryIndex interface |

**Sdk-core consumers:** only `local-agent-memory.ts` imports IndexManager
+ MemoryIndex. Already gated behind Stage 2b kernel flip — when flag on,
sdk-core never touches IndexManager directly; the port wraps it.

### Active memory subsystem (5 files) — MOVE to sdk-memory

| File | Decision | Notes |
|---|---|---|
| `active-memory.ts` | MOVE | runActiveMemory entry point |
| `active-memory-cache.ts` | MOVE | Per-agent recall cache |
| `active-memory-types.ts` | MOVE | Shared types |
| `circuit-breaker.ts` | MOVE | Recall circuit-breaker (NO LongAgent kernel coupling) |
| `embedding-cache.ts` | MOVE | Embedding result cache |

### Storage subsystem (7 files) — MOVE to sdk-memory

| File | Decision | Notes |
|---|---|---|
| `storage/chunk-markdown.ts` | MOVE | Markdown chunker |
| `storage/markdown-store.ts` | MOVE | Markdown CRUD |
| `storage/reader.ts` | MOVE | File reader |
| `storage/session-loader.ts` | MOVE | Session message loader |
| `storage/session-summary-writer.ts` | MOVE | writeSessionSummary impl |
| `storage/transcript-store.ts` | MOVE | Transcript persistence |
| `storage/wiki-loader.ts` | MOVE | Wiki-style memory loader |

**Sdk-core consumers:** `post-run-lifecycle.ts` imports
`writeSessionSummary` from `storage/session-summary-writer.ts`.
**Resolution:** post-run-lifecycle calls `provider.sync()` instead of
writeSessionSummary directly (Stage 2b kernel flip already includes this).
Move is safe AFTER post-run-lifecycle is refactored to drop the direct
import (single-line change — verify it's covered).

### Dreaming subsystem (3 files) — MOVE to sdk-memory

| File | Decision | Notes |
|---|---|---|
| `dreaming/run.ts` | MOVE | runDreamingSweep entry point |
| `dreaming/phases.ts` | MOVE | Dreaming phase machinery |
| `dreaming/diary.ts` | MOVE | Diary persistence |

**Sdk-core consumers:** `memory.ts` imports `runDreamingSweep` from
`dreaming/run.ts`. **Resolution:** `Memory.dreaming()` method delegates
to sdk-memory via optional-peer dynamic import (Stage 4).

### Migration / one-shot (2 files) — MOVE to sdk-memory

| File | Decision | Notes |
|---|---|---|
| `migrate-sqlite-to-lance.ts` | MOVE | One-shot CLI migrator |
| `migration.ts` | MOVE | Legacy-JSON → MD migrator |

**Sdk-core consumers:**
- `migrate.ts` (public API) re-exports `migrateSqliteToLance` — move to
  sdk-memory + drop sdk-core's `migrate.ts` re-export, OR keep as
  optional-peer shim (Stage 4 deprecation).
- `memory-store.ts` calls `migrateLegacyJson` directly. **Resolution:**
  memory-store.ts itself moves to sdk-memory or wraps the call via
  optional-peer. Inspect closer in Stage 3 impl iter.

### Other (5 files) — MOVE to sdk-memory

| File | Decision | Notes |
|---|---|---|
| `embedding-adapter.ts` | MOVE | EmbeddingRuntime interface |
| `sqlite-vec-loader.ts` | MOVE | sqlite-vec native binding loader |
| `tools.ts` | MOVE | createMemorySearchTool + createMemoryGetTool |
| `types.ts` | MOVE | Shared types (MemoryConfig, etc.) |
| `vec-index.ts` | MOVE | SQLite-vec index |

## Sdk-core retained (kernel runtime files)

| File | Decision | Notes |
|---|---|---|
| `runtime/local-agent-memory.ts` | KEEP — refactor away internal/memory/* imports | When flag on, methods become no-ops (port path takes over). When flag off, legacy behavior. After Stage 4 deprecation cycle: REMOVE entirely. |
| `runtime/local-agent-memory-provider.ts` | KEEP | The adapter (this iter chain shipped). Wraps the LocalAgentMemory legacy impl as a MemoryProvider. After Stage 4: this gets ENHANCED to dynamically import sdk-memory's rich provider when memory.enabled === true. |
| `runtime/memory-path-selector.ts` | KEEP | iter 22 helpers. Drop after env-var removed (Stage 4 cleanup). |
| `runtime/memory-store.ts` | TBD — possibly MOVE | Inspect: if its public surface is consumed only by Memory class, can move. |
| `runtime/post-run-lifecycle.ts` | KEEP — drop the writeSessionSummary import | Replace direct call with port `sync()` (already exposed via the port). |

## Public API impact

- `Memory` class (in `src/memory.ts`) — **KEEP in sdk-core**; methods
  delegate to sdk-memory via optional-peer dynamic import (Stage 4).
- `migrateSqliteToLance` (in `src/migrate.ts`) — **KEEP** as
  re-export of sdk-memory's impl via optional-peer.
- `MemoryFact`, `MemoryAdapter`, `MemoryAdapterCapabilities` (in
  `src/types/memory-adapter.ts`) — **STAY in sdk-core**. These are
  the PORT'S types; sdk-memory CONSUMES them.

## Pre-conditions before Stage 3 ships

1. ✅ **MemoryProvider port surface complete** (iter 18 T1.1-T1.5 + sync hook iter 19)
2. ✅ **`createLocalAgentMemoryProvider` adapter wraps legacy** (iter 19 + buildTools gap closed iter 19)
3. ✅ **Kernel flip ships** (iter 23 + integration proof iter 24)
4. ⏳ **Env-flag default flipped** (needs dogfood validation first — iter 25 target)
5. ⏳ **`post-run-lifecycle.ts` refactored** to drop direct
   `writeSessionSummary` import (use port `sync()` instead) — small targeted refactor.

## Execution iter sequence (Stage 3 proper)

1. **Iter 25 — dogfood validation under env flag.** Real-LLM or fixture
   smoke that exercises memory-enabled mode under both flag states +
   asserts equivalence.
2. **Iter 26 — flip env-var default to true.** `shouldUsePortMemoryPath`
   returns true by default; legacy becomes opt-OUT.
3. **Iter 27 — refactor `post-run-lifecycle.ts`** to drop the
   `writeSessionSummary` import. Replace with `provider.sync()` call.
4. **Iter 28 — actual source move.** Copy 38 files to sdk-memory's
   `src/internal/`. Update sdk-memory's `index.ts` to re-export the
   public surfaces. Verify sdk-memory still publint+attw GREEN.
5. **Iter 29 — sdk-core import rewire.** sdk-core's 3 remaining
   importers (`theokit.ts`, `migrate.ts`, `memory.ts`, plus the kernel
   runtime files) rewire to use optional-peer dynamic import. Add
   "install @theokit/sdk-memory" error path when peer not installed.
6. **Iter 30 — drop sdk-core copies.** Once optional-peer paths work,
   delete `packages/sdk/src/internal/memory/*` entirely. Bundle size
   drops by ~6613 LOC.

## Estimated bundle impact

- sdk-core: -6613 LOC of internal/memory + indirect deps (lancedb,
  sqlite-vec, embedding clients). **Expected ESM gzip delta: -40 to
  -60 KB.** Should land the sdk-core bundle under the 30 KB Phase 6
  rename target.
- sdk-memory: +6613 LOC + the heavy lancedb/sqlite-vec deps move from
  sdk-core's package.json to sdk-memory's. **Expected ESM gzip delta:
  +40 to +60 KB.**

## Risk assessment

- **Low risk for moves** of pure files (no kernel coupling): catalog,
  adapters/*, dreaming/*, sqlite-vec-loader, vec-index, lance-index,
  storage/* (except session-summary-writer).
- **Medium risk** for files imported by sdk-core's public Memory class:
  catalog, dreaming/run, migration. Optional-peer shim resolves this
  with the sdk-handoff pattern (proven precedent).
- **Higher risk** for `post-run-lifecycle.ts` import refactor — touches
  the kernel hot path. Must verify against the integration test
  (iter 24) + add a regression covering session-summary write under
  port path.
