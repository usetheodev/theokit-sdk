# Plan: Agentic Feature Decorators via @theokit/di

> **Version 1.1** — Adds 4 decorator-based APIs (`@UseSandbox`, `@SubAgent`, `@Hitl`, `@AutoSummarize`) to the DI-agent bridge package, giving every agentic capability a first-class decorator surface per Inviolable Rule #9. Factory functions remain as low-level primitives; decorators become the recommended DX.

## Goal

> "Ship 4 new decorators (`@UseSandbox`, `@SubAgent`, `@Hitl`, `@AutoSummarize`) in `@theokit/di-agent` so that DI-managed agent classes can declaratively configure sandbox backends, subagent delegation, HITL approval, and auto-summarization via metadata decorators, measured by `pnpm --filter @theokit/di-agent exec vitest run` exit 0 with 30+ new tests covering the 4 decorators."

## Context

The 2026-06-10 parity gaps implementation shipped sandbox, subagent, HITL, and auto-summarize as factory functions and plain classes. Per Inviolable Rule #9 (established same day): every agentic feature MUST have a `@Decorator` API via `@theokit/di`. The existing DI package uses `reflect-metadata` with `experimentalDecorators` and stores metadata under `"usetheo:di:*"` keys. The `di-agent` bridge already has `@InjectAgent()` as the pattern to follow.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/di-agent/src/inject-agent.ts` | 22 | `540b570` (2026-06-10) | `@InjectAgent()` parameter decorator — bridge pattern | Keep existing API |
| `packages/di-agent/src/index.ts` | ~15 | `540b570` (2026-06-10) | Barrel export | Add new exports |
| `packages/di-agent/package.json` | ~40 | `540b570` (2026-06-10) | Package manifest | Add SDK peer dep |
| `packages/di/src/internal/metadata.ts` | ~25 | `540b570` (2026-06-10) | METADATA_KEYS registry | Add 4 new keys |
| `packages/sdk/src/sandbox/types.ts` | ~110 | `540b570` (2026-06-10) | SandboxBackend abstract class | Read-only (import types) |
| `packages/sdk/src/a2a/subagent.ts` | ~70 | `540b570` (2026-06-10) | defineSubAgent factory | Read-only (import types) |
| `packages/sdk/src/internal/runtime/hitl-middleware.ts` | ~63 | `540b570` (2026-06-10) | HitlMiddleware class | Read-only (import types) |
| `packages/sdk/src/internal/runtime/auto-summarize.ts` | ~70 | `540b570` (2026-06-10) | Auto-summarize functions | Read-only (import types) |
| `packages/di-agent/src/decorators/use-sandbox.ts` (NEW) | 0 | — | @UseSandbox decorator | — |
| `packages/di-agent/src/decorators/sub-agent.ts` (NEW) | 0 | — | @SubAgent decorator | — |
| `packages/di-agent/src/decorators/hitl.ts` (NEW) | 0 | — | @Hitl decorator | — |
| `packages/di-agent/src/decorators/auto-summarize.ts` (NEW) | 0 | — | @AutoSummarize decorator | — |
| `packages/di-agent/tests/use-sandbox.test.ts` (NEW) | 0 | — | — | — |
| `packages/di-agent/tests/sub-agent.test.ts` (NEW) | 0 | — | — | — |
| `packages/di-agent/tests/hitl.test.ts` (NEW) | 0 | — | — | — |
| `packages/di-agent/tests/auto-summarize.test.ts` (NEW) | 0 | — | — | — |

### Current callers / dependents

- **`@InjectAgent()`** — exported from `@theokit/di-agent`; used in `di-agent/tests/` (1 test file); pattern reference for new decorators
- **`METADATA_KEYS`** — internal to `@theokit/di`; consumed by container resolver + decorator reader helpers
- **`SandboxBackend`** — exported from `@theokit/sdk/sandbox`; no DI integration yet
- **`defineSubAgent`** — exported from `@theokit/sdk/a2a`; no DI integration yet
- **`HitlMiddleware`** — internal to SDK; no DI integration yet
- **`autoSummarize`** — internal to SDK; no DI integration yet

### Domain glossary

