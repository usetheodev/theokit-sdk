# Plan: Agentic Decorators Phase 2 — Complete Rule #9 Compliance

> **Version 1.0** — Ships 9 remaining agentic decorators (`@Tool`, `@Workflow`, `@Eval`, `@Cron`, `@Subscription`, `@Auth`, `@Retriever`, `@Reranker`, `@TextSplitter`) in `@theokit/di-agent` to achieve 100% Rule #9 compliance. Follows the exact pattern proven in Phase 1 (metadata key + decorator + reader helper + tests).

## Goal

> "Ship 9 agentic decorators in `@theokit/di-agent` so that every SDK agentic capability has a `@Decorator` API surface, measured by `pnpm --filter @theokit/di-agent exec vitest run` exit 0 with 60+ new tests and `grep -c 'NEEDS_DECORATOR' audit` returning 0."

## Context

The Phase 1 agentic decorators plan shipped 4 decorators (`@UseSandbox`, `@SubAgent`, `@Hitl`, `@AutoSummarize`) with 35 tests. A comprehensive audit on 2026-06-10 identified 9 additional agentic features lacking decorator support, violating Inviolable Rule #9. Each follows the identical pattern: `METADATA_KEYS` entry in `@theokit/di` → property/method/class decorator in `@theokit/di-agent` → reader helper → tests.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/di/src/internal/metadata.ts` | ~35 | `c4c1745` (2026-06-10) | METADATA_KEYS registry (12 keys) | Add 9 new keys |
| `packages/di-agent/src/index.ts` | ~15 | `c4c1745` (2026-06-10) | Barrel export (9 exports) | Add 9 new exports |
| `packages/di-agent/src/decorators/tool.ts` (NEW) | 0 | — | @Tool decorator | — |
| `packages/di-agent/src/decorators/workflow.ts` (NEW) | 0 | — | @Workflow decorator | — |
| `packages/di-agent/src/decorators/eval-decorator.ts` (NEW) | 0 | — | @Eval decorator | — |
| `packages/di-agent/src/decorators/cron.ts` (NEW) | 0 | — | @Cron decorator | — |
| `packages/di-agent/src/decorators/subscription.ts` (NEW) | 0 | — | @Subscription decorator | — |
| `packages/di-agent/src/decorators/auth.ts` (NEW) | 0 | — | @Auth decorator | — |
| `packages/di-agent/src/decorators/retriever.ts` (NEW) | 0 | — | @Retriever decorator | — |
| `packages/di-agent/src/decorators/reranker.ts` (NEW) | 0 | — | @Reranker decorator | — |
| `packages/di-agent/src/decorators/text-splitter.ts` (NEW) | 0 | — | @TextSplitter decorator | — |
| `packages/di-agent/tests/tool.test.ts` (NEW) | 0 | — | — | — |
| `packages/di-agent/tests/workflow.test.ts` (NEW) | 0 | — | — | — |
| `packages/di-agent/tests/eval-decorator.test.ts` (NEW) | 0 | — | — | — |
| `packages/di-agent/tests/cron.test.ts` (NEW) | 0 | — | — | — |
| `packages/di-agent/tests/subscription.test.ts` (NEW) | 0 | — | — | — |
| `packages/di-agent/tests/auth.test.ts` (NEW) | 0 | — | — | — |
| `packages/di-agent/tests/retriever.test.ts` (NEW) | 0 | — | — | — |
| `packages/di-agent/tests/reranker.test.ts` (NEW) | 0 | — | — | — |
| `packages/di-agent/tests/text-splitter.test.ts` (NEW) | 0 | — | — | — |

### Current callers / dependents

