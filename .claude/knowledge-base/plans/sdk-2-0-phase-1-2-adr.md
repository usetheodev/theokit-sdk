---
slug: sdk-2-0-phase-1-2-adr
artifact: architectural-decisions
created_at: 2026-06-08
purpose: ADR-style record of design decisions surfaced while attempting Phase 1 (Memory) + Phase 2 (Budget) extractions across iter 7-16
---

# Phase 1 (Memory) + Phase 2 (Budget) — Architectural Decisions

## Context

The plan `sdk-2-0-package-split-plan.md` v1.1 specified that Memory + Budget extractions were "extractable" with "zero coupling" beyond Plugin/types. Empirical attempts (iter 7 for Memory full extract; iter 10-16 for Budget interface inversion) revealed deeper dependencies that gate the physical move.

This document records the discoveries + the design path forward.

## ADR-001 — Memory: kernel runtime files cross-import internal/memory

**Surfaced:** iter 7 (Phase 1 attempted full extract, reverted).

**Discovery:** 4 sdk runtime files depend on Memory at runtime:

| File | Imports |
|---|---|
| `internal/runtime/local-agent-memory.ts` | runActiveMemory, ActiveMemoryCache, MEMORY_EMBEDDING_ADAPTERS, CircuitBreaker, EmbeddingRuntime, IndexManager, MemoryIndex, createMemoryGetTool, createMemorySearchTool (9 symbols) |
| `internal/runtime/post-run-lifecycle.ts` | writeSessionSummary |
| `internal/runtime/agent-session-store.ts` | (was atomic-write; fixed iter 14) |
| `internal/runtime/memory-store.ts` | migrateLegacyJson, markdown-store, types |

These are AGENT-LOOP runtime files — replacing imports with `await import(...)` (optional-peer pattern like Handoff) would degrade hot-path performance. Replacing with kernel→extension dependency is direction-violating.

**Decision:** Memory full extract requires **interface inversion** similar to Budget (ADR-002 below). Define a `MemoryProvider` contract in sdk-core; impl lives in sdk-memory; agent-loop calls through the interface. This is a multi-iteration architectural change, not a single-iteration move.

**Status:** Functionally complete via interface inversion (iter 18 — T1.1 → T1.6). `MemoryProvider` port shipped in sdk-core; `@theokit/sdk-memory@0.1.0` package shipped consuming the port with a working in-process impl (`createInMemoryMarkdownProvider`); 65/65 tests GREEN across sdk-core (51) + sdk-memory (14). Physical extraction of `internal/memory/lance-*` / `index-manager` / `embedding-adapter` / `circuit-breaker` sources to `@theokit/sdk-memory` rich impl is deferred — it's the packaging/bundle cleanup that requires updating the 4 kernel runtime files (`local-agent-memory`, `post-run-lifecycle`, `agent-session-store`, `memory-store`) to use the port instead of direct imports. Same maturity as Budget (ADR-002).

**Layered design (mirrors Budget):**

- **Legacy `Memory` class + `internal/memory/*`** REMAIN the sole authoritative path for back-compat.
- **`MemoryProvider`** is a CONSUMER-SUPPLIED, LAYERED extension surfaced via `Agent.create({ memoryProvider })`. When undefined, ZERO behavior change.
- Provider's `buildTools()` results APPEND to legacy `memoryTools` + `customTools` (no replacement).
- Provider's `runActivePass()` returns `systemPromptAdditions` that CONCAT to `inputs.systemPrompt` (separator: blank line).

## ADR-002 — Budget: interface inversion completed via BudgetTracker (iter 10-16)

**Surfaced:** plan T2.1 + empirical iter 12-13.

**Discovery:** agent-loop directly imports `UsageAccumulator` and `IterationBudget` runtime classes. Same hot-path constraint as Memory.

