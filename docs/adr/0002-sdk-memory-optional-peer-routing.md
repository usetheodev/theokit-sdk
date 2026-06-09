---
status: accepted
date: 2026-06-09
deciders: paulo
consulted: claude
informed: theokit-maintainers
---

# ADR 0002: SDK 2.0 — `@theokit/sdk-memory` as optional peer + sdk-core delegates via runtime routing

## Context and Problem Statement

SDK 2.0 Phase 1 extracted the memory subsystem into a separate package
(`@theokit/sdk-memory`). All 38 source files in sdk-core's
`internal/memory/*` were copied (hybrid dual-copy pattern) to the new
package across iter 44-75. Both copies are byte-equivalent at runtime.

The question: how should sdk-core's public `Memory` class
(`src/memory.ts`) + `migrateSqliteToLance` wrapper (`src/migrate.ts`)
behave once sdk-memory exists?

Three options were considered:

1. **Hard-delete the internal/ copies + require sdk-memory.** Breaks
   v1.x back-compat. Any consumer who upgrades sdk without installing
   sdk-memory hits ImportError at runtime.
2. **Keep both copies forever.** Wastes ~30 KB of bundled code +
   duplicates maintenance.
3. **Optional-peer routing.** sdk-core attempts to load sdk-memory at
   runtime; if installed, routes through it; if absent, falls back to
   the internal/ copy. Preserves v1.x back-compat; future Stage 4
   deprecation can hard-flip once telemetry confirms adoption.

## Decision Drivers

- **Back-compat.** v1.x consumers MUST be able to upgrade sdk without
  installing additional packages OR seeing behavior change.
- **Bundle hygiene.** Eventually the internal/ duplicates need to go;
  routing is the runway, not the destination.
- **Discoverable upgrade path.** Consumers who explicitly install
  sdk-memory should see ZERO behavior change vs the internal/ path.
  Otherwise the migration would surprise them.
- **Test coverage.** Both branches (peer present / peer absent) must
  be exercisable in CI without process-level reset gymnastics.

## Considered Options

### Option A: Hard-delete + require

- Pros: Smallest sdk-core bundle. Single source of truth.
- Cons: Breaks v1.x consumers on upgrade. Forces them to install
  sdk-memory even if they don't use Memory class.

### Option B: Keep both copies

- Pros: No routing complexity.
- Cons: 30 KB duplicate bundled code; maintenance burden on every
  internal/memory/* change; consumers see internal copy by default
  (defeats the point of the extraction).

### Option C: Optional-peer routing (chosen)

- Pros: Back-compat preserved; discoverable upgrade; bundle-shrink
  story is "uninstall the internal/ copy in v3.0".
- Cons: Adds a `tryLoadSdkMemoryPeer()` indirection per Memory call;
  two code paths to maintain (mitigated by behavior-parity test gate
  in iter 79).

## Decision Outcome

**Chosen: Option C — optional-peer routing.**

Implementation locked in iter 76-80:

- `packages/sdk/src/internal/memory/sdk-memory-peer-loader.ts`
  - `tryLoadSdkMemoryPeer(): Promise<SdkMemoryModule | null>` — single
    dynamic-import attempt of `@theokit/sdk-memory`, memoized per
    process. Returns the module on success, `null` on definitive
    absence.
  - Module accepted only when 4 canonical surfaces present:
    `MEMORY_EMBEDDING_ADAPTERS`, `runDreamingSweep`, `IndexManager`,
    `migrateSqliteToLance`. Partial modules treated as absent.
  - Dynamic specifier kept opaque (`const spec = "@theokit/sdk-memory"`)
    so bundlers can't statically resolve the peer at install time.
- `packages/sdk/src/memory.ts`
  - `Memory.openIndex` + `Memory.runDreamingSweep` start with
    `const peer = await tryLoadSdkMemoryPeer();`. If non-null, route
    through `peer.IndexManager.open` / `peer.runDreamingSweep`.
    Otherwise fall back to internal/.
- `packages/sdk/src/migrate.ts`
  - `migrateSqliteToLance` follows the same pattern via
    `peer.migrateSqliteToLance`.
- Test escape hatches:
  - `resetSdkMemoryPeerCacheForTests()` clears the memoization.
  - `forceSdkMemoryPeerAbsentForTests()` makes the loader return
    `null` in-process, so CI exercises the fallback branch without
    uninstalling the peer.

## Consequences

### Positive

- Public Memory class + migrate surface stays byte-equivalent
  regardless of whether sdk-memory is installed.
- Iter 79 parity test enforces shape + error message equivalence
  between sdk-core (routed) and sdk-memory (direct) for every public
  method. Any future drift fails CI before consumers see it.
- Iter 80 fallback test covers the legacy branch with the
  force-absent flag, so every routing PR exercises both halves of the
  if/else.

### Negative

- 2 code paths to maintain for the lifetime of Stage 4. Mitigated by
  the parity gate.
- Cold-import cost (1 `await import("@theokit/sdk-memory")` per process)
  the first time a Memory method runs. Negligible vs LLM call latency.

### Neutral

- The loader's `SdkMemoryModule` interface is a structural mirror of
  sdk-memory's barrel — keeps sdk-core's dts surface decoupled from
  sdk-memory's full canonical types (avoids rollup-plugin-dts cycle
  in `types/agent.ts`).

## Stage 4 sunset condition

The fallback path SHOULD be removed in SDK 3.0 once telemetry
confirms ≥95% of Memory class consumers install sdk-memory. The
removal is a 1-commit destructive change:

1. Delete the `if (peer !== null)` branch + the legacy fallback body
   in `memory.ts` + `migrate.ts`.
2. Delete `internal/memory/sdk-memory-peer-loader.ts`.
3. Make `@theokit/sdk-memory` a REQUIRED peer (drop the optional
   meta).

Until then: optional-peer routing is the canonical model.

## Cross-references

- Phase 1 Stage 3 source-move plan:
  `.claude/knowledge-base/plans/sdk-2-0-phase-1-stage-3-source-move-plan.md`
- Stage 3 source-move iter chain: 44-75 (38 files moved)
- Stage 4 routing iter chain: 76-80 (24 tests across 5 files, all
  GREEN)
- Phase 6 rename prep: iter 81 (dry-run + smoke test)
- Sibling pattern: sdk-handoff's optional-peer dynamic import (the
  precedent referenced in the Stage 3 source-move plan).