- **Phase 1 decorators** (`@UseSandbox`, `@SubAgent`, `@Hitl`, `@AutoSummarize`) — 4 decorators + 4 readers already in `di-agent`, proven pattern
- **`METADATA_KEYS`** — currently 12 keys; adding 9 more (total 21)
- **`defineTool`** — exported from `@theokit/sdk`; no DI integration
- **`Workflow.create`** — exported from `@theokit/sdk`; no DI integration
- **`Eval.create`** — exported from `@theokit/sdk`; no DI integration
- **`Cron.create`** — exported from `@theokit/sdk`; no DI integration
- **`defineSubscription`** — exported from `@theokit/sdk/subscription`; no DI integration
- **`defineAuth`** — exported from `@theokit/sdk/server/auth`; no DI integration
- **`VectorRetriever`** — exported from `@theokit/sdk/rag`; no DI integration
- **`CohereReranker`** — exported from `@theokit/sdk/rag`; no DI integration
- **Text splitters** — exported from `@theokit/sdk/rag`; no DI integration

### Domain glossary

- **Property decorator** — `@Tool()` on a class property; stores tool spec as metadata
- **Class decorator** — `@Workflow()` on a class; stores workflow config as metadata
- **Method decorator** — `@Cron()` on a method; stores cron schedule as metadata
- **Reader helper** — `readToolMetadata(MyClass)` returns stored metadata for downstream wiring

### Architecture boundaries affected

- **`@theokit/di` → metadata keys** — 9 new string constants (additive, no breaking change)
- **`@theokit/di-agent` → decorators** — 9 new files following Phase 1 pattern exactly

## Prior Art & Related Work

- **Phase 1 decorators** — `di-agent/src/decorators/{use-sandbox,sub-agent,hitl,auto-summarize}.ts` — proven pattern with 35 tests, validated with real LLM
- **NestJS decorator pattern** — industry standard for `@Injectable`, `@Controller`, `@Get`, `@Post` metadata decorators
- **Existing `METADATA_KEYS` pattern** — centralized registry, `Reflect.defineMetadata`, reader helpers

## Objective

