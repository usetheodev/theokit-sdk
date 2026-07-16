---
slug: zero-import-cycles
milestone_id: SE45
created_at: 2026-07-16
goal: Eliminate all madge import cycles (3 to 0) in packages/sdk/src with zero public-API break.
---

# Plan: Zero Import Cycles (SE45)

> **Version 1.0** — Take `packages/sdk/src` from 3 `madge` cycles to **0** by fixing the one genuine structural debt the 2026-07-16 `/loop-codebase-architect` audit found: the domain-contract layer `types/` depending on the application layer `internal/`. Two of the three cycles are type-only inversions (relocate contract types into `types/`); the third is the facade→local-agent value edge (route through the existing `agent-factory-registry` port). Sequenced safest-first (type moves → value-edge inversion → gate tighten), each behind the enforced madge/depcruise gates, public barrels byte-stable. Expected outcome: `madge` 0 cycles, `quality:cycles` gate tightened 3→0, Coupling 14→20 + Pattern-fit 13→15 in a re-audit.

## Goal

> "Reduce `packages/sdk/src` madge import cycles from 3 to 0 with zero public-API break, measured by `pnpm quality:cycles` passing at a tightened threshold of 0 AND `pnpm -w run validate` staying green."

## Context

The 2026-07-16 `/loop-codebase-architect` audit (`architect-output/report.md`, score 78/100, verdict Refactor Lightly) found the codebase STRONG with one high-value structural debt: `types/` (domain contract) imports `internal/` (application/infra), the root of 2 of the 3 `madge` cycles. The 3rd cycle is the facade `agent.ts` transitively pulling `internal/local-agent` despite the `setAgentFacade` registry seam. All three are behavior-preservingly removable. This is milestone SE45 (added by `/roadmap-feature`), lifting Coupling + Pattern-fit to max.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/src/types/run.ts` | ~440 | (baseline) | Public run contract types | Public exports byte-stable; drop the inline `internal/` import |
| `packages/sdk/src/types/agent.ts` | 975 | (baseline) | Public agent contract types | Public exports byte-stable; drop the `Plugin` + `MemoryProvider` `internal/` imports |
| `packages/sdk/src/internal/agent-loop/tool-result-guard.ts` | ~120 | (baseline) | Tool-result guard impl + `ToolResultGuardOptions` | Behavior unchanged; import `ToolResultGuardOptions` from `types/` |
| `packages/sdk/src/internal/plugins/types.ts` | ~200 | (baseline) | `Plugin` type + `definePlugin` | Behavior unchanged; `Plugin` type re-homed to `types/` (re-exported for back-compat) |
| `packages/sdk/src/internal/runtime/memory/memory-provider.ts` | ~? | (baseline) | `MemoryProvider` port + impl | `MemoryProvider` port type re-homed to `types/`; impl unchanged |
| `packages/sdk/src/agent-helpers.ts` | ~290 | (baseline) | Facade helper: creates LocalAgent/CloudAgent | Route `new LocalAgent` through a registry factory; no static `internal/local-agent` value import |
| `packages/sdk/src/internal/local-agent/index.ts` | ~10 | (baseline) | local-agent barrel | Registers a `createLocalAgent` factory into the registry at module init |
| `packages/sdk/src/internal/runtime/registry/agent-factory-registry.ts` | ~? | (baseline) | `setAgentFacade` DIP seam | Extend with a `localAgentFactory` register/get pair (same pattern) |
| `packages/sdk/src/internal/runtime/lifecycle/fork-agent.ts` | ~? | (baseline) | fork impl; imports `isCodePlugin` from local-agent (#129) | Import `isCodePlugin` from a neutral leaf |
| `packages/sdk/src/internal/local-agent/local-agent-plugins.ts` | ~? | (baseline) | `isCodePlugin` (#129) | `isCodePlugin` moved to a neutral leaf both sides import one-way |
| `packages/sdk/src/types/index.ts` (barrel) | ~? | (baseline) | Public types barrel | Add the relocated types (public, additive) |
| `tools/check-loc.mjs` scope / `.claude/quality-gates.md` | — | (baseline) | G-gate config | Tighten `quality:cycles` threshold 3→0 |

Test files are co-located per `rules/testing.md`. The primary "test" for this plan is the `madge` gate itself (a real regression oracle).

### Current callers / dependents

- **`ToolResultGuardOptions`** (`internal/agent-loop/tool-result-guard.ts:18`) — 2 importers; consumed as a type by `types/run.ts:431` (inline `import(...)` type).
- **`Plugin`** (`internal/plugins/types.ts:174`) — 5 importers incl. `types/agent.ts:20`. Core type.
- **`MemoryProvider`** (`internal/runtime/memory/memory-provider.ts`) — port type; consumed by `types/agent.ts:664` (inline `import(...)` type).
- **`LocalAgent`** (`internal/local-agent/index.ts`) — value, instantiated in `agent-helpers.ts:150,231` (`new LocalAgent(...)`).
- **`isCodePlugin`** (`internal/local-agent/local-agent-plugins.ts`) — value, imported by `internal/runtime/lifecycle/fork-agent.ts:21` (#129).

### Domain glossary

- **DIP seam / registry** — `agent-factory-registry.ts` inverts dependencies at module-init: internal registers/reads factories, the facade sets itself via `setAgentFacade`, so internal can call the public facade without importing it.
- **type-only import** — `import type` / inline `import("...").T` — erased at runtime, but `madge` still counts it as a graph edge (so it can form a cycle even with no runtime coupling).
- **contract type** — a type that IS part of the public/domain contract (`Plugin`, `MemoryProvider` port, `ToolResultGuardOptions`); belongs in `types/`, not `internal/`.

### Architecture boundaries affected

Per `rules/architecture.md § 1-2`: this plan RESTORES the correct dependency direction — `types/` (domain) must depend on nothing outward; `internal/` (application/infra) depends inward on `types/`. It relocates 3 contract types from `internal/` to `types/` (inverting 2 cycles) and routes the facade→local-agent value edge through the existing registry port (inverting the 3rd). No new outward import; no layer crossed in the wrong direction after the change.

## Prior Art & Related Work

- **Internal audit (the requirements source):** `architect-output/report.md` (2026-07-16 `/loop-codebase-architect`, 78/100) + `architect-output/codebase-architect.db` (coupling findings + the 6-step migration plan). SE45 implements migration steps 1, 2, 5.
- **The existing DIP pattern to extend:** `internal/runtime/registry/agent-factory-registry.ts` (`setAgentFacade`) — SE45 adds a `localAgentFactory` register/get pair in the same shape.
- **Prior incremental-move discipline:** SE43 (`@theokit/sdk@4.2.0`) proved module moves are safe only behind a green madge/depcruise gate, one change per commit, with scripted depth-shift + immediate `tsc` verify.
- **Rules:** `rules/architecture.md` (§1 layering, §2 DIP), `rules/testing.md` (§5 pairing), `rules/parsimony-ladder.md` (reuse the existing registry vs a new mechanism — rung 4).
- **Patterns skills:** none in `skills/*-patterns/` match. "(none applicable)".

## Objective

- [ ] Cycle 1 removed — `ToolResultGuardOptions` in `types/`; `types/run.ts` no longer imports `internal/`.
- [ ] Cycle 2 removed — `Plugin` + `MemoryProvider` port types in `types/`; `types/agent.ts` no longer imports `internal/`.
- [ ] Cycle 3 removed — `agent-helpers.ts` creates LocalAgent via a registry factory; no static `internal/local-agent` value import from the facade.
- [ ] #129 closed — `isCodePlugin`/fork contract on a neutral leaf; `local-agent ↔ fork-agent` no longer mutual.
- [ ] `madge` reports 0 cycles; `quality:cycles` gate threshold tightened 3→0.
- [ ] Zero public-API change; `pnpm -w run validate` exit 0.

## ADRs

### D435 — Relocate contract types (`Plugin`, `MemoryProvider` port, `ToolResultGuardOptions`) into `types/`, re-export from `internal/` for back-compat

- **Decision:** Move the three contract type DEFINITIONS from `internal/*` into `types/`; have the `internal/` modules that own the IMPLEMENTATION import the type from `types/` and re-export it (so existing `internal/`-relative importers keep working). `types/agent.ts`/`types/run.ts` then reference the local `types/` definitions — inverting madge cycles 1+2.
- **Rationale:** These are contract types the domain layer already depends on; they belong in `types/` per DIP (`rules/architecture.md §2`). Re-exporting from the original `internal/` path keeps the 2+5 internal importers unchanged (no churn, no public-API change). parsimony rung 1: the types already exist — only their home moves.
- **Alternatives considered:** (a) **Make `types/` use inline `import type` from `internal/` (leave as-is)** — REJECTED: that IS the current cycle; type-only doesn't stop madge flagging it, and it's a real DIP inversion. (b) **A new `contracts/` package** — REJECTED: `types/` already IS the contract home; a new dir is redundant (YAGNI).
- **Consequences:** Restores domain→nothing direction; removes 2 cycles. Constrains: the `internal/` re-export must stay until a major if external code imports the type from the internal path (checked — these are internal paths, low external risk, but the re-export is free insurance).

### D436 — Route the facade→local-agent value edge through a `localAgentFactory` in the existing registry

- **Decision:** Extend `agent-factory-registry.ts` with `setLocalAgentFactory(fn)` / `getLocalAgentFactory()`. `internal/local-agent/index.ts` registers `createLocalAgent` at module-init (same as `setAgentFacade`). `agent-helpers.ts` calls `getLocalAgentFactory()(...)` instead of `new LocalAgent(...)`, dropping its static `import { LocalAgent }`.
- **Rationale:** Reuses the exact DIP seam already in place for the reverse direction (parsimony rung 4 — reuse installed mechanism). Inverts the edge: local-agent → registry ← facade, so the facade depends only on the port. Removes cycle 3.
- **Alternatives considered:** (a) **Dynamic `import()` of LocalAgent in agent-helpers** — REJECTED: makes agent creation async at a new point + defeats tree-shaking clarity; the registry is the established pattern. (b) **Leave cycle 3 (it's within the ≤3 gate)** — REJECTED: the goal is 0 cycles + tightening the gate; leaving it blocks the gate tighten.
- **Consequences:** The facade no longer statically imports the local runtime. Constrains: module-init ordering — the registry factory must be registered before first `Agent.create`; guaranteed by the barrel import chain (same as `setAgentFacade` today).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Cycle 3's registry-factory inversion touches the agent bootstrap (`new LocalAgent`) — a regression could break agent creation | High | Behind madge/depcruise gates; full sdk suite (esp. agent-basics + real-LLM smoke) green before commit; one edge per commit | implementer |
| Tightening `quality:cycles` 3→0 could surface a latent cycle the ≤3 threshold masked | Medium | Reach 0 cycles FIRST (verify `madge`), tighten the gate in the SAME commit; if a 4th latent cycle appears, fix before tightening | implementer |
| Relocating `Plugin` (5 importers) risks a subtle type-identity break | Medium | Re-export `Plugin` from the original `internal/plugins/types.ts` path (D435), so all 5 importers resolve the same type; typecheck proves identity | implementer |
| Module-init ordering: `getLocalAgentFactory()` called before the factory is registered | Medium | Register at barrel module-init (same chain that already registers `setAgentFacade`); add a typed error if the factory is unset (fail-fast, not undefined) | implementer |

## Unresolved Questions

- Q1 — Does any EXTERNAL consumer import `Plugin` / `MemoryProvider` / `ToolResultGuardOptions` from the `internal/` path directly? (Baseline: these are `internal/` paths, not public exports; the D435 re-export covers it regardless. Re-verify with a grep of examples/ before finalizing.)
- Q2 — Is the `setLocalAgentFactory` registration guaranteed to run before the first `agent-helpers.createLocalAgent`? (Leaning: yes — same barrel import chain as `setAgentFacade`; a fail-fast typed error on unset factory makes any ordering bug loud, not silent. `/edge-case-plan` to confirm.)

## Dependencies

No new third-party dependencies (parsimony: reuse the existing registry seam).

| Dependency | Version | Kind | New? | Rule-9 justification |
|---|---|---|---|---|
| (none) | — | — | — | Pure internal restructuring; reuses `agent-factory-registry` |

- **New third-party packages:** none. **CVE surface:** unchanged.

## Dependency Graph

```
Phase 1 (Cycle 1: ToolResultGuardOptions) ──▶ Phase 2 (Cycle 2: Plugin + MemoryProvider) ──▶ Phase 3 (Cycle 3: localAgentFactory) ──▶ Phase 4 (#129 fork leaf + gate tighten 3→0) ──▶ Phase 5 (Integration Validation)
        │ type-only, low risk                    │ type-only, 5 importers                       │ value edge, HIGH risk                    │ close #129 + lock the win
        └── each phase: madge cycle count drops, full suite green, then commit ───────────────────────────────────────────────────────────┘
```

Sequential, safest-first. Each phase leaves `pnpm quality:cycles` + full suite green before the next.

---

## Phase 1: Cycle 1 — relocate `ToolResultGuardOptions` to `types/`

### T1.1 — Move `ToolResultGuardOptions` into `types/`, re-export from internal

#### Objective
Define `ToolResultGuardOptions` in `types/` (e.g. `types/run.ts` or a `types/tool-result-guard.ts`); `internal/agent-loop/tool-result-guard.ts` imports + re-exports it; `types/run.ts:431` references the local type. Removes madge cycle 1.

#### Why this step (action + reasoning)
1. **What this step does** — relocates the `ToolResultGuardOptions` interface (currently `internal/agent-loop/tool-result-guard.ts:18`) to the contract layer; the impl module imports it from `types/` and re-exports for its 2 existing importers.
2. **Why it is necessary now** — `types/run.ts:431` inline-imports it from `internal/`, forming madge cycle 1 (types→internal). It IS a contract type (a public run option). Cites D435. Lowest-risk first (type-only, 2 importers).

#### Evidence
`madge` cycle 1: `types/run.ts > internal/agent-loop/tool-result-guard.ts > internal/llm/tool-result-content.ts > errors.ts`. `types/run.ts:431`: `toolResultGuard?: import("../internal/agent-loop/tool-result-guard.js").ToolResultGuardOptions`.

#### Files to edit
```
packages/sdk/src/types/run.ts — define/host ToolResultGuardOptions; drop the inline internal import
packages/sdk/src/internal/agent-loop/tool-result-guard.ts — import ToolResultGuardOptions from types/; re-export it
packages/sdk/src/types/index.ts — export ToolResultGuardOptions if not already public
```

#### Deep file dependency analysis
`types/run.ts` currently reaches into internal via an inline type import; after the move it references the local definition. The impl file re-exports so its 2 importers are unchanged. No runtime change (type-only).

#### TDD
```
RED:     test_madge_cycle1_gone() — run `pnpm quality:cycles`; assert the types/run.ts->tool-result-guard cycle is absent (cycle count drops from 3 to 2). Fails before the move.
GREEN:   relocate the type + re-export
REFACTOR: None expected
VERIFY:  pnpm quality:cycles && pnpm --filter @theokit/sdk typecheck
```

#### Concurrency tests
(none — single-threaded) — type relocation, no runtime behavior.

#### Acceptance Criteria
- [ ] `pnpm quality:cycles` reports 2 cycles (cycle 1 gone), exit 0
- [ ] `grep -c "internal/" packages/sdk/src/types/run.ts` returns 0 for the tool-result-guard import
- [ ] `pnpm --filter @theokit/sdk typecheck` exit 0
- [ ] No public-API change (`diff` of `dist/types.d.ts` public shape — the type is still exported, just re-homed)

#### DoD
- [ ] Cycle 1 gone; typecheck clean; CHANGELOG `[Unreleased]` note

---

## Phase 2: Cycle 2 — relocate `Plugin` + `MemoryProvider` port to `types/`

### T2.1 — Move `Plugin` + `MemoryProvider` port types into `types/`, re-export from internal

#### Objective
Relocate the `Plugin` type (`internal/plugins/types.ts:174`) and the `MemoryProvider` port type (`internal/runtime/memory/memory-provider.ts`) into `types/`; the internal modules import + re-export them; `types/agent.ts:20,664` reference the local definitions. Removes madge cycle 2.

#### Why this step (action + reasoning)
1. **What this step does** — moves the two contract types to `types/`; `internal/plugins/types.ts` (which also owns `definePlugin`) and `memory-provider.ts` import the type from `types/` and re-export it, so the 5+? existing importers are unchanged.
2. **Why it is necessary now** — `types/agent.ts:20` imports `Plugin` and `:664` inline-imports `MemoryProvider` from `internal/`, forming madge cycle 2. Both are contract types. Cites D435.

#### Evidence
`madge` cycle 2: `types/agent.ts > internal/runtime/memory/memory-provider.ts`. `types/agent.ts:20`: `import type { Plugin } from "../internal/plugins/types.js"`. `:664`: `memoryProvider?: import("../internal/runtime/memory/memory-provider.js").MemoryProvider`.

#### Files to edit
```
packages/sdk/src/types/agent.ts — reference local Plugin + MemoryProvider; drop the 2 internal imports
packages/sdk/src/types/plugin.ts (NEW) OR types/agent.ts — host the Plugin type
packages/sdk/src/types/memory-provider.ts (NEW) OR types/agent.ts — host the MemoryProvider port type
packages/sdk/src/internal/plugins/types.ts — import Plugin from types/; keep definePlugin; re-export Plugin
packages/sdk/src/internal/runtime/memory/memory-provider.ts — import MemoryProvider from types/; re-export; impl unchanged
packages/sdk/src/types/index.ts — ensure both are publicly exported (they already are transitively)
```

#### Deep file dependency analysis
`Plugin` has 5 internal importers — all keep importing from `internal/plugins/types.ts` (which now re-exports the type from `types/`), so type identity is preserved (typecheck proves it). `MemoryProvider` port similarly re-exported. `definePlugin` stays in `internal/plugins/types.ts` (it's a function, not a contract type).

#### TDD
```
RED:     test_madge_cycle2_gone() — `pnpm quality:cycles`; assert cycle 2 (types/agent->memory-provider) absent (count 2->1). Fails before.
RED:     test_plugin_type_identity_preserved() — a typecheck fixture assigning an internal-imported Plugin to a types-imported Plugin compiles (same type).
GREEN:   relocate both types + re-export
REFACTOR: None expected
VERIFY:  pnpm quality:cycles && pnpm --filter @theokit/sdk typecheck && pnpm --filter @theokit/sdk test
```

#### Concurrency tests
(none — single-threaded) — type relocation.

#### Acceptance Criteria
- [ ] `pnpm quality:cycles` reports 1 cycle (cycle 2 gone), exit 0
- [ ] `grep -cE "from ['\"].*internal/" packages/sdk/src/types/agent.ts` returns 0
- [ ] `pnpm --filter @theokit/sdk typecheck` exit 0 (Plugin identity preserved across all 5 importers)
- [ ] No public-API change (`diff` public `dist/*.d.ts`)

#### DoD
- [ ] Cycle 2 gone; typecheck + full suite green; CHANGELOG note

---

## Phase 3: Cycle 3 — route facade→local-agent through a registry factory

### T3.1 — Add `localAgentFactory` to the registry; agent-helpers creates LocalAgent via the port

#### Objective
Extend `agent-factory-registry.ts` with `setLocalAgentFactory`/`getLocalAgentFactory`; `internal/local-agent/index.ts` registers `createLocalAgent` at module-init; `agent-helpers.ts` calls the factory instead of `new LocalAgent`, dropping its static value import. Removes madge cycle 3.

#### Why this step (action + reasoning)
1. **What this step does** — inverts the facade→local-agent value edge using the SAME registry-seam pattern that already inverts the reverse direction (`setAgentFacade`). agent-helpers depends on the port; local-agent registers into it.
2. **Why it is necessary now** — `agent-helpers.ts:14` statically imports `LocalAgent` (value), instantiated at :150,:231, forming madge cycle 3 (the 7-hop facade↔local-runtime). This is the runtime coupling the registry seam was meant to break. Cites D436. Done after the type moves (higher risk, isolated last).

#### Evidence
`madge` cycle 3: `a2a/subagent.ts > agent.ts > agent-helpers.ts > internal/local-agent/index.ts > ... > real-local-run-tools.ts`. `agent-helpers.ts:14` `import { LocalAgent }`; `:150,:231` `new LocalAgent(...)`. Registry seam: `agent.ts:17` `setAgentFacade` from `agent-factory-registry.ts`.

#### Files to edit
```
packages/sdk/src/internal/runtime/registry/agent-factory-registry.ts — add setLocalAgentFactory/getLocalAgentFactory (typed error if unset)
packages/sdk/src/internal/local-agent/index.ts — register createLocalAgent factory at module-init
packages/sdk/src/agent-helpers.ts — call getLocalAgentFactory()(...) at :150,:231; drop `import { LocalAgent }`
packages/sdk/tests/local-agent-factory-registry.test.ts (NEW) — RED: factory registered + used; unset -> typed error
```

#### Deep file dependency analysis
`agent-helpers` loses its static `internal/local-agent` value edge → cycle 3 broken. The factory is registered when `internal/local-agent/index.ts` is imported (which happens via the barrel chain that constructs agents). A fail-fast typed error on an unset factory converts any module-init ordering bug into a loud error, never a silent `undefined`.

#### Deep Dives
- **Invariant:** `getLocalAgentFactory()` MUST return the registered factory by the time `agent-helpers.createLocalAgent` runs. Registration is at module-init of the local-agent barrel; the same guarantee that makes `setAgentFacade` work today.
- **Edge case:** factory unset → throw a typed `ConfigurationError` (fail-fast, `rules/error-handling.md`), NOT return undefined.

#### TDD
```
RED:     test_local_agent_created_via_registry_factory() — Agent.create(...) produces a working LocalAgent through the factory (behavior identical to `new LocalAgent`).
RED:     test_unset_local_agent_factory_throws_typed_error() — getLocalAgentFactory() before registration throws ConfigurationError (not undefined).
RED:     test_madge_cycle3_gone() — `pnpm quality:cycles` reports 0 cycles.
GREEN:   add the factory register/get + rewire agent-helpers + register at barrel init
REFACTOR: None expected
VERIFY:  pnpm quality:cycles (0!) && pnpm --filter @theokit/sdk test && real-LLM smoke (agent-basics on OpenRouter)
```

#### Concurrency tests
(none — single-threaded) — module-init registration; no shared mutable runtime state changed.

#### Acceptance Criteria
- [ ] `pnpm quality:cycles` reports **0 cycles**, exit 0
- [ ] `grep -c "internal/local-agent" packages/sdk/src/agent-helpers.ts` returns 0 (no static value import)
- [ ] `Agent.create` still produces a working LocalAgent (full suite + real-LLM smoke green)
- [ ] Unset-factory path throws a typed `ConfigurationError`
- [ ] No public-API change

#### DoD
- [ ] Cycle 3 gone (0 cycles total); full suite + real-LLM green; CHANGELOG note

---

## Phase 4: #129 fork leaf + tighten the cycle gate 3→0

### T4.1 — Move `isCodePlugin` to a neutral leaf (close #129)

#### Objective
Move `isCodePlugin` (`internal/local-agent/local-agent-plugins.ts`) to a neutral leaf both `fork-agent.ts` and `local-agent` import one-way; `local-agent ↔ fork-agent` no longer mutual.

#### Why this step (action + reasoning)
1. **What this step does** — relocates `isCodePlugin` (imported by `fork-agent.ts:21` from local-agent) to a leaf module (e.g. `internal/fork/` or `internal/plugins/`).
2. **Why it is necessary now** — closes issue #129 (residual local-agent↔fork-agent edge); the audit's boundary finding. Cites the audit migration step 5.

#### Evidence
`fork-agent.ts:21`: `import { isCodePlugin } from "../../local-agent/local-agent-plugins.js"`; `local-agent-runtime-extensions.ts:18` type-only imports `ForkOptions/ForkResult` from fork-agent.

#### Files to edit
```
packages/sdk/src/internal/plugins/is-code-plugin.ts (NEW leaf) — host isCodePlugin
packages/sdk/src/internal/runtime/lifecycle/fork-agent.ts — import isCodePlugin from the leaf
packages/sdk/src/internal/local-agent/local-agent-plugins.ts — import/re-export isCodePlugin from the leaf (back-compat)
```

#### TDD
```
RED:     test_no_local_agent_fork_agent_mutual_edge() — grep: fork-agent no longer imports from local-agent (value); madge stays 0.
GREEN:   move isCodePlugin to the leaf; rewire
REFACTOR: None
VERIFY:  pnpm quality:cycles && pnpm quality:depcruise && pnpm --filter @theokit/sdk test
```

#### Concurrency tests
(none — single-threaded) — move only.

#### Acceptance Criteria
- [ ] `fork-agent.ts` no longer imports a value from `internal/local-agent`
- [ ] `pnpm quality:cycles` still 0; depcruise 0 violations

#### DoD
- [ ] #129 closed (comment the issue); suite green

### T4.2 — Tighten the `quality:cycles` gate 3 → 0

#### Objective
Change the madge cycle gate threshold from ≤ 3 to ≤ 0 (or 0), so any new cycle fails the gate.

#### Why this step (action + reasoning)
1. **What this step does** — updates the threshold in the cycle-gate script/config (`.claude/quality-gates.md` + the `quality:cycles` runner) from 3 to 0.
2. **Why it is necessary now** — locks the SE45 win: with 0 cycles achieved, the gate must enforce 0 going forward, else the debt silently returns. Done LAST (after 0 is reached).

#### Evidence
`pnpm quality:cycles` output: "gate threshold: ≤ 3". After Phases 1-4: 0 cycles.

#### Files to edit
```
(the cycle-gate config/script that prints "gate threshold: ≤ 3") — set threshold to 0
.claude/quality-gates.md — document the tightened G-gate
```

#### TDD
```
RED:     test_cycle_gate_threshold_is_zero() — `pnpm quality:cycles` prints "≤ 0" and passes (0 cycles). A synthetic added cycle would fail (verified once, then reverted).
GREEN:   set threshold 0
REFACTOR: None
VERIFY:  pnpm quality:cycles (passes at 0) && pnpm -w run validate
```

#### Concurrency tests
(none — single-threaded) — config change.

#### Acceptance Criteria
- [ ] `quality:cycles` gate threshold is 0; passes with 0 cycles
- [ ] `.claude/quality-gates.md` updated

#### DoD
- [ ] Gate tightened; validate green; CHANGELOG note

---

## Phase 5: Integration Validation (MANDATORY)

**Objective:** Prove 0 cycles + zero public-API break hold together in the full workload.

### Execution
```
pnpm -w run validate            # full gate (incl. quality:cycles at 0, depcruise, full suite, publint/attw, bundle)
pnpm quality:cycles             # 0 cycles at threshold 0
```
Real-LLM smoke (per `rules/real-llm-validation.md`): `examples/agent-basics` on OpenRouter still `Status: finished` (proves the registry-factory rewire didn't break agent creation).

### Acceptance Criteria
- [ ] `pnpm -w run validate` exit 0
- [ ] `madge` 0 cycles; gate threshold 0
- [ ] `dependency-cruiser` 0 violations
- [ ] Zero public-API change (`diff` public `dist/*.d.ts` byte-stable except the additively-re-homed contract types)
- [ ] real-LLM smoke `Status: finished`
- [ ] #129 closed

### If Validation Fails
Localize to the phase (sequential + gate-green), fix, re-run. Pre-existing issues logged in the PR.

---

## Coverage Matrix

| # | Gap / Requirement (SE45 DoD) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Cycle 1 removed (types/run.ts) | T1.1 | ToolResultGuardOptions → types/ |
| 2 | Cycle 2 removed (types/agent.ts) | T2.1 | Plugin + MemoryProvider → types/ |
| 3 | Cycle 3 removed (facade→local-agent) | T3.1 | localAgentFactory registry inversion |
| 4 | #129 closed | T4.1 | isCodePlugin → neutral leaf |
| 5 | madge 0 + gate tightened 3→0 | T4.2 | threshold 0 |
| 6 | Zero public-API break; validate green | T1.1, T2.1, T3.1 | re-exports keep API byte-stable; full gate in Phase 5 |

**Coverage: 6/6 (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] `pnpm -w run validate` green (incl. quality:cycles at 0)
- [ ] Zero type errors; zero lint warnings
- [ ] File-size budget respected (`quality:loc` ≤ 400)
- [ ] CHANGELOG.md `[Unreleased]` updated (Rule 6)
- [ ] Backward compatibility preserved — public API byte-stable; internal re-exports keep existing importers working
- [ ] madge 0 cycles; gate threshold 0; depcruise 0 violations; real-LLM smoke finished
- [ ] Changeset added for the sdk change (contract types re-homed — additive minor)
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merged

## Failure scenarios (when I/O external)

```
(none — no external I/O touched; pure internal restructuring. The real-LLM smoke in Phase 5 is a wiring proof, not a new dependency.)
```