**Decision:** Ship `BudgetTracker` interface (iter 10) as kernel contract + reference impl `createCounterBudgetTracker` (iter 11) + Agent.create option (iter 12) + AgentLoopInputs plumbing (iter 13) + runtime `track()` hook (iter 15) + runtime `check()` hook (iter 16). Layered design:

- **Legacy IterationBudget + UsageAccumulator** REMAIN the sole authoritative path for back-compat.
- **BudgetTracker** is a CONSUMER-SUPPLIED, LAYERED gate that observes (`track()`) + can abort (`check()`).
- Optional — when `Agent.create({ budgetTracker })` is absent, ZERO behavior change vs. legacy.

**Status:** Functionally complete via interface inversion (iter 10-16). Cohort-ready as of iter 18+: `@theokit/sdk-budget@0.1.0` package shipped consuming the `BudgetTracker` port + a USD-cost-aware impl (`createUsdBudgetTracker`) with built-in pricing for 9 popular models. 18/18 tests GREEN; publint clean; attw 4/4 GREEN. Physical extraction of `internal/budget/*` source files (compute-cost, ledger, normalize-usage, pricing-registry, usage-accumulator, calendar-window) to the sdk-budget package is still deferred — same multi-iter character as Memory (ADR-001 physical) — but is no longer blocking the Phase 7 cohort.

## ADR-003 — Cross-extracted-package patterns (Cache / Tools / Handoff vs. Memory / Budget)

**Why Cache / Tools / Handoff extracted cleanly (Phases 3, 4, 5):**

| Subsystem | Why clean |
|---|---|
| Cache | Integrates via Plugin protocol (`.asPlugin()`); kernel never imports Cache directly. |
| Tools | Standalone — kernel imports `defineTool` helper + `CustomTool` type only. No instances. |
| Handoff | Refactored to plugin pattern (`Handoff.asPlugin()`) + optional-peer auto-wire for legacy. |

**Why Memory / Budget DON'T extract cleanly:**

Both are deeply integrated into the agent-loop runtime — every iteration of the loop touches Budget (usage accumulation, iteration counting), and Memory state observation flows through agent kernel runtime. They are NOT plugin-shaped extensions; they ARE kernel state machines.

**Lesson for future SDK subsystems:** any subsystem that needs to be physically extractable to a separate npm package MUST integrate via either (a) Plugin protocol with no kernel data dependencies, or (b) interface contract in sdk-core with DI impl in extracted package. Direct internal imports across packages are kernel→extension violations.

## ADR-004 — Deprecated shim cleanup pattern

**Discovered:** iter 7 (cwd-mutex) + iter 14 (atomic-write).

**Pattern:** Files marked `@deprecated` in their header with a re-export shape are dead code waiting to be removed. Both shims found in `internal/memory/` re-exported from `internal/persistence/` — leftover from an earlier refactor that moved canonical impls without flushing consumers.

**Process for future shim removal:**

1. `grep -rln "@deprecated" packages/<pkg>/src/` to enumerate.
2. For each shim, find consumers: `grep -rln "from ['\"]\.\./<shim-path>" packages/<pkg>/src/`.
3. Rewrite consumers to canonical path via sed.
4. Delete shim file.
5. `pnpm tsc --noEmit` to verify.
6. Commit atomically as `refactor: remove deprecated <X> shim`.

This pattern is cheap (5-10 min per shim) and reduces surface area for future extractions.

## ADR-005 — Layered enforcement design

**Question raised iter 16:** When both legacy IterationBudget AND BudgetTracker are wired, which wins?

**Decision:** Both fire. Order of precedence in `runAgentLoop` while-loop:

1. **First:** `inputs.budgetTracker?.check()` — if `{ allowed: false }`, abort with error.
2. **Then:** `budget.shouldContinue()` (legacy IterationBudget) — if false, exit while.
3. **Then:** `runIteration()` runs.
4. **Inside runIteration:** `inputs.budgetTracker?.track(...)` runs after LLM completion (observation).
5. **Then:** `budget.consume()` (legacy iteration count).