- [x] Verify 9 new metadata keys added to `METADATA_KEYS` in `@theokit/di`
- [x] Verify 9 new decorators exported from `@theokit/di-agent`
- [x] Verify 9 reader helpers exported (`readToolMetadata`, `readWorkflowMetadata`, etc.)
- [x] Run `pnpm --filter @theokit/di-agent exec vitest run` exit 0 with 60+ new tests (99 passing)
- [x] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` exit 0

## ADRs

### D1 — All 9 decorators follow Phase 1 pattern exactly

**Decision:** Each decorator is a standalone file with: `import "reflect-metadata"` + `import { METADATA_KEYS } from "@theokit/di"` + decorator function + reader helper. No variation from the proven pattern.

**Rationale:** Per DRY: the pattern is proven (35 tests, real LLM validation). Per KISS: no new abstractions, no decorator base class, no metaprogramming. Each file is ~25 LoC, self-contained.

**Alternatives considered:**
- **(A) Abstract decorator base class** — rejected: adds indirection for no benefit. Each decorator is 25 LoC; a base class would be 40 LoC and save 5 LoC per decorator. Net complexity increase.

**Consequences:** 9 files that look similar. This is intentional — similar code representing different concepts is NOT a DRY violation.

### D2 — Decorator type selection per feature

**Decision:**

| Decorator | Type | Rationale |
|-----------|------|-----------|
| `@Tool` | Property | Injects a tool definition; same pattern as `@SubAgent` |
| `@Workflow` | Class | Workflow config is class-level; same as `@AutoSummarize` |
| `@Eval` | Class | Eval config is class-level |
| `@Cron` | Method | Marks a method as cron handler; same as `@Hitl` |
| `@Subscription` | Property | Injects subscription definition |
| `@Auth` | Class | Auth config is class-level |
| `@Retriever` | Property | Injects a retriever instance |
| `@Reranker` | Property | Injects a reranker instance |
| `@TextSplitter` | Property | Injects a text splitter config |

**Rationale:** Per consistency: property decorators for injected values, method decorators for handler methods, class decorators for class-wide config. Matches Phase 1 decisions (ADR D2 of agentic-decorators plan).

**Alternatives considered:**
- **(A) All property decorators** — rejected: `@Cron` on a method is more natural (marks the scheduled handler).

**Consequences:** Reader helpers return different shapes per decorator type (Map for property decorators, single object for class/method decorators).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| 9 new files increase di-agent package size | Low | Each file ~25 LoC; total ~225 LoC. Tree-shakeable. | Phase 1 |
| Metadata keys namespace collision | Low | All keys prefixed `"usetheo:di:"` — no collision possible | D1 |
| Decorators are metadata-only (no auto-wiring) | Medium | Documented in Phase 1 EC-5. Reader helpers provided. Container plugin system is future scope. | D1 |

## Unresolved Questions

(none — every decision is resolved. The pattern is proven by Phase 1.)

## Dependency Graph

```
Phase 1 (Metadata keys) ──▶ Phase 2 (9 decorators in 3 sub-phases, parallel within each) ──▶ Phase 3 (Validation)
```

Phase 2 sub-phases can run in parallel (each decorator is independent).

---

## Phase 1: Metadata Keys

**Objective:** Register 9 new metadata keys in `METADATA_KEYS`.

### T1.1 — Add 9 metadata keys

#### Objective
Add TOOL, WORKFLOW, EVAL, CRON, SUBSCRIPTION, AUTH, RETRIEVER, RERANKER, TEXT_SPLITTER to METADATA_KEYS.

#### Why this step
1. **What:** Add 9 entries to `packages/di/src/internal/metadata.ts`.
2. **Why now:** All 9 decorators depend on these keys. Per DRY: centralized registry.

#### Evidence
- `metadata.ts` currently has 12 keys (8 original + 4 from Phase 1)
- All follow pattern `"usetheo:di:<name>"`

#### Files to edit
```
packages/di/src/internal/metadata.ts — add 9 new METADATA_KEYS entries
```

#### Deep file dependency analysis
- `metadata.ts`: consumed by all decorator files + container resolver. Adding keys is additive.

#### Tasks
1. Add 9 keys to METADATA_KEYS object

#### TDD
```
RED:     test_metadata_keys_include_tool() — verify METADATA_KEYS.TOOL === "usetheo:di:tool"
RED:     test_metadata_keys_include_workflow() — verify METADATA_KEYS.WORKFLOW exists
RED:     test_metadata_keys_include_eval() — verify METADATA_KEYS.EVAL exists
RED:     test_metadata_keys_include_cron() — verify METADATA_KEYS.CRON exists
RED:     test_metadata_keys_include_subscription() — verify METADATA_KEYS.SUBSCRIPTION exists
RED:     test_metadata_keys_include_auth() — verify METADATA_KEYS.AUTH exists
RED:     test_metadata_keys_include_retriever() — verify METADATA_KEYS.RETRIEVER exists
RED:     test_metadata_keys_include_reranker() — verify METADATA_KEYS.RERANKER exists
RED:     test_metadata_keys_include_text_splitter() — verify METADATA_KEYS.TEXT_SPLITTER exists
GREEN:   Add the 9 keys
VERIFY:  pnpm --filter @theokit/di exec vitest run
```

#### Acceptance Criteria
- [ ] Verify all 9 new keys follow `"usetheo:di:<name>"` pattern via direct import test
- [ ] Run `pnpm --filter @theokit/di exec tsc --noEmit` and confirm exit 0

#### DoD
- [ ] Run `pnpm --filter @theokit/di exec vitest run` and confirm all tests pass
- [ ] Run `pnpm --filter @theokit/di exec tsc --noEmit` and confirm exit 0

---

## Phase 2a: Core Decorators (@Tool, @Workflow, @Eval)

**Objective:** Ship the 3 most-used agentic decorators.

### T2.1 — @Tool property decorator

#### Objective
Create `@Tool(options)` that stores tool definition metadata on a class property.

#### Why this step
1. **What:** Create `decorators/tool.ts` with property decorator + `readToolMetadata()` reader.
2. **Why now:** `defineTool` is the most-used agentic factory. Per Rule #9 + Phase 1 pattern.

#### Files to edit
```
packages/di-agent/src/decorators/tool.ts (NEW)
packages/di-agent/tests/tool.test.ts (NEW)
```

#### Deep Dives

```typescript
import "reflect-metadata";
import { METADATA_KEYS } from "@theokit/di";

