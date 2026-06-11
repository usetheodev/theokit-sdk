---
slug: sdk-2-0-phase-1-physical-progress
artifact: phase-progress-log
created_at: 2026-06-08
parent: sdk-2-0-phase-1-physical-survey.md
purpose: Track concrete progress on Phase 1 (Memory) physical extraction across iter sessions
---

# Phase 1 physical extraction — progress log

Single source of truth for what's shipped vs pending on Phase 1's
multi-iter physical extraction. Updated at end of each iter session.

## Stage 1 — `sync()` port hook ✅ SHIPPED (iter 19)

**Commit:** `6f8d16f` feat(sdk-2-0): Phase 1 physical Stage 1 — add optional sync() port hook

- `MemoryProvider.sync?(handle): Promise<void> | void` — optional method
- Wired in `agent-loop/loop.ts` post-run path (gated on `finalStatus === "finished"`)
- `createInMemoryMarkdownProvider` ships no-op `sync()` impl
- **Tests:** 6 wiring tests (`agent-loop-memory-provider-sync.test.ts`)
- **Back-compat:** existing impls without `sync` still valid (optional method)

## Stage 2a — LocalAgentMemory → MemoryProvider adapter ✅ SHIPPED (iter 19)

**Commit:** `cf6c7bb` feat(sdk-2-0): Phase 1 physical Stage 2a — LocalAgentMemory→Provider adapter

- New file: `internal/runtime/local-agent-memory-provider.ts`
- `createLocalAgentMemoryProvider({agentOptions, workspaceCwd, agentId, telemetry?})`
- Wraps existing `LocalAgentMemory` class as a `MemoryProvider` impl
- Mapping:
  - `init()` → constructs LocalAgentMemory + warms `ensureTools()`
  - `runActivePass()` → calls `runActiveMemoryIfEnabled` with history shape translation
  - `sync()` → calls `syncIfReady()`
  - `dispose()` → no-op (LocalAgentMemory has no teardown)
- **Tests:** 8 contract tests

## Stage 2b (buildTools gap closure) ✅ SHIPPED (iter 19)

**Commit:** `eeb8aac` feat(sdk-2-0): Phase 1 physical Stage 2b — close Stage 2a buildTools gap

- Added `LocalAgentMemory.getCachedTools()` sync accessor (private cache readout)
- Adapter's `buildTools()` now reads from cache + translates
  `MemoryToolSpec` (`execute`) → `CustomTool` (`handler`)
- Replaced Stage 2a "documented gap" with "shape parity test"
- **Tests:** +1 (buildTools_reads_from_LocalAgentMemory_cache_when_present)

## Stage 2b (equivalence smoke) ✅ SHIPPED (iter 19)

**Commit:** `f30d7d8` test(sdk-2-0): adapter↔legacy equivalence smoke (Stage 2b iter 19+)

- 3 equivalence tests proving buildTools-via-adapter ≡ legacy-direct
  - shape parity (name/description/inputSchema preserved)
  - handler invokes underlying execute (verbatim args + return value)
  - empty cache parity

## Stage 2b (LocalAgent eager adapter construction) ✅ SHIPPED (iter 20)

**Commit:** `6fbca87` feat(sdk-2-0): Phase 1 physical Stage 2b — LocalAgent eagerly builds adapter

- `LocalAgent` ctor now creates `defaultMemoryProviderForLoop` field
  alongside `memoryGlue` field
- Adapter wraps the SAME underlying rich impl; difference is access pattern
- **NOT YET wired into `send()`** — agent-loop still consumes
  `memoryGlue` directly via `inputs.memoryTools` + concat path
- **Tests:** 3 (construction-pattern smoke)

## Stage 2b (lifecycle ordering proof) ✅ SHIPPED (iter 20)

**Commit:** `a5f645c` test(sdk-2-0): holistic MemoryProvider lifecycle-ordering tests

- 7 ordering tests pin the EXACT sequence agent-loop fires methods in:
  - finished run: `init → buildTools → runActivePass → sync → dispose`
  - error run: `init → buildTools → runActivePass → dispose` (no sync)
- Per-phase throw isolation (each phase swallows; chain continues)

## Stage 2b (runActivePass equivalence) ✅ SHIPPED (iter 21)

**Commit:** `54871f6` test(sdk-2-0): runActivePass equivalence — adapter ↔ LocalAgentMemory

- 4 equivalence tests proving runActivePass-via-adapter ≡ legacy
  - memory_disabled both produce no additions (equivalent at concat layer)
  - history shape translation preserves ordering
  - returned payload shape invariant (facts always Array; optional fields default undefined)
  - concat semantics match `resolveSystemPromptWithMemoryAdditions`

## Stage 2b — memory-path-selector helpers ✅ SHIPPED (iter 22)

**Commit:** `cbe9551` feat(sdk-2-0): Phase 1 physical Stage 2b — memory-path-selector helpers

- New file: `internal/runtime/memory-path-selector.ts`
- `PORT_MEMORY_PATH_ENV_VAR` constant: `"THEOKIT_PORT_MEMORY_PATH"`
- `shouldUsePortMemoryPath()` — env var detection ("1" or "true" → true)
- `resolveMemoryProviderForLoop(consumer, default, flag)` — consumer-
  supplied always wins; flag decides fall-back