- **Metadata key** — string constant (e.g., `"usetheo:di:sandbox"`) used with `Reflect.defineMetadata()` to attach config to a class/property/method
- **Property decorator** — decorates a class property; stores metadata on the class constructor keyed by property name
- **Method decorator** — decorates a class method; stores metadata on the class constructor keyed by method name
- **Class decorator** — decorates the class itself; stores metadata on the class constructor
- **Provider factory** — function that returns a DI `Provider<T>` for container registration

### Architecture boundaries affected

- **`@theokit/di` → `@theokit/di-agent`** — metadata keys defined in DI, decorators in DI-agent (follows existing `@InjectAgent` pattern)
- **`@theokit/di-agent` → `@theokit/sdk`** — DI-agent imports types from SDK (sandbox, subagent, HITL, auto-summarize). This is acceptable per `architecture.md` DIP: di-agent is the composition root that wires SDK primitives into the DI container.

## Prior Art & Related Work

- **`@InjectAgent()` in `di-agent/src/inject-agent.ts`** — established pattern: parameter decorator delegating to `@Inject(TOKEN)`. Each new decorator follows the same `Reflect.defineMetadata` flow.
- **NestJS `@Injectable` + custom decorators** — industry standard for decorator-based DI in TypeScript. Same `reflect-metadata` + `experimentalDecorators` approach.
- **Existing `METADATA_KEYS` registry** — centralized in `di/src/internal/metadata.ts`. All new keys follow the `"usetheo:di:<name>"` namespace.

## Objective