export interface ToolOptions {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export function Tool(options: ToolOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing = Reflect.getMetadata(METADATA_KEYS.TOOL, target.constructor) ?? new Map();
    existing.set(propertyKey, options);
    Reflect.defineMetadata(METADATA_KEYS.TOOL, existing, target.constructor);
  };
}

export function readToolMetadata(target: abstract new (...args: never) => unknown): ReadonlyMap<string | symbol, ToolOptions> {
  return Reflect.getMetadata(METADATA_KEYS.TOOL, target) ?? new Map();
}
```

#### TDD
```
RED:     test_tool_stores_metadata() — @Tool({name:"search"}) → readToolMetadata returns config
RED:     test_tool_multiple_properties() — 2 tools → map has 2 entries
RED:     test_tool_preserves_description() — description stored verbatim
RED:     test_tool_preserves_input_schema() — inputSchema stored
RED:     test_tool_empty_map_without_decorator() — undecorated → empty map
RED:     test_tool_isolated_per_class() — metadata not shared
RED:     test_tool_imports_reflect_metadata() — Reflect.defineMetadata available
GREEN:   Implement decorator (starts with `import "reflect-metadata"`)
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/tool.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readToolMetadata(MyClass)` returns correct spec per property
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run tests/tool.test.ts` and confirm exit 0 with 7+ tests passing

#### DoD
- [ ] Run tests and confirm 7+ pass
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0

---

### T2.2 — @Workflow class decorator

#### Objective
Create `@Workflow(options)` class decorator for workflow configuration.

#### Files to edit
```
packages/di-agent/src/decorators/workflow.ts (NEW)
packages/di-agent/tests/workflow.test.ts (NEW)
```

#### TDD
```
RED:     test_workflow_stores_config() — @Workflow({name:"pipeline"}) → readWorkflowMetadata returns config
RED:     test_workflow_defaults() — @Workflow() stores defaults
RED:     test_workflow_preserves_retry_policy() — retry config stored
RED:     test_workflow_undefined_without_decorator() — undecorated → undefined
RED:     test_workflow_isolated_per_class() — metadata not shared
RED:     test_workflow_with_input_output_schemas() — schema options stored
RED:     test_workflow_imports_reflect_metadata() — polyfill loaded
GREEN:   Implement decorator
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/workflow.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readWorkflowMetadata(MyClass)` returns config for decorated class
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run tests/workflow.test.ts` and confirm exit 0 with 7+ tests passing

#### DoD
- [ ] Run tests and confirm 7+ pass
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0

---

### T2.3 — @Eval class decorator

#### Objective
Create `@Eval(options)` class decorator for evaluation configuration.

#### Files to edit
```
packages/di-agent/src/decorators/eval-decorator.ts (NEW)
packages/di-agent/tests/eval-decorator.test.ts (NEW)
```

#### TDD
```
RED:     test_eval_stores_config() — @Eval({name:"quality"}) → readEvalMetadata returns config
RED:     test_eval_defaults() — @Eval() stores defaults
RED:     test_eval_preserves_scorers() — scorers array stored
RED:     test_eval_undefined_without_decorator() — undecorated → undefined
RED:     test_eval_isolated_per_class() — metadata not shared
RED:     test_eval_with_dataset() — dataset config stored
GREEN:   Implement decorator
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/eval-decorator.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readEvalMetadata(MyClass)` returns config
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run tests/eval-decorator.test.ts` and confirm exit 0 with 6+ tests passing

#### DoD
- [ ] Run tests and confirm 6+ pass
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0

---

## Phase 2b: Architectural Decorators (@Cron, @Subscription, @Auth)

**Objective:** Ship 3 architectural feature decorators.

### T2.4 — @Cron method decorator

#### Files to edit
```
packages/di-agent/src/decorators/cron.ts (NEW)
packages/di-agent/tests/cron.test.ts (NEW)
```