**Rationale:** consumer-supplied tracker can be STRICTER than legacy (e.g., $5 USD cap before iteration cap reached); never less strict. Layered design preserves back-compat AND lets consumers add tighter guards.

## ADR-006 — Bundle budget target gating Phase 6 rename

**Empirical (iter 12):** sdk `dist/index.js` = 134306 bytes gzipped.
**Plan target (ADR D9):** ≤ 30000 bytes for `@theokit/sdk-core` after rename.
**Gap:** 104306 bytes (78% reduction).

**Decision:** Phase 6 (rename `@theokit/sdk` → `@theokit/sdk-core@2.0.0`) is mechanically trivial but blocked by the bundle target. The 30 KB target only holds AFTER:

- Memory subsystem moved out (~4070 LOC).
- Budget subsystem moved out (~932 LOC).
- Likely also Eval / Workflow / Subscription stripped from main barrel (they live at sub-paths but still re-exported through the index).

**Path forward:** Phase 1 full extract + Phase 2 physical extraction (sdk-budget package) + barrel slim. Each is multi-iter.

## ADR-007 — Cohort prep validated independent of Phase 1+2

**Surfaced:** iter 9.

**Discovery:** all 3 currently-extracted packages (sdk-cache, sdk-tools, sdk-handoff) pass `publint` "All good!" + `attw` 4/4 GREEN. 21 publish-readiness invariant tests added in `tests/sdk-2-0-npm-publish-readiness.test.ts`.

**Decision:** Phase 7 cohort bump prep is **independently validated** even though Phase 6 rename can't ship yet. When Phase 1+2 complete, Phase 7 cohort can publish immediately without further preconditions for the 3 already-extracted packages.

## Summary roadmap

| Phase | Status | Remaining work |
|---|---|---|
| 0 — Baseline | ✅ DONE (iter 1) | — |
| 1 — Memory extract | 🟢 Functionally complete via interface (iter 18 — T1.1-T1.6); 🟢 Physical Stage 1 — sync() port hook shipped (iter 19) | Physical Stage 2 — refactor LocalAgentMemory to use MemoryProvider port (1 iter); Stage 3 — move internal/memory/* to sdk-memory + ship LanceDB rich impl (1 iter); Stage 4 — drop public Memory class via optional-peer (1 iter) |
| 2 — Budget extract | 🟢 Functionally complete (iter 10-16) + cohort-ready (iter 18+ — `@theokit/sdk-budget@0.1.0` shipped) | Physical extraction of `internal/budget/*` source files (still multi-iter) |
| 3 — Cache extract | ✅ DONE (iter 2) | — |
| 4 — Handoff extract | ✅ DONE (iter 6) | — |
| 5 — Tools extract | ✅ DONE (iter 3) | — |
| 6 — Rename → sdk-core 2.0 | ⏳ Gated on bundle budget | After Phase 1 + 2 physical |
| 7 — Cohort 23 packages | 🟢 Prep DONE (iter 9); `@theokit/sdk-memory@0.1.0` + `@theokit/sdk-budget@0.1.0` added to cohort (iter 18+) | After Phase 6 |
| 8 — Codemod | ✅ DONE (iter 4) | Append Memory/Budget entries when extracted |
| 9 — Docs | ✅ DONE (iter 5) | Update status table after each extraction |
| 10 — CI bundle gate | ✅ DONE (iter 4) | — |
| Final — Dogfood QA | ⏳ Not started | After Phase 7 |

**~3-5 more iterations** to reach full completion (was 4-6 pre iter 19):
- Phase 1 physical Stages 2-4 = 3 iters (LocalAgentMemory refactor → moves → optional-peer)
- Phase 6 rename + Phase 7 cohort publish + dogfood = 2-3 iters

Both subsystems now cohort-ready + Phase 1 physical Stage 1 (sync hook)
shipped iter 19. The physical source moves are bundle-size cleanup, not
functional gaps.