- [ ] Verify `@UseSandbox({ backend: "local" })` property decorator stores metadata and creates `SandboxBackend` provider, confirmed by 8+ tests
- [ ] Verify `@SubAgent({ name, instructions })` property decorator stores metadata and creates `CustomTool` provider, confirmed by 8+ tests
- [ ] Verify `@Hitl({ tools: ["execute"] })` method decorator stores metadata and creates `HitlMiddleware` provider, confirmed by 8+ tests
- [ ] Verify `@AutoSummarize({ triggerFraction: 0.85 })` class decorator stores metadata and resolves config, confirmed by 8+ tests
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run` exit 0 with 30+ new tests

## ADRs

### D1 — Ship decorators in `@theokit/di-agent`, not a new package

**Decision:** Add the 4 new decorators to `@theokit/di-agent` (existing package) rather than creating a new `@theokit/sdk-di` package.

**Rationale:** Per KISS: `di-agent` already bridges DI with SDK (has `@InjectAgent`). Adding 4 more decorators to the same package avoids a new npm package, new workspace member, new CI config. Per YAGNI: a separate package only makes sense with 10+ decorators. Currently we have 5 (1 existing + 4 new).

**Alternatives considered:**
- **(A) New `@theokit/sdk-di` package** — rejected: overhead of new package (package.json, tsconfig, tsup config, CI) for only 4 decorators. Violates KISS.
- **(B) Ship in `@theokit/sdk` directly** — rejected: SDK is already 812 LoC flagged. Decorators are DI concerns, not SDK core.

**Consequences:** `@theokit/di-agent` gains `@theokit/sdk` as a peer dep (currently only has `@theokit/di`).

### D2 — Property decorators for sandbox and subagent, method decorator for HITL, class decorator for auto-summarize

**Decision:** Each decorator uses the most natural TypeScript decorator type for its use case:
- `@UseSandbox` — property decorator (injects a `SandboxBackend` instance)
- `@SubAgent` — property decorator (injects a `CustomTool`)
- `@Hitl` — method decorator (marks an approval handler method)
- `@AutoSummarize` — class decorator (configures the class-level summarization policy)

**Rationale:** Per DIP: decorators declare WHAT, not HOW. Property decorators for injected values, method decorators for handler methods, class decorators for class-wide config. Matches NestJS patterns.

**Alternatives considered:**
- **(A) All class decorators** — rejected: forces a single config object for everything. Loses the declarative property-level DX.

**Consequences:** Each decorator type requires a different metadata read pattern. Reader helpers in `internal/metadata.ts`.

### D3 — Metadata stored on class constructor, read via helper functions

**Decision:** All 4 decorators store metadata via `Reflect.defineMetadata(KEY, value, target.constructor ?? target)`. Each has a reader: `readSandboxMetadata(target)`, `readSubAgentMetadata(target)`, etc.

**Rationale:** Per DRY: follows the exact pattern of all 8 existing decorators. Per consistency: every decorator in the ecosystem uses the same `Reflect.defineMetadata` + reader function pattern.

**Alternatives considered:**
- **(A) Static property on class** — rejected: breaks encapsulation; metadata is not part of the class API.

**Consequences:** Requires `reflect-metadata` polyfill at runtime (already a dep of `@theokit/di`).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `di-agent` gains `@theokit/sdk` peer dep — increases coupling | Medium | SDK types are used as type-only imports; runtime remains decoupled | D1 |
| Decorators require `experimentalDecorators` in consumer tsconfig | Low | Already required for `@Injectable`/`@Inject` — no new burden | D2 |
| 4 decorators without container integration (metadata stored but not auto-resolved) | Medium | Ship reader helpers; container integration follows in separate plan when container gains plugin system | Phase 1 |

## Unresolved Questions

(none — every decision is resolved at plan time. Decorator patterns are established by the 8 existing decorators. The 4 new ones follow the same pattern exactly.)

## Dependency Graph

```
Phase 1 (Metadata keys) ──▶ Phase 2 (4 decorators in parallel) ──▶ Phase 3 (Integration validation)
```

Phase 2 tasks can run in parallel (each decorator is independent).

---

## Phase 1: Foundation — Metadata Keys

**Objective:** Register 4 new metadata keys in the DI metadata registry.

### T1.1 — Add metadata keys to `@theokit/di`

#### Objective
Register `SANDBOX`, `SUBAGENT`, `HITL`, `AUTO_SUMMARIZE` in `METADATA_KEYS`.

#### Why this step
1. **What:** Add 4 entries to `packages/di/src/internal/metadata.ts`.
2. **Why now:** All 4 decorators depend on these keys. Per DRY: centralized registry, not scattered strings.

#### Evidence
- `metadata.ts` currently has 8 keys (`INJECTABLE`, `INJECT_TOKENS`, `OPTIONAL_FLAGS`, `DESIGN_PARAMTYPES`, `QUALIFIER_NAMES`, `PRIMARY`, `POST_CONSTRUCT`, `PRE_DESTROY`)
- All follow pattern `"usetheo:di:<name>"`

#### Files to edit
```
packages/di/src/internal/metadata.ts — add 4 new METADATA_KEYS entries
```

#### Deep file dependency analysis
- `metadata.ts`: consumed by all decorator files + container resolver. Adding keys is additive — no existing code breaks.

#### Tasks
1. Add `SANDBOX: "usetheo:di:sandbox"` to METADATA_KEYS
2. Add `SUBAGENT: "usetheo:di:subagent"` to METADATA_KEYS
3. Add `HITL: "usetheo:di:hitl"` to METADATA_KEYS
4. Add `AUTO_SUMMARIZE: "usetheo:di:auto-summarize"` to METADATA_KEYS

#### TDD
```
RED:     test_metadata_keys_include_sandbox() — verify METADATA_KEYS.SANDBOX === "usetheo:di:sandbox"
RED:     test_metadata_keys_include_subagent() — verify METADATA_KEYS.SUBAGENT exists
RED:     test_metadata_keys_include_hitl() — verify METADATA_KEYS.HITL exists
RED:     test_metadata_keys_include_auto_summarize() — verify METADATA_KEYS.AUTO_SUMMARIZE exists
GREEN:   Add the 4 keys
VERIFY:  pnpm --filter @theokit/di exec vitest run tests/
```

#### Acceptance Criteria
- [ ] Verify `METADATA_KEYS.SANDBOX` equals `"usetheo:di:sandbox"` via direct import test
- [ ] Verify all 4 new keys follow the `"usetheo:di:<name>"` namespace pattern
- [ ] Run `pnpm --filter @theokit/di exec tsc --noEmit` and confirm exit 0

#### DoD
- [ ] Run `pnpm --filter @theokit/di exec vitest run` and confirm all tests pass
- [ ] Run `pnpm --filter @theokit/di exec tsc --noEmit` and confirm exit 0

---

## Phase 2: Decorators (parallel)

**Objective:** Ship 4 decorators in `@theokit/di-agent` with tests.

### T2.1 — @UseSandbox property decorator

#### Objective
Create `@UseSandbox(config)` that stores sandbox config as metadata on a class property.

#### Why this step
1. **What:** Create `decorators/use-sandbox.ts` with property decorator + `readSandboxMetadata()` reader.
2. **Why now:** Per Rule #9: sandbox feature shipped without decorator. This closes the gap. Per ADR D2: property decorator is the natural fit for injected values.

#### Evidence
- `@InjectAgent()` at `di-agent/src/inject-agent.ts:1` — same pattern (parameter decorator + metadata)
- `SandboxBackend` at `sdk/src/sandbox/types.ts:1` — the type to configure

#### Files to edit
```
packages/di-agent/src/decorators/use-sandbox.ts (NEW) — @UseSandbox decorator
packages/di-agent/src/index.ts — re-export
packages/di-agent/tests/use-sandbox.test.ts (NEW) — tests
```

#### Deep Dives

```typescript
// EC-1: side-effect import ensures Reflect polyfill is loaded even without container
import "reflect-metadata";
import { METADATA_KEYS } from "@theokit/di/internal/metadata";