#### TDD
```
RED:     test_cron_stores_schedule() — @Cron({schedule:"*/5 * * * *"}) → readCronMetadata returns config
RED:     test_cron_stores_method_key() — method name preserved
RED:     test_cron_with_timezone() — timezone option stored
RED:     test_cron_undefined_without_decorator() — undecorated → undefined
RED:     test_cron_isolated_per_class() — metadata not shared
RED:     test_cron_last_wins() — second @Cron overwrites first
RED:     test_cron_on_sync_method() — works on sync method
GREEN:   Implement decorator
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/cron.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readCronMetadata(MyClass)` returns schedule + methodKey
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run tests/cron.test.ts` and confirm exit 0 with 7+ tests passing

#### DoD
- [ ] Run tests and confirm 7+ pass
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0

---

### T2.5 — @Subscription property decorator

#### Files to edit
```
packages/di-agent/src/decorators/subscription.ts (NEW)
packages/di-agent/tests/subscription.test.ts (NEW)
```

#### TDD
```
RED:     test_subscription_stores_config() — @Subscription({name:"events"}) → readSubscriptionMetadata returns config
RED:     test_subscription_multiple() — 2 subscriptions → map has 2 entries
RED:     test_subscription_empty_without_decorator() — undecorated → empty map
RED:     test_subscription_isolated() — metadata not shared
RED:     test_subscription_with_input_output() — input/output schemas stored
RED:     test_subscription_preserves_transport() — transport option stored
GREEN:   Implement decorator
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/subscription.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readSubscriptionMetadata(MyClass)` returns config per property
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run tests/subscription.test.ts` and confirm exit 0 with 6+ tests passing

#### DoD
- [ ] Run tests and confirm 6+ pass
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0

---

### T2.6 — @Auth class decorator

#### Files to edit
```
packages/di-agent/src/decorators/auth.ts (NEW)
packages/di-agent/tests/auth.test.ts (NEW)
```

#### TDD
```
RED:     test_auth_stores_config() — @Auth({providers:["google"]}) → readAuthMetadata returns config
RED:     test_auth_defaults() — @Auth() stores defaults
RED:     test_auth_multiple_providers() — 3 providers listed
RED:     test_auth_undefined_without_decorator() — undecorated → undefined
RED:     test_auth_isolated() — metadata not shared
RED:     test_auth_with_session_config() — session options stored
GREEN:   Implement decorator
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/auth.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readAuthMetadata(MyClass)` returns config
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run tests/auth.test.ts` and confirm exit 0 with 6+ tests passing

#### DoD
- [ ] Run tests and confirm 6+ pass
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0

---

## Phase 2c: RAG Decorators (@Retriever, @Reranker, @TextSplitter)

**Objective:** Ship 3 RAG-specific decorators.

### T2.7 — @Retriever property decorator

#### Files to edit
```
packages/di-agent/src/decorators/retriever.ts (NEW)
packages/di-agent/tests/retriever.test.ts (NEW)
```

#### TDD
```
RED:     test_retriever_stores_config() — @Retriever({topK:10}) → readRetrieverMetadata returns config
RED:     test_retriever_defaults() — @Retriever() stores defaults
RED:     test_retriever_multiple() — 2 retrievers → map has 2
RED:     test_retriever_empty_without_decorator() — undecorated → empty map
RED:     test_retriever_isolated() — metadata not shared
RED:     test_retriever_with_threshold() — threshold option stored
GREEN:   Implement decorator
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/retriever.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readRetrieverMetadata(MyClass)` returns config per property
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run tests/retriever.test.ts` and confirm exit 0 with 6+ tests passing

#### DoD
- [ ] Run tests and confirm 6+ pass
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0

---

### T2.8 — @Reranker property decorator

#### Files to edit
```
packages/di-agent/src/decorators/reranker.ts (NEW)
packages/di-agent/tests/reranker.test.ts (NEW)
```