- `resolveMemoryToolsForLoop(legacy, flag)` — flag on suppresses legacy
- `resolveActiveMemorySummaryForSend(legacy, flag)` — flag on suppresses legacy
- **Tests:** 14 (5 describes covering env-var matrix + selector matrices)

## Stage 2b kernel flip ✅ SHIPPED (iter 23)

**Commit:** `aa7b486` feat(sdk-2-0): Phase 1 physical Stage 2b — KERNEL FLIP (env-flag gated)

The actual `LocalAgent.sendLocked()` kernel refactor wiring the iter 22
selector helpers. When `THEOKIT_PORT_MEMORY_PATH=1` is set:

  - Legacy `memoryGlue.ensureTools()` + `runActiveMemoryIfEnabled()`
    async calls SKIPPED (the expensive active-memory recall is not even
    fired).
  - Auto-installed adapter (`defaultMemoryProviderForLoop`) injected
    into agent-loop via shallow-cloned `agentOptions` (dispatchRun
    gains optional `memoryProviderOverride` arg).
  - Iter 18 T1.5.* port wiring takes over inside agent-loop:
    `init → buildTools → runActivePass → sync → dispose`.

When flag is NOT set (default): ZERO behavior change. Consumer-supplied
`Agent.create({ memoryProvider })` ALWAYS wins regardless of flag.

**Tests:** 12 flip integration tests (2 describes: flag unset / flag set):
- shouldUsePortMemoryPath under each flag state
- memoryTools/activeMemorySummary/memoryProvider selection
- consumer-supplied wins precedence

## Stage 2b dogfood validation ⏳ NEXT

With the kernel flip shipped (iter 23) and the env flag in place,
the remaining Stage 2b validation is:

1. **Dogfood / fixture validation**: needs a test that exercises
   memory-enabled mode under both legacy + port paths and diffs the
   outputs. Currently unavailable in the test corpus — the memory
   subsystem requires `IndexManager.open()` + filesystem-backed
   embedding adapter to fully exercise the rich impl.
   - Recommendation: add a smoke test that boots `LocalAgent` with
     `options.memory.enabled = true` under both flag states + asserts
     equivalence of the agent-loop's `memoryTools` catalog and
     `system: <effective>` parameter.
   - Real-LLM dogfood under `THEOKIT_PORT_MEMORY_PATH=1` to confirm
     end-to-end equivalence: same `tool_use` IDs, same response.

2. **Flip the env-var default**: after fixture validation passes,
   `shouldUsePortMemoryPath()` default flips to `true` (legacy
   becomes opt-OUT via `THEOKIT_PORT_MEMORY_PATH=0`). This is the
   second sub-iter — small but consequential.

3. **Drop the env-var entirely**: after a release cycle of port-path-
   default in production, `LocalAgent.send` removes the flag branches
   and the legacy direct calls. `memoryGlue` field stays for back-
   compat (Stage 4 deprecation).

## Stage 3 — Move `internal/memory/*` to `sdk-memory`/internal ⏳

**Blocked on:** Stage 2b kernel flip. Without flip, kernel still
imports from `internal/memory/*` directly; moving the files breaks
the kernel.

## Stage 4 — Drop public `Memory` class via optional-peer ⏳

**Blocked on:** Stage 3. Without source move, `Memory` class still
lives in sdk-core; deprecation is meaningless until the impl moves.

## Cumulative test count

| Test file | Tests |
|---|---|
| `agent-loop-memory-provider-sync.test.ts` | 6 |
| `local-agent-memory-provider.test.ts` | 9 |
| `local-agent-memory-provider-equivalence.test.ts` | 3 |
| `local-agent-default-memory-provider.test.ts` | 3 |
| `agent-loop-memory-provider-ordering.test.ts` | 7 |
| `local-agent-memory-provider-runActivePass-equivalence.test.ts` | 4 |
| `memory-path-selector.test.ts` | 14 |
| `local-agent-port-memory-path-flip.test.ts` | 12 |
| **Subtotal — Stage 1+2** | **58** |
| Pre-Stage Phase 1 (T1.1-T1.5) | 51 |
| **Total Phase 1** | **109 GREEN** |

## Commit chain (Phase 1 physical, in order)

```
6f8d16f Stage 1 — sync() port hook
25eeefe docs: mark Stage 1 complete
cf6c7bb Stage 2a — LocalAgentMemory→Provider adapter
eeb8aac Stage 2b — close buildTools gap
f30d7d8 Stage 2b — adapter↔legacy equivalence smoke (buildTools)
1ea0ca2 docs: CHANGELOG entries for Stage 1
a5f645c Stage 2b — holistic lifecycle-ordering tests
6fbca87 Stage 2b — LocalAgent eagerly builds adapter
54871f6 Stage 2b — runActivePass equivalence
c6e675c docs: Phase 1 physical progress log (consolidate iter 19-21)
cbe9551 Stage 2b — memory-path-selector helpers
aa7b486 Stage 2b — KERNEL FLIP (env-flag gated)
```