export interface UseSandboxOptions {
  backend?: "local" | "docker" | string;
  workDir?: string;
  timeoutMs?: number;
}

export function UseSandbox(options: UseSandboxOptions = {}): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing = Reflect.getMetadata(METADATA_KEYS.SANDBOX, target.constructor) ?? new Map();
    existing.set(propertyKey, options);
    Reflect.defineMetadata(METADATA_KEYS.SANDBOX, existing, target.constructor);
  };
}

export function readSandboxMetadata(target: Function): ReadonlyMap<string | symbol, UseSandboxOptions> {
  return Reflect.getMetadata(METADATA_KEYS.SANDBOX, target) ?? new Map();
}
```

#### Tasks
1. Create `decorators/use-sandbox.ts` with decorator + reader
2. Export from `index.ts`
3. Write tests

#### TDD
```
RED:     test_use_sandbox_stores_metadata_on_property() — @UseSandbox({backend:"docker"}) on prop → readSandboxMetadata returns config
RED:     test_use_sandbox_default_options() — @UseSandbox() stores empty config
RED:     test_use_sandbox_multiple_properties() — 2 decorated props → map has 2 entries
RED:     test_use_sandbox_with_custom_work_dir() — workDir option preserved
RED:     test_read_sandbox_metadata_returns_empty_map_without_decorator() — undecorated class → empty map
RED:     test_use_sandbox_does_not_affect_other_classes() — metadata isolated per class
RED:     test_use_sandbox_with_timeout() — timeoutMs option preserved
RED:     test_use_sandbox_custom_backend_name() — backend: "e2b" stored correctly
RED:     test_decorator_imports_reflect_metadata() — (EC-1) verify Reflect.defineMetadata is available after importing decorator module
GREEN:   Implement decorator (each file starts with `import "reflect-metadata"`)
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/use-sandbox.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readSandboxMetadata(MyClass)` returns `Map` with property key → options for decorated properties
- [ ] Verify undecorated classes return empty `Map`
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run tests/use-sandbox.test.ts` and confirm 8+ tests pass

#### DoD
- [ ] Run tests and confirm 8+ pass
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0

---

### T2.2 — @SubAgent property decorator

#### Objective
Create `@SubAgent(spec)` that stores subagent config as metadata on a class property.

#### Why this step
1. **What:** Create `decorators/sub-agent.ts` with property decorator + `readSubAgentMetadata()` reader.
2. **Why now:** Per Rule #9. Per ADR D2: property decorator injects a `CustomTool`.

#### Evidence
- `defineSubAgent()` at `sdk/src/a2a/subagent.ts:1` — the factory to wrap
- `SubAgentSpec` interface — `{ name, description, instructions, model?, tools?, maxDelegationDepth? }`

#### Files to edit
```
packages/di-agent/src/decorators/sub-agent.ts (NEW) — @SubAgent decorator
packages/di-agent/tests/sub-agent.test.ts (NEW) — tests
```