#### TDD
```
RED:     test_reranker_stores_config() — @Reranker({provider:"cohere"}) → readRerankerMetadata returns config
RED:     test_reranker_defaults() — @Reranker() stores defaults
RED:     test_reranker_multiple() — 2 rerankers → map has 2
RED:     test_reranker_empty_without_decorator() — undecorated → empty map
RED:     test_reranker_isolated() — metadata not shared
RED:     test_reranker_with_model() — model option stored
GREEN:   Implement decorator
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/reranker.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readRerankerMetadata(MyClass)` returns config per property
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run tests/reranker.test.ts` and confirm exit 0 with 6+ tests passing

#### DoD
- [ ] Run tests and confirm 6+ pass
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0

---

### T2.9 — @TextSplitter property decorator

#### Files to edit
```
packages/di-agent/src/decorators/text-splitter.ts (NEW)
packages/di-agent/tests/text-splitter.test.ts (NEW)
```

#### TDD
```
RED:     test_text_splitter_stores_config() — @TextSplitter({strategy:"recursive"}) → readTextSplitterMetadata returns config
RED:     test_text_splitter_defaults() — @TextSplitter() stores defaults
RED:     test_text_splitter_with_chunk_size() — chunkSize option stored
RED:     test_text_splitter_with_overlap() — overlap option stored
RED:     test_text_splitter_empty_without_decorator() — undecorated → empty map
RED:     test_text_splitter_isolated() — metadata not shared
GREEN:   Implement decorator
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/text-splitter.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readTextSplitterMetadata(MyClass)` returns config per property
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run tests/text-splitter.test.ts` and confirm exit 0 with 6+ tests passing

#### DoD
- [ ] Run tests and confirm 6+ pass
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0

---

## Phase 3: Integration Validation (MANDATORY)

**Objective:** Validate all 9 decorators + Phase 1's 4 = 13 total decorators work together.

### Execution

```bash
pnpm --filter @theokit/di exec vitest run         # DI tests (no regression)
pnpm --filter @theokit/di-agent exec vitest run    # all 13 decorators
pnpm --filter @theokit/di-agent exec tsc --noEmit  # typecheck
pnpm -w run check                                  # biome lint
```

### Acceptance Criteria

- [x] Run `pnpm --filter @theokit/di exec vitest run` and confirm zero regressions
- [x] Run `pnpm --filter @theokit/di-agent exec vitest run` and confirm 95+ total tests (99 passing)
- [x] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0
- [x] Run `pnpm -w run check` and confirm zero lint errors
- [x] Verify CHANGELOG updated with 9 new decorator entries

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | @Tool property decorator | T2.1 | Metadata storage + reader for tool config |
| 2 | @Workflow class decorator | T2.2 | Metadata storage + reader for workflow config |
| 3 | @Eval class decorator | T2.3 | Metadata storage + reader for eval config |
| 4 | @Cron method decorator | T2.4 | Metadata storage + reader for cron schedule |
| 5 | @Subscription property decorator | T2.5 | Metadata storage + reader for subscription config |
| 6 | @Auth class decorator | T2.6 | Metadata storage + reader for auth config |
| 7 | @Retriever property decorator | T2.7 | Metadata storage + reader for retriever config |
| 8 | @Reranker property decorator | T2.8 | Metadata storage + reader for reranker config |
| 9 | @TextSplitter property decorator | T2.9 | Metadata storage + reader for text splitter config |
| 10 | 9 metadata keys in DI registry | T1.1 | TOOL, WORKFLOW, EVAL, CRON, SUBSCRIPTION, AUTH, RETRIEVER, RERANKER, TEXT_SPLITTER |
| 11 | 60+ new tests | T1.1-T2.9 | 9+7+7+6+7+6+6+6+6+6 = 66 minimum |
| 12 | 100% Rule #9 compliance | T2.1-T2.9 | All 14 agentic features have decorator API (5 Phase 1 + 9 Phase 2) |

**Coverage: 12/12 gaps covered (100%)**

## Global Definition of Done

- [x] Verify all phases completed
- [x] Run `pnpm --filter @theokit/di-agent exec vitest run` and confirm all tests passing (99 total)
- [x] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm zero type errors
- [x] Run `pnpm -w run check` and confirm zero lint errors
- [x] Verify file-size budget respected (all files ≤ 500 LoC per `architecture.md`)
- [x] Verify CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [x] Verify 60+ new tests added across 10 test files
- [x] Confirm plan archived to `knowledge-base/plans/completed/` after merge
