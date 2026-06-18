# Codebase Architecture Review — `@theokit/sdk`

> Target: `packages/sdk` · Audit date: 2026-06-18 · Source of truth: `architect-output/codebase-architect.db`
> Figures: `dimension-radar.svg`, `severity-matrix.svg` (same directory).

## 1. Executive Summary

- **Current architecture:** Modular layered TypeScript SDK — a thin static-class **facade** (`Agent`/`Theokit`/`Cron`/`Memory`) over a large, mostly well-decomposed `internal/*` implementation graph (78 modules, ~46k LOC).
- **Main issue:** Three HIGH-severity **upward imports** — internal implementation modules (`eval/runner.ts`, `scorers/llm-judge.ts`, `cron/run-job.ts`) import the public `Agent` facade, inverting the layer direction even though the cycle-breaking seam (`agent-factory-registry`) already exists and is correctly used by `local-agent`.
- **Recommended direction:** **Refactor Lightly.** Debt is concentrated and surgical; the spine (facade + ports + factories + 0 runtime cycles) is sound.
- **Risk level:** **LOW** — every proposed step is `behavior_change=none` except two `minor` (template/container track); the structural fix-seams already exist.
- **Architecture score:** **77 / 100** (weighted). DB point-sum 76/100. Both land in the **60-79 / Refactor Lightly** band.

## 2. Architecture Score

| Dimension | Score | Max | Pct | Key Finding |
|---|---|---|---|---|
| Folder Clarity | 16 | 20 | 80% | Zero generic folders, all kebab-case; dinged by 18 loose `internal/runtime` root files + 6 loose `internal/` root files + `internal/errors` misnomer |
| Cohesion | 14 | 20 | 72% | `internal/runtime` cohesion=1 is a packaging artifact (13 cohesive subdirs); `theokit-container`=2, `internal-root-utils`=2 are the genuine dings |
| Coupling | 15 | 20 | 75% | depcruise 0 runtime violations / 394 modules; 1 cosmetic type-only cycle; 3 HIGH facade up-imports (contained, fix-seam exists) |
| Pattern Fit | 12 | 15 | 80% | Facade / Ports & Adapters / Factory / Strategy all `present_correct`; only `theokit-container` is cargo-cult |
| Testability | 8 | 10 | 82% | Clean `tests/` mirror tree (0 tests under `src/`); registry seam + ports enable isolation |
| Scalability | 8 | 10 | 82% | Multi-entry subpaths + ports support extension; in-flight `@theokit/sdk-memory` extraction proves the seam |
| Onboarding Clarity | 3 | 5 | 68% | Facade barrel + locked `docs.md` are clear; loose runtime root files + unexported `@public` container hurt discovery |
| **Total (weighted)** | **77** | **100** | **77%** | **Refactor Lightly** |

### Score interpretation

- **60-79 (this codebase):** Solid foundation with known gaps. Targeted refactoring recommended.

> **Calibration note.** The weighted percentage (77.2 -> 77) and the DB integer point-sum (76/100) differ by rounding: percentages map imperfectly onto small point scales (cohesion 72%->14/20=70%, onboarding 68%->3/5=60%). The verdict band is identical either way. No dimension scored below 80% confidence; the audit gate passed Phase 2 at 0.95 and Phases 3-5 at 0.93.

## 3. Current Structure

### Detected architectural style

**Facade + hidden-internals (layered).** A small public surface (`src/index.ts`, `agent.ts:64`, `theokit.ts`) presents static classes with private constructors; `create()` delegates into `internal/*` via lazy dynamic `import()`. The implementation graph is layered: `types/` (domain contract) <- `internal/*` (application + infrastructure) <- `agent.ts`/`server`/`subscription` (interface). This matches the `@anthropic-ai/claude-agent-sdk` shape and is the right choice for an SDK with a locked public contract over a mutable internal graph.