#### TDD
```
RED:     test_sub_agent_stores_spec_on_property() — @SubAgent({name:"researcher",...}) → readSubAgentMetadata returns spec
RED:     test_sub_agent_default_depth() — maxDelegationDepth defaults to 3
RED:     test_sub_agent_multiple_on_same_class() — 2 subagent props → map has 2 entries
RED:     test_sub_agent_with_custom_model() — model override preserved
RED:     test_sub_agent_with_tools() — tools array preserved
RED:     test_read_subagent_metadata_empty_without_decorator() — undecorated → empty map
RED:     test_sub_agent_isolated_per_class() — metadata not shared between classes
RED:     test_sub_agent_preserves_instructions() — instructions string stored verbatim
RED:     test_sub_agent_empty_instructions_stores_as_is() — (EC-4) empty string stored without error
GREEN:   Implement decorator (starts with `import "reflect-metadata"`)
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/sub-agent.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readSubAgentMetadata(MyClass)` returns correct spec per property
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run` and confirm exit 0 with 8+ tests passing

#### DoD
- [ ] Run tests and confirm 8+ pass
- [ ] Run typecheck and confirm exit 0

---

### T2.3 — @Hitl method decorator

#### Objective
Create `@Hitl(config)` that marks a method as the HITL approval handler.

#### Why this step
1. **What:** Create `decorators/hitl.ts` with method decorator + `readHitlMetadata()` reader.
2. **Why now:** Per Rule #9. Per ADR D2: method decorator marks the approval handler.

#### Evidence
- `HitlMiddleware` at `sdk/src/internal/runtime/hitl-middleware.ts:1` — the runtime class
- `HitlConfig` — `{ tools, approve, timeoutMs? }`

#### Files to edit
```
packages/di-agent/src/decorators/hitl.ts (NEW) — @Hitl decorator
packages/di-agent/tests/hitl.test.ts (NEW) — tests
```

#### Deep Dives

```typescript
export interface HitlOptions {
  tools: string[];
  timeoutMs?: number;
}

export function Hitl(options: HitlOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(METADATA_KEYS.HITL, { ...options, methodKey: propertyKey }, target.constructor);
  };
}

export function readHitlMetadata(target: Function): { tools: string[]; timeoutMs?: number; methodKey: string | symbol } | undefined {
  return Reflect.getMetadata(METADATA_KEYS.HITL, target);
}
```

#### TDD
```
RED:     test_hitl_stores_tools_list() — @Hitl({tools:["execute"]}) → readHitlMetadata returns tools
RED:     test_hitl_stores_method_key() — decorated method name preserved
RED:     test_hitl_default_timeout() — timeoutMs undefined when not set
RED:     test_hitl_custom_timeout() — timeoutMs preserved
RED:     test_hitl_multiple_tools() — 3 tools listed
RED:     test_read_hitl_metadata_undefined_without_decorator() — undecorated → undefined
RED:     test_hitl_only_one_per_class() — second @Hitl overwrites first (last wins)
RED:     test_hitl_isolated_per_class() — metadata not shared
RED:     test_hitl_on_sync_method_stores_metadata() — (EC-3) @Hitl on sync method stores metadata correctly
GREEN:   Implement decorator (starts with `import "reflect-metadata"`)
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/hitl.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readHitlMetadata(MyClass)` returns tools + methodKey for decorated method
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run` and confirm exit 0 with 8+ tests passing

#### DoD
- [ ] Run tests and confirm 8+ pass
- [ ] Run typecheck and confirm exit 0

---

### T2.4 — @AutoSummarize class decorator

#### Objective
Create `@AutoSummarize(config)` that stores summarization config on the class.

#### Why this step
1. **What:** Create `decorators/auto-summarize.ts` with class decorator + `readAutoSummarizeMetadata()` reader.
2. **Why now:** Per Rule #9. Per ADR D2: class decorator for class-wide config.

#### Evidence
- `AutoSummarizeConfig` at `sdk/src/internal/runtime/auto-summarize.ts:1` — the config type
- Default: `{ triggerFraction: 0.85, keepNewest: 4 }`

#### Files to edit
```
packages/di-agent/src/decorators/auto-summarize.ts (NEW) — @AutoSummarize decorator
packages/di-agent/tests/auto-summarize.test.ts (NEW) — tests
```

#### TDD
```
RED:     test_auto_summarize_stores_config() — @AutoSummarize({triggerFraction:0.9}) → readAutoSummarizeMetadata returns config
RED:     test_auto_summarize_defaults() — @AutoSummarize() stores default config
RED:     test_auto_summarize_custom_keep_newest() — keepNewest override
RED:     test_auto_summarize_custom_model() — model override
RED:     test_read_auto_summarize_undefined_without_decorator() — undecorated → undefined
RED:     test_auto_summarize_isolated_per_class() — metadata not shared
GREEN:   Implement decorator
VERIFY:  pnpm --filter @theokit/di-agent exec vitest run tests/auto-summarize.test.ts
```

#### Acceptance Criteria
- [ ] Verify `readAutoSummarizeMetadata(MyClass)` returns config for decorated class
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run` and confirm exit 0 with 6+ tests passing

#### DoD
- [ ] Run tests and confirm 6+ pass
- [ ] Run typecheck and confirm exit 0

---

## Phase 3: Integration Validation (MANDATORY)

**Objective:** Validate all 4 decorators work together in a single DI module.

### Execution

```bash
pnpm --filter @theokit/di exec vitest run         # DI tests still pass
pnpm --filter @theokit/di-agent exec vitest run    # all di-agent tests (old + new)
pnpm --filter @theokit/di-agent exec tsc --noEmit  # typecheck
pnpm -w run check                                  # biome lint
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/di exec vitest run` and confirm all DI tests pass (no regression)
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run` and confirm 30+ new tests pass
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm exit 0
- [ ] Run `pnpm -w run check` and confirm zero lint errors
- [ ] Verify CHANGELOG updated with 4 decorator entries under `[Unreleased] § Added`

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures before declaring complete
3. Re-run validation chain

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | @UseSandbox property decorator | T2.1 | Metadata storage + reader for sandbox config |
| 2 | @SubAgent property decorator | T2.2 | Metadata storage + reader for subagent spec |
| 3 | @Hitl method decorator | T2.3 | Metadata storage + reader for HITL approval |
| 4 | @AutoSummarize class decorator | T2.4 | Metadata storage + reader for auto-summarize config |
| 5 | Metadata keys in DI registry | T1.1 | 4 new keys in METADATA_KEYS |
| 6 | 30+ new tests | T1.1-T2.4 | 4+9+9+9+6 = 37 minimum |
| 7 | Rule #9 compliance | T2.1-T2.4 | All 4 agentic features now have decorator API |
| 8 | EC-1: reflect-metadata side-effect import | T2.1-T2.4 | Each decorator file starts with `import "reflect-metadata"` |
| 9 | EC-3: @Hitl on sync method | T2.3 | Test verifies metadata stored regardless of async |
| 10 | EC-4: @SubAgent empty instructions | T2.2 | Test verifies empty string stored as-is |
| 11 | EC-5: Decorators metadata-only (no auto-wiring) | T2.1, T2.2, T2.3, T2.4 | Reader helpers provided in each decorator; container plugin system is future scope |

**Coverage: 11/11 gaps covered (100%)**

## Global Definition of Done

- [ ] Verify all phases completed
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run` and confirm all tests passing
- [ ] Run `pnpm --filter @theokit/di-agent exec tsc --noEmit` and confirm zero type errors
- [ ] Run `pnpm -w run check` and confirm zero lint warnings
- [ ] Verify file-size budget respected (all files ≤ 500 LoC per `architecture.md`)
- [ ] Verify CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Verify 30+ new tests added across 5 test files
- [ ] Confirm plan archived to `knowledge-base/plans/completed/` after merge

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate all decorators with a composite test.

### Execution

```bash
pnpm typecheck
pnpm -w run check
pnpm --filter @theokit/di exec vitest run
pnpm --filter @theokit/di-agent exec vitest run
```

### Acceptance Criteria

- [ ] Run `pnpm typecheck` and confirm zero type errors across workspace
- [ ] Run `pnpm --filter @theokit/di-agent exec vitest run && pnpm --filter @theokit/di exec vitest run` and confirm exit 0
- [ ] Run `pnpm --filter @theokit/di exec vitest run` and confirm exit 0 with zero regressions