Two deliberate boundary choices shape the layout:
- **Curated `internal/*` subpath exports** (`./internal/persistence`, `./internal/plugins`, `./internal/observability`, `./internal/security`) — `@internal`-annotated, semver-exempt (boundary #1).
- **Ports for external integrations** — `MemoryProvider`, `BudgetTracker`, embedding adapters (12), telemetry adapters (7), LLM transports (9+).

```
packages/sdk/src/
|-- index.ts                 # public barrel (facade exports)
|-- agent.ts                 # Agent facade (static class, private ctor); setAgentCreate at :416
|-- theokit.ts               # Theokit namespace facade
|-- errors.ts                # 17 public error CLASSES (692 LOC, cohesive)
|-- theokit-container.ts     # @public but UNEXPORTED, cargo-cult DI (DELETE — see section 7)
|-- define-tool.ts / agent-factory.ts / ...   # canonical factory functions
|-- types/                   # domain contract layer (24 files, 3,391 LOC) — pure, DIP-respecting
|-- server/                  # HTTP/handler interface layer
|-- subscription/            # streaming interface (11 files, 1,832 LOC)
`-- internal/
    |-- http.ts env.ts ids.ts fixture-mode.ts ...   # 6 loose root "utils bucket" (679 LOC)
    |-- errors/mappers/       # provider error MAPPERS (misnamed — holds no classes)
    |-- llm/                  # LLM router + 9+ transports (Strategy)
    |-- memory/               # 44 files, 4,621 LOC; 22 loose root files (mid-extraction)
    |-- eval/ scorers/ cron/  # the 3 facade up-import offenders
    `-- runtime/              # 93 files, 11,073 LOC — 13 cohesive subdirs + 18 LOOSE root files
        |-- budget/ cloud/ compression/ context/ fixtures/ hooks/
        |-- local-agent/ memory/ plugins/ registry/ session/ skills/ system-prompt/
        `-- run-until.ts fork-agent.ts providers-manager.ts ... (18 loose .ts, 1,478 LOC)
```

### Module inventory (largest by LOC)

| Module | LOC | Files | Layer | Cohesion (1-5) | Responsibility |
|---|---|---|---|---|---|
| internal-runtime | 11,073 | 93 | application | 1 (artifact) | Agent runtime; 13 cohesive subdirs + 18 loose root files |
| internal-memory | 4,621 | 44 | infrastructure | 3 | Memory domain; cohesive but 22-file flat root |
| internal-llm | 3,712 | 24 | infrastructure | 4 (n/a) | LLM router + 9+ transports (Strategy) |
| types | 3,391 | 24 | domain | 3 | Public type contract; 2 type-only down-references |
| internal-runtime-local-agent | 2,355 | 15 | application | 4 (n/a) | Local agent execution |
| subscription | 1,832 | 11 | interface | 4 (n/a) | Streaming (SSE/WS) public surface |
| internal-workflow | 1,806 | 18 | application | 4 (n/a) | Workflow orchestration |
| internal-agent-loop | 1,544 | 9 | application | 4 (n/a) | Tool-dispatch agent loop |
| internal-persistence | 1,512 | 15 | infrastructure | 4 (n/a) | Persistence (subpath export) |
| internal-runtime-root | 1,478 | 13 | application | 2 | The 18 loose runtime root files |
| internal-errors | 709 | 7 | infrastructure | 4 (info) | Provider error mappers (misnamed) |
| internal-root-utils | 679 | 6 | infrastructure | 2 | De-facto utils bucket at `internal/` root |
| theokit-container | 108 | 1 | interface | 2 | Cargo-cult DI container (delete) |

*(Cohesion scores are recorded where Phase 2 scored a finding; "(n/a)"/"(artifact)" mark modules that are cohesive but were not individually scored, or whose low score is a packaging artifact.)*

## 4. Architectural Problems

Distribution across 25 diagnostic findings: **0 critical · 7 high · 9 medium · 4 low · 5 info/OK** (see `severity-matrix.svg`).

### Critical

None. dependency-cruiser reports **0 runtime violations across 394 modules**.

### High

| # | Problem | File/Folder | Evidence | Impact | Confidence |
|---|---|---|---|---|---|
| H1 | Internal module imports public `Agent` facade (layer inversion) | `internal/cron/run-job.ts:1` | VALUE import; calls `Agent.get` (:30), `Agent.resume` (:37), `Agent.create` (:45) — widest-surface offender | Inverts dependency direction; blocks `internal/*` from being cycle-safe as it grows | 80% |
| H2 | Internal module imports public `Agent` facade | `internal/scorers/llm-judge.ts:11` | VALUE import; calls `Agent.prompt` (:63) | Same inversion; seam exposes only `create()` so adoption needs a widen | 80% |
| H3 | Internal module imports public `Agent` facade | `internal/eval/runner.ts:11` | VALUE import; uses `Agent.batch` | Same inversion | 80% |
| H4 | `internal/runtime` god-module | `src/internal/runtime/` | 93 files / 11,073 LOC (~24% of src); 13 subfolders + 18 loose root files | Reader cannot name the module's responsibility from its shape | 95% |
| H5 | 18 loose root files mix unrelated concerns | `internal/runtime/validate-agent-options.ts` (+17) | 1,478 LOC: concurrency, process-IO, parsing, validation, lifecycle, orchestration grouped by "being leftover" | SRP broken at package level; no folder navigation | 90% |
| H6 | `theokit-container.ts` cargo-cult DI (cohesion) | `src/theokit-container.ts:24` | `@public` but NOT exported from `index.ts`; `run()` (:73) drops registered tools/workflows | Unwired public surface; partial stub that surprises consumers | 90% |
| H7 | `theokit-container.ts` cargo-cult DI (pattern) | `src/theokit-container.ts:24` | Generic IoC container revoked as mandatory by ADR D431; broken `run()`; zero `src/` callers | Contradicts project's own locked decision; dead, misleading | HIGH |

*H6 and H7 are the same artifact flagged independently by the cohesion and pattern lenses — one fix (delete) resolves both.*

### Medium

| # | Problem | File/Folder | Evidence | Impact | Confidence |
|---|---|---|---|---|---|
| M1 | `internal/memory` cohesive but flat | `src/internal/memory/` | 44 files; 22 loose root files mixing index/embedding/active-memory/migration | Hides sub-structure; the natural seam for `@theokit/sdk-memory` extraction | 80% |
| M2 | `types/` leaks 2 type-only down-references into `internal/runtime` | `src/types/agent.ts:512,537` | `import("../internal/runtime/budget/...")` and `.../memory/memory-provider` in type position | Domain contract coupled to impl detail (type-only, erased; DIP wrinkle) | 85% |
| M3 | 6 loose files form de-facto utils bucket at `internal/` root | `src/internal/http.ts` (+5) | `http/env/ids/fixture-mode/cache-guard/structured-output-helpers` (679 LOC), no shared responsibility | architecture section 6 anti-pattern in all but name | 80% |
| M4 | Registry seam present but inconsistently adopted | `internal/runtime/registry/agent-factory-registry.ts:29` | Seam forbids exactly the H1-H3 edges; 3 modules took the edge anyway | Architectural ambiguity; future cycle-regression risk | MEDIUM |
| M5 | `internal/errors/` misnamed | `src/internal/errors/` | Holds only `mappers/`; actual error classes live in `src/errors.ts` | Reader looks for classes in the wrong place | 85% |
| M6 | `abort-utils.ts` / `shared-handler.ts` generic vocabulary | `internal/runtime/abort-utils.ts` | Only `-utils`/`shared-` names in `src/` (no generic folders exist) | Invites future dumping | 80% |
| M7 | `TheoKitContainer` non-discoverable | `src/theokit-container.ts:24` | `@public` yet absent from `index.ts` barrel; only tests reference it | Invisible to consumers and tooling | 90% |
| M8 | Type-only circular dependency | `types/agent.ts:537 <-> memory-provider.ts:32` | Both arms type-only/erased; madge reports it, depcruise reports 0 | Cosmetic; nil runtime blast radius | (consensus, threshold=0) |
| M9 | 4 `internal/*` modules are public subpath exports | `package.json` | `./internal/{persistence,plugins,observability,security}` exported | API-stability liability; mitigated by `@internal` + semver-exempt | (consensus) |

### Low

| # | Problem | File | Evidence |
|---|---|---|---|
| L1 | `index-manager` split across 4 same-prefix files | `internal/memory/index-manager*.ts` | 651 LOC of one concept as 4 siblings instead of an `index-manager/` folder |
| L2 | `plugins/manager.ts` undomained | `internal/plugins/manager.ts` | Exports `PluginManager`; siblings are domain-prefixed (`context-manager`, etc.) |
| L3 | `abort-utils.ts` generic name (low arm) | `internal/runtime/abort-utils.ts` | Pair with the runtime split so it lands in a behavior-named folder |
| L4 | `boundary no_issues` — `types/` clean | `src/types/` | Negative evidence: 0 value imports, 0 infra in the contract layer |

## 5. Cohesion Analysis

| Module | Score (1-5) | Assessment | Evidence |
|---|---|---|---|
| `internal/runtime` (as one node) | 1 | Packaging artifact, not a design flaw | 13 cohesive subdirs underneath; the real residue is 18 loose root files (pattern #7) |
| `theokit-container` | 2 | Smell — cargo-cult, broken `run()` | Drops registered tools/workflows; unexported; zero callers |
| `internal-root-utils` | 2 | Smell — de-facto utils bucket | 6 unrelated cross-cutting files at `internal/` root |
| `internal/runtime-root` (18 loose files) | 2 | Smell — grouped by leftover-ness | Concurrency + IO + parsing + validation + lifecycle + orchestration in one flat dir |
| `internal/memory` | 3 | Mixed — cohesive domain, flat 22-file root | Genuinely memory-domain; sub-concerns not foldered |
| `types/` | 3 | Mixed — pure contract, 2 down-references | Otherwise clean domain layer; the 2 type-only refs are the only wrinkle |
| `index-manager` cluster | 3 | Type-grouped not behavior-grouped | 4 same-prefix sibling files |
| `internal/errors` (mappers) | 4 | Highly cohesive | One concern (provider error mapping); Phase-1 "duplication" flag is a FALSE POSITIVE |
| `internal/llm`, `local-agent`, `subscription`, `agent-loop`, facade | 4-5 | Cohesive | Single clear responsibility each; not individually flagged |

## 6. Coupling Analysis

### Circular Dependencies

| Source -> Target | Evidence | Severity |
|---|---|---|
| `types/agent.ts:537` <-> `internal/runtime/memory/memory-provider.ts:32` | Both arms type-only (`import()` in type position + `import type`), fully erased by `tsc`. madge reports it (parses type nodes); **depcruise reports 0 runtime cycles**. The Phase-1 budget-tracker arm is FALSE (no back-import). | medium (consensus threshold=0; runtime blast radius nil) |

### Wrong-Direction Imports

| Source (low) -> Target (high) | File:Line | Severity |
|---|---|---|
| `internal/cron` -> `Agent` facade | `internal/cron/run-job.ts:1` (`get`/`resume`/`create`) | high |
| `internal/scorers` -> `Agent` facade | `internal/scorers/llm-judge.ts:11` (`prompt`) | high |
| `internal/eval` -> `Agent` facade | `internal/eval/runner.ts:11` (`batch`) | high |

All three are **VALUE** imports (not type-only). The correct direction is facade -> internal. The fix-seam (`agent-factory-registry`, `setAgentCreate` at `agent.ts:416`) already exists and is correctly consumed by `local-agent-runtime-extensions.ts` — these three modules simply did not adopt it. Today the seam exposes only `create()`; widening it to `{create,prompt,get,resume,batch}` unblocks all three (see Migration Group A).

### Infrastructure Leakage

| Domain file | Infrastructure import | Evidence |
|---|---|---|
| `src/types/agent.ts` | `internal/runtime/{budget,memory}` port types | `:512` `BudgetTracker`, `:537` `MemoryProvider` — **type-only, erased at runtime**. Not a runtime leak; a DIP-direction wrinkle. Optional fix: relocate the port interfaces into `types/`. |

**Verified clean (negative evidence):** `types/` has zero value imports, zero `node:` builtins, zero DB drivers, zero concrete `internal/` runtime value imports. The contract layer behaves as a pure, DIP-respecting layer.

## 7. Design Pattern Assessment

| Pattern | Status | Assessment | Evidence | Recommendation |
|---|---|---|---|---|
| Facade (static classes) | present, correct | Right pattern for a locked public contract over a mutable internal graph | `agent.ts:64` private ctor; `create()` (:97) lazy `import()` delegation | None — keep |
| Ports & Adapters | present, correct | Justified by real multi-impl variation, not premature abstraction | `MemoryProvider` (`memory-provider.ts:122`) 3+ impls; 12 embedding + 7 telemetry adapters | None — keep; finish `@theokit/sdk-memory` extraction |
| Factory functions | present, correct | Canonical-factory rule (ADR D431) actually followed across the surface | `defineTool:44`, `createAgentFactory:42`, `defineSubAgent:35`, `defineAuth:60`, `defineSubscription:69`, `definePlugin:143` | None — the rule holds |
| Strategy (LLM providers) | present, correct | 9+ interchangeable transports behind one `LlmClient`; OCP respected | `router.ts:55-150` switch over provider -> shared interface (`types.ts:121`) | None — adding a provider is an addition |
| Registry / DIP seam | present, **misapplied** | Built to forbid the H1-H3 edges, then 3 modules bypassed it | `agent-factory-registry.ts:29`; `local-agent` adopts it, eval/scorers/cron do not | Widen seam to a full `AgentFacadePort`; migrate the 3 callers |
| DI Container (`TheoKitContainer`) | **cargo-cult** | Orphan, broken, contradicts the project's own ADR D431 | `theokit-container.ts:24` `@public` unexported; `run()` (:73) drops tools/workflows; 0 `src` callers | **Delete** (Migration Group C) |
| New pattern for runtime god-module | **missing — not needed** | Cohesion=1 is a packaging artifact; the load-bearing seams already exist | 13 cohesive subdirs; ports + registry already the right tools | Relocate 18 loose files; do NOT add Mediator/Command/DI (pattern theater) |

## 8. Positive Findings (what the codebase does WELL)

This is a **healthy codebase** with concentrated, surgical debt. The following are credited from DB evidence, not courtesy:

1. **Zero runtime circular dependencies / zero layer violations** across 394 modules (dependency-cruiser) — the single most important structural health signal, and it is clean.
2. **No generic folders anywhere.** There is no `utils/`, `helpers/`, `common/`, `misc/`, or `shared/` directory in `src/` — the architecture section 6 anti-pattern is structurally avoided (the residue is loose *files*, not dumping-ground *folders*).
3. **Consistent kebab-case naming** across the entire tree; the only generic-vocabulary files are two (`abort-utils.ts`, `shared-handler.ts`) out of ~400.
4. **Facade pattern applied correctly** — a thin, locked public barrel (`docs.md`-governed) over a churning internal graph, matching the `@anthropic-ai/claude-agent-sdk` shape. Lazy `import()` delegation also serves DTS-bundle/module-graph management.
5. **Ports & Adapters doing real work** — the `MemoryProvider`/`BudgetTracker` ports are extracting `@theokit/sdk-memory` to a sibling package right now; the noop default preserves back-compat during the migration. This is concrete variation, not speculative abstraction.
6. **Factory-function convention (ADR D431) genuinely followed** — every agentic capability ships as a low-level factory; no mandatory decorators, no generic IoC in the surface. Consistency here is rarer than the pattern itself.
7. **Strategy pattern earns its keep** — 9+ interchangeable LLM transports behind one `LlmClient` interface; adding a provider is OCP-clean (new case + new transport, no cross-cutting edit).
8. **Clean test mirror tree** — 0 test files under `src/`; everything in `tests/`. The `agent-factory-registry` seam and the ports enable isolated testing.
9. **The cycle-breaking seam already exists and is used correctly** by `local-agent` — the H1-H3 fix is "adopt the seam you already built", not "build a seam".
10. **Honest internal-boundary labeling** — the 4 `internal/*` subpath exports carry `@internal` JSDoc and a documented semver-exempt contract; curated barrels do not re-export raw internals.

The audit also self-corrected three Phase-1 over-claims: the `internal/errors` "duplication" was a FALSE POSITIVE (it is cohesive mappers); the cycle is type-only not value; the budget-tracker cycle arm does not exist.

## 9. Proposed Folder Structure

Target shape after the migration (Phase 4 proposal, finding #5 = KEEP the public API / facade / subpaths / 13 runtime subdirs as-is):

```
packages/sdk/src/
|-- index.ts                       # unchanged public barrel
|-- agent.ts                       # registers full AgentFacadePort at :416 (was setAgentCreate)
|-- theokit.ts  errors.ts          # unchanged
|   (theokit-container.ts DELETED)
|-- types/                         # unchanged; optionally host MemoryProvider/BudgetTracker ports
|-- server/  subscription/         # unchanged interface layers
`-- internal/
    |-- error-mappers/             # renamed from errors/; mappers/ nesting collapsed
    |-- llm/  memory/  eval/  scorers/  cron/   # eval/scorers/cron now use the facade port
    `-- runtime/
        |-- budget/ cloud/ compression/ context/ fixtures/ hooks/
        |-- local-agent/ memory/ plugins/ registry/ session/ skills/
        |-- system-prompt/         # absorbs the loose system-prompt.ts
        |-- lifecycle/             # run-until, fork-agent, post-run-lifecycle, spawn-collect, auto-summarize
        |-- validation/            # validate-agent-options, validate-response
        |-- concurrency/           # async-local-storage, async-semaphore, abort-utils
        |-- tools/                 # mcp-tools, shell-tool, hitl-middleware
        `-- config/                # default-model, workspace-dir, providers-manager
        #   (zero loose .ts files at runtime root — the section 27 checkpoint)
```

### Responsibilities per folder

| Folder | Responsibility | Changes from current |
|---|---|---|
| `internal/runtime/lifecycle/` | Run/fork/post-run/spawn/summarize lifecycle | NEW — absorbs 5 loose root files |
| `internal/runtime/validation/` | Agent-option & response validation | NEW — absorbs 2 loose root files |
| `internal/runtime/concurrency/` | Async primitives (semaphore, ALS, abort) | NEW — absorbs 3 loose root files |
| `internal/runtime/tools/` | MCP tools, shell tool, HITL middleware | NEW — absorbs 3 loose root files |
| `internal/runtime/config/` | Default model, workspace dir, providers-manager | NEW — absorbs 3 loose root files |
| `internal/runtime/system-prompt/` | System-prompt assembly | Absorbs the loose `system-prompt.ts` (resolves file-vs-dir collision) |
| `internal/error-mappers/` | Provider -> `TheokitAgentError` translation | RENAMED from `internal/errors/`; flattens `mappers/` nesting |
| `internal/runtime/registry/` | `AgentFacadePort` seam | Widened from single `create` fn to `{create,prompt,get,resume,batch}` |
| `types/` | Domain contract | Unchanged (optional: host the two ports) |
| Public facade / subpaths / 13 runtime subdirs | Stable public API | **KEEP AS-IS** (architect finding #5) |

## 10. Migration Plan

19 detailed steps (sourced from `migration_steps WHERE validation_command IS NOT NULL`; the 4 thin draft rows step_number 1-4 are deduped per the quality gate). Grouped A -> B -> C -> D -> Z. Every step is independently shippable; `tsc --noEmit` is the oracle for import-path correctness on all moves.

### Group A — Coupling fix: widen the seam, kill the 3 facade up-imports (risk: LOW; behavior: none)

| Step | Action | Files | Validation |
|---|---|---|---|
| A1 (#10) | Add `AgentFacadePort {create,prompt,get,resume,batch}` + `setAgentFacade`/`getAgentFacade`; keep `setAgentCreate`/`getAgentCreate` as shims (additive, no caller migrated) | `registry/agent-factory-registry.ts` + RED test | `tsc --noEmit && vitest run agent-factory-registry` |
| A2 (#11) | Register full port at composition root | `agent.ts:16,:416` (`setAgentFacade({...})`) | `tsc --noEmit && vitest run` |
| A3 (#12) | Migrate `scorers/llm-judge.ts` -> `getAgentFacade().prompt` | `llm-judge.ts:11,:63` | `tsc && vitest run llm-judge && grep -c` must be 0 |
| A4 (#13) | Migrate `cron/run-job.ts` -> `getAgentFacade()` (get/resume/create) | `run-job.ts:1,:30,:37,:45` | `tsc && vitest run run-job && grep -c` must be 0 |
| A5 (#14) | Migrate `eval/runner.ts` -> `getAgentFacade().batch` | `runner.ts:11,:261` | `tsc && vitest run runner && grep -c` must be 0 |
| A6 (#15) | **Checkpoint:** prove zero internal->facade up-imports remain | (verification) | `test $(grep -rl '../../agent' src/internal --include=*.ts | wc -l) -eq 0 && quality:depcruise && quality:cycles && vitest run` |

**Effort: ~0.5-1 day.** Highest-value group — removes all 3 HIGH coupling findings.

### Group B — Cohesion fix: relocate the 18 loose runtime root files (risk: LOW, B6 MEDIUM; behavior: none)

| Step | Action | Target | Validation |
|---|---|---|---|
| B1 (#20) | `git mv` lifecycle files (5) + tests | `runtime/lifecycle/` | `tsc && quality:cycles && vitest run && validate:naming` |
| B2 (#21) | `git mv` validation files (2) + tests | `runtime/validation/` | same |
| B3 (#22) | `git mv` concurrency files (3) + tests | `runtime/concurrency/` | same (async-local-storage widely imported — tsc is the net) |
| B4 (#23) | `git mv` tools/middleware files (3) + tests | `runtime/tools/` | same |
| B5 (#24) | `git mv` config files (3) + tests | `runtime/config/` | same |
| B6 (#25) | Resolve `system-prompt.ts` vs `system-prompt/` collision (own isolated commit) | `runtime/system-prompt/` | `tsc && quality:cycles && quality:depcruise && vitest run && validate:naming` — **MEDIUM risk** (shared basename) |
| B7 (#26) | Relocate `yaml-frontmatter.ts` (prefer existing `context/` over a 1-file `parsing/`) | `runtime/context/` | `tsc && quality:cycles && vitest run && validate:naming` |
| B8 (#27) | **Checkpoint:** `ls runtime/*.ts` must be empty; full gate | (verification) | `test $(ls -1 src/internal/runtime/*.ts | wc -l) -eq 0 && build && tsc && vitest run && quality:dead && quality:cycles && quality:depcruise` |

**Effort: ~1-1.5 days.** Pure git-mv + mechanical import fixups; lifts the cohesion=1 packaging artifact.

### Group C — Dead-code cleanup: remove the cargo-cult container (risk: LOW, C2 MEDIUM; behavior: minor)

| Step | Action | Files | Validation |
|---|---|---|---|
| C1 (#30) | Rewrite `templates/multi-agent` to `Agent.create()` factory **before** the delete (template import is already broken) | `templates/multi-agent/src/index.ts:9` | `grep -c TheoKitContainer` = 0; `tsc --noEmit` |
| C2 (#31) | Trim container-shaped assertions from e2e tests; **preserve** error-propagation coverage via `Agent.create` | `tests/e2e/{container-multi-agent,error-propagation}.e2e.test.ts` | `vitest run tests/e2e && tsc` — **MEDIUM** (coverage-bearing; re-express, don't blind-delete) |
| C3 (#32) | Delete `src/theokit-container.ts` + `tests/theokit-container.test.ts` | DELETE | `test ! -f ... && grep -rl theokit-container = 0 && tsc && vitest run && quality:dead && build` |

**Effort: ~0.5 day.** Removes H6/H7 and the only cargo-cult pattern.

### Group D — Naming (risk: LOW; behavior: none; OPTIONAL)

| Step | Action | Files | Validation |
|---|---|---|---|
| D1 (#40) | Rename `internal/errors/` -> `internal/error-mappers/`; collapse `mappers/` nesting | `git mv errors/mappers/*.ts -> error-mappers/*.ts` | `test ! -d src/internal/errors && tsc && quality:cycles && quality:depcruise && vitest run && validate:naming` |

**Effort: ~1-2 hours.** Skippable without affecting A/B/C.

### Group Z — Final gate

| Step | Action | Validation |
|---|---|---|
| Z (#50) | Single end-to-end gate after the last shipped group | `pnpm run validate` (biome + build + typecheck + test + ls-lint + publint + attw + knip/cycles/depcruise + bundle budget) |

**Total estimated effort: 2.5-4 days** of focused work, fully incremental, each step a green-suite PR.

## 11. Validation Checklist

Per the migration's own gates — every step must satisfy these before its PR merges:

- [ ] `tsc --noEmit` passes (the oracle for every import-path move)
- [ ] `vitest run --no-file-parallelism` green (full suite, or targeted file at minimum)
- [ ] `pnpm run quality:cycles` — no new cycles
- [ ] `pnpm run quality:depcruise` — 0 runtime violations preserved
- [ ] `pnpm run quality:dead` (knip) — no orphan left by a move/delete
- [ ] `pnpm run validate:naming` (ls-lint) — kebab-case preserved
- [ ] `pnpm run build` (tsup) succeeds — dual ESM/CJS intact
- [ ] Group-closing greps return 0 (A6: no facade up-imports; B8: no loose runtime root files; C3: no `theokit-container` references)
- [ ] `pnpm run validate` (publint + attw + bundle budget) green before the release PR
- [ ] `CHANGELOG.md [Unreleased]` updated (Unbreakable Rule 6)

## 12. Final Verdict

**Recommendation:** **Refactor Lightly.**

**Rationale:** At 77/100 this is a structurally sound SDK — facade, ports, factories, and Strategy are all applied correctly, with zero runtime cycles across 394 modules. The debt is concentrated and surgical: three facade up-imports fixable by adopting a seam that already exists, an 18-file packaging-artifact sprawl fixable by pure `git mv`, and one dead cargo-cult container to delete. None of it requires boundary surgery or a rewrite; all 19 steps are behavior-preserving and independently shippable.

**Estimated effort:** **2.5-4 days** (Group A ~1d highest-value; B ~1-1.5d; C ~0.5d; D optional ~2h).

## Methodology

- **Tools used:** dependency-cruiser (runtime cycles / layer violations), madge (type-node cycles), knip (dead code), `tsc` (type oracle), ls-lint (naming), `find`/`grep`/`wc` (LOC + file counts), manual source reads. All findings file:line-cited and source-verified at the quality gate.
- **Files inspected:** 11 deep-read + 14 sampled of 25 inventoried (44% total, 56% deep-read coverage). 78 modules catalogued.
- **Quality gates:** Phase 2 diagnosis PASS 0.95; Phases 3-5 patterns/proposal/plan PASS 0.93.
- **Confidence level:** **HIGH** for coupling/pattern/structure (consensus-sourced + source-verified at exact lines); **MEDIUM-HIGH** for cohesion/LOC thresholds (heuristic). All dimensions scored at >= the 80% confidence gate.

### Threshold Legend

| Threshold | Value | Source |
|---|---|---|
| circular_dependency | 0 | consensus |
| wrong_direction_import | 0 | consensus |
| infra_in_domain | 0 | consensus |
| generic_folder_names | 0 | consensus |
| behavior_change_none_required | 1 | consensus |
| cohesion_min_score | 3 | heuristic |
| confidence_threshold | 80 | heuristic |
| file_count_per_module_max | 30 | heuristic |
| module_loc_max | 2000 | heuristic (folklore; no strong source) |
| pattern_overuse_threshold | 3 | heuristic |
| public_api_max | 20 | heuristic |
