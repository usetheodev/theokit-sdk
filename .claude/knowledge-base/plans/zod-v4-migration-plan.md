# Plan: Zod v4 Migration — Eliminate Cross-Version Incompatibility

> **Version 1.1** — Migrates the entire theokit-sdk monorepo from the current fragmented Zod state (v3.25.76 + v4.0.0 + v4.4.3 coexisting) to a single Zod v4 resolution. Eliminates the systemic bug where mixing Zod v3 schemas (bundled in SDK dist) with Zod v4 `z.object()` in downstream packages causes "expected a Zod schema" runtime errors. Removes all `as any` workarounds and restores type-safe `inputSchema` across the workspace.

## Goal

> "Migrate all 6 Zod-consuming packages from `zod ^3.25||^4` peer range to `zod ^4.0.0` only, so that every `z.object()` nesting, `ZodType` generic bound, and `toJsonSchema()` call resolves against a single Zod instance, measured by `pnpm --filter @theokit/sdk exec tsc --noEmit && pnpm --filter @theokit/sdk-cache exec vitest run && pnpm --filter @theokit/sdk-tools run build` all exiting 0 with zero `as any` casts on Zod types."

## Context

During the 2026-06-10 quality remediation session, three independent failures traced to the same root cause: the workspace resolves 3 Zod versions simultaneously (v3.25.76, v4.0.0, v4.4.3). Zod v4 rejects schemas created by a different Zod instance inside `z.object()` — `"Invalid element at key ...: expected a Zod schema"`. This caused:

1. **sdk-cache** — 12 test failures (runtime crash on `PersistenceSchema` imported from SDK dist bundled with Zod v3)
2. **sdk-tools** — DTS build failure (`ZodObject` from v4 doesn't extend v3's `ZodType` with `_parse`, `_getType`, etc.)
3. **sdk-handoff** — silently working only because both its `import type { ZodType }` and runtime `z.` calls happen to resolve the same v4 instance

Current workarounds applied in the same session are band-aids:
- `as any` casts on 5 `inputSchema` fields in sdk-tools
- Inlined `PersistenceSchema` in sdk-cache (duplicated from SDK)
- Runtime validation replacing Zod `.refine()` in sdk-cache

These workarounds will metastasize as new packages add Zod usage. The workspace has 29 production source files and 20 test files importing from `"zod"`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk/package.json` | ~120 | `ed731c2` (2026-06-10) | SDK package manifest; declares `zod: "^3.25.0 \|\| ^4.0.0"` peer dep | All sub-path exports, engines, peerDependenciesMeta |
| `packages/sdk/src/define-tool.ts` | 69 | `7f7d386` (2026-05-31) | `defineTool<T extends ZodType>` — public API for typed agent tools | Public interface `DefineToolSpec<T>` must remain generic over `ZodType`; `z.infer<T>` handler typing preserved |
| `packages/sdk/src/internal/zod/to-json-schema.ts` | 126 | `7f7d386` (2026-05-31) | Universal Zod→JSON Schema adapter (detects v4 native `toJSONSchema` vs v3 `zod-to-json-schema` lib) | Must still produce `Record<string, unknown>` JSON Schema doc |
| `packages/sdk/src/internal/persistence/persistence-schema.ts` | 27 | `26028f3` (2026-06-10) | `PersistenceSchema` — shared Zod schema for `{ backend, dir? }` | Used by workflow + cache (currently cache inlines its own copy — will reunify) |
| `packages/sdk/src/eval.ts` | 79 | `b70747b` (2026-06-03) | `Eval.run()` — LLM evaluation framework with Zod validation | `z.unknown().refine()` patterns used for dataset/scorers/agent — must migrate to v4-safe pattern |
| `packages/sdk/src/generate-object.ts` | ~130 | `7f7d386` (2026-05-31) | `generateObject<T extends ZodType>` — structured LLM output | `ZodType` generic bound + `z.infer<T>` |
| `packages/sdk/src/stream-object.ts` | ~270 | `7f7d386` (2026-05-31) | `streamObject<T extends ZodType>` — streaming structured output | Same pattern as generate-object |
| `packages/sdk/src/scorers.ts` | ~150 | `7f7d386` (2026-05-31) | `Scorer.jsonShape<T extends ZodType>` | `ZodType` bound |
| `packages/sdk/src/workflow.ts` | ~300 | `7f7d386` (2026-05-31) | `WorkflowBuilder` with `ZodType` for step schemas | `inputSchema?/outputSchema?/payloadSchema?` all `ZodType` |
| `packages/sdk/src/types/workflow.ts` | 283 | `7f7d386` (2026-05-31) | Type defs for `FnStep`, `SuspendStep` etc. | `ZodType` used in `inputSchema`, `outputSchema`, `payloadSchema` |
| `packages/sdk/src/internal/structured-output-helpers.ts` | ~150 | `7f7d386` (2026-05-31) | Shared helpers for structured output (object/stream) | `setupStructuredOutput<T extends ZodType>` |
| `packages/sdk-cache/package.json` | 74 | `26028f3` (2026-06-10) | Cache package manifest | Zod peer dep range |
| `packages/sdk-cache/src/cache.ts` | 265 | `26028f3` (2026-06-10) | `Cache.semantic()` — semantic LLM response cache | Inlined `PersistenceSchema` + runtime validation (workaround to remove) |
| `packages/sdk-tools/package.json` | 71 | `0bc76e4` (2026-06-10) | Tools package manifest | Zod peer dep range |
| `packages/sdk-tools/src/git-diff.ts` | 148 | `0bc76e4` (2026-06-10) | `inputSchema: z.object({...}) as any` (workaround to remove) | Must produce valid JSON Schema for LLM tool contract |
| `packages/sdk-tools/src/list-dir.ts` | ~80 | `0bc76e4` (2026-06-10) | Same pattern | Same |
| `packages/sdk-tools/src/read-file.ts` | ~100 | `0bc76e4` (2026-06-10) | Same pattern | Same |
| `packages/sdk-tools/src/run-vitest.ts` | ~120 | `0bc76e4` (2026-06-10) | Same pattern | Same |
| `packages/sdk-tools/src/search-text.ts` | ~130 | `0bc76e4` (2026-06-10) | Same pattern | Same |
| `packages/sdk-handoff/package.json` | ~70 | latest | Handoff package manifest | Zod peer dep range |
| `packages/sdk-handoff/src/internal/to-json-schema.ts` | 126 | `b49a6a1` (2026-06-08) | Zod→JSON Schema (duplicate of SDK's; feature-detects v4 native) | Same dual-path strategy |
| `packages/react/package.json` | ~50 | latest | React hooks package manifest | Zod peer dep range |
| `packages/react/src/stream-assistant.ts` | ~80 | latest | `streamAssistant<T extends ZodType>` | `ZodType` generic bound |
| `packages/cli/package.json` | ~50 | latest | CLI package manifest | Currently `zod: "^3.25.0"` only — needs bump |
| `package.json` (root) | ~120 | latest | Workspace root | pnpm overrides for Zod resolution |
| `tests/` (multiple) | varies | varies | 20 test files import zod | Test mocks using `z.object()` must resolve v4 |

### Current callers / dependents

- **`ZodType`** — imported as a type in 14 production files across 4 packages (sdk, sdk-handoff, react, sdk-tools). Used as generic constraint `<T extends ZodType>`. All 14 must resolve v4's `ZodType`.
- **`z.object()`** — 23 call sites in production. All must create v4 `ZodObject` instances.
- **`z.infer<T>`** — used in `defineTool`, `generateObject`, `streamObject` handler signatures. Zod v4 preserves `z.infer<T>` API.
- **`toJsonSchema()` / `z.toJSONSchema()`** — two dual-mode shims exist (SDK + handoff). Zod v4 ships native `z.toJSONSchema()`, eliminating need for `zod-to-json-schema` peer dep.
- **`PersistenceSchema`** — exported from `@theokit/sdk/internal/persistence`. Used by `sdk-cache` (currently inlined) and `workflow.ts`.
- **External consumers** — public API types `DefineToolSpec<T>`, `GenerateObjectOptions<T>`, `StreamObjectOptions<T>`, `StreamAssistantOptions<T>`, `HandoffOptions<T>` all expose `ZodType` in their signature. Consumers using Zod v3 will get a type error after this migration.

### Domain glossary

- **ZodType** — base class for all Zod schemas. In v3, it has `_parse`, `_type`, `_getType` etc. In v4, these are replaced with `_zod` internal property. The two are structurally incompatible.
- **ZodEffects** — wrapper type created by `.refine()`, `.transform()`, `.superRefine()`. In Zod v4, `ZodEffects` inside `z.object()` from a DIFFERENT Zod instance is rejected.
- **zod-to-json-schema** — third-party library that converts Zod schemas to JSON Schema. Unnecessary with Zod v4's native `z.toJSONSchema()`.
- **peer dep range** — `"^3.25.0 || ^4.0.0"` means the package works with either major. After this plan: `"^4.0.0"` only.

### Architecture boundaries affected

- **Public API surface** — `ZodType` appears in public generic constraints. Changing from v3-compatible to v4-only is a **breaking change for consumers on Zod v3**. Per SemVer pre-1.0 policy, this is allowed in a minor bump.
- **Cross-package dependency** — `sdk-cache`, `sdk-tools`, `sdk-handoff` all consume Zod schemas from `@theokit/sdk`. After migration, all resolve the same v4 instance.

## Prior Art & Related Work

- **Zod v4 migration guide** — https://zod.dev/v4/changelog (official). Documents `ZodType` changes, `.refine()` behavior, `z.toJSONSchema()` native.
- **Zod v4 `./v3` compat export** — Zod v4 ships `import { z } from "zod/v3"` for gradual migration. We do NOT use this (full migration, not gradual).
- **Internal: sdk-handoff `to-json-schema.ts`** — already implements the v4 detection path (`z.toJSONSchema` feature-detect). Pattern proven in production.

## Objective

- [ ] Verify `ls node_modules/.pnpm/zod@*` returns only v4.x directories (single Zod v4 resolution across all 28 workspace packages)
- [ ] Confirm all `ZodType` generic bounds resolve against Zod v4's `ZodType` class via `pnpm typecheck` exit 0
- [ ] Verify `grep -rn "as any" packages/*/src/ --include="*.ts" | grep -i zod` returns empty (zero `as any` casts on Zod types)
- [ ] Confirm `PersistenceSchema` imported from SDK (not inlined) in sdk-cache via `grep "from.*@theokit/sdk/internal/persistence" packages/sdk-cache/src/cache.ts`
- [ ] Verify `grep "zod-to-json-schema" packages/sdk/package.json` returns empty (`zod-to-json-schema` peer dep removed)
- [ ] Check all 6 package peer deps contain `"zod": "^4.0.0"` via `grep -A1 '"zod"' packages/*/package.json`
- [ ] Run `pnpm typecheck && pnpm build && pnpm test` — all exit 0

## ADRs

### D1 — Hard-lock Zod v4 via pnpm overrides + peer dep range narrowing

**Decision:** Add `pnpm.overrides.zod = "^4.0.0"` to root `package.json` AND update all 6 package peer deps from `"^3.25.0 || ^4.0.0"` to `"^4.0.0"`.

**Rationale:** The dual-version peer range was the root cause. pnpm resolves different versions for different packages based on hoisting order. A single override forces one resolution. Per `architecture.md` DIP principle: all packages depend on the same abstraction (Zod v4), not on mixed concretes (v3+v4). Per KISS: one version is simpler than two.

**Alternatives considered:**
- **(A) Keep `^3.25 || ^4` and use pnpm override only** — rejected because consumers who install `zod@3.x` alongside `@theokit/sdk` would get the same cross-version bug we're fixing. The peer range must match reality.
- **(B) Use `zod/v3` compat import in SDK** — rejected because it perpetuates the dual-version debt. The goal is elimination, not management.

**Consequences:** Consumers on Zod v3 must upgrade to v4. This is a breaking change, acceptable per pre-1.0 SemVer policy. CHANGELOG entry required under `### Changed`.

### D2 — Replace `zod-to-json-schema` with Zod v4 native `z.toJSONSchema()`

**Decision:** Remove the `zod-to-json-schema` optional peer dep from SDK. The `to-json-schema.ts` shim already feature-detects v4 native — after this migration, the v3 fallback path is dead code. Remove it.

**Rationale:** Per YAGNI: if we only support v4, the v3 fallback is dead. Per DRY: the handoff package has its own copy of the same shim. After migration, both can use v4 native directly. Per "Don't Reinvent" (Rule 9): Zod v4 ships the converter we were re-implementing via a third-party lib.

**Alternatives considered:**
- **(A) Keep `zod-to-json-schema` as fallback** — rejected because with v4-only peer range, the fallback can never trigger. Dead code violates no-stubs rule.

**Consequences:** Reduces peer dep count by 1. Simplifies the `to-json-schema.ts` shim from 126 LoC to ~30 LoC.

### D3 — Restore `PersistenceSchema` import in sdk-cache (remove duplication)

**Decision:** After migration, sdk-cache imports `PersistenceSchema` from `@theokit/sdk/internal/persistence` again (same Zod instance → no cross-version error). Remove the inlined copy + runtime validation workaround.

**Rationale:** Per DRY: the schema is defined once in the SDK, not duplicated. The workaround was only necessary because of cross-version incompatibility.

**Alternatives considered:**
- **(A) Keep inlined schema permanently** — rejected because it violates DRY for business logic (persistence backend constraints).

**Consequences:** sdk-cache re-gains the `.refine()` validation from the SDK's schema. Runtime check removed.

### D4 — Restore `.refine()` in `PersistenceSchema`

**Decision:** Restore the original `.refine()` call in `persistence-schema.ts` that was removed as a v4 workaround. With a single v4 Zod instance, `.refine()` inside `z.object()` works correctly (verified empirically).

**Rationale:** The `.refine()` was removed because it created `ZodEffects` from v3 that v4 rejected. With single-version resolution, this is no longer an issue. Restoring it gives proper Zod-level validation instead of the ad-hoc runtime check.

**Alternatives considered:**
- **(A) Keep runtime validation** — rejected because Zod already provides this; duplicating the check violates DRY.

**Consequences:** `persistence.dir is required when backend = "json"` is now a Zod validation error again (proper error shape with `ZodError` instead of plain `Error`).

### D5 — Remove `as any` casts in sdk-tools

**Decision:** Remove all 5 `as any` casts on `inputSchema` in sdk-tools. With unified v4, `z.object()` creates a `ZodType`-compatible schema natively.

**Rationale:** `as any` bypasses type safety — the original type error was legitimate (v3 `ZodType` ≠ v4 `ZodObject`). With v4-only, the types align naturally.

**Alternatives considered:**
- **(A) Cast to `ZodType` explicitly** — unnecessary with single-version resolution; the types already match.

**Consequences:** Full type inference restored for tool handler arguments.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Breaking change for consumers on Zod v3 | Medium | Pre-1.0 SemVer allows breaking in minor; document in CHANGELOG + MIGRATION.md; consumers can `pnpm add zod@4` (one command) | Plan author |
| `z.instanceof(RegExp)` must behave differently in Zod v4 | Low | Verified empirically during sdk-cache fix — works identically. Add regression test. | T2.3 |
| `z.toJSONSchema()` output shape must differ from `zod-to-json-schema` | Medium | Add snapshot test comparing output of both converters before removing the fallback. Only remove after shape equivalence confirmed. | T1.3 |
| `eval.ts` `z.unknown().refine()` patterns must need update | Low | Verified: `.refine()` works in v4 when same instance. No change needed. | T2.4 |

## Unresolved Questions

(none — every decision is resolved at plan time. The v4 API surface was empirically verified in the 2026-06-10 session: `.refine()`, `.superRefine()`, `z.instanceof()`, `z.toJSONSchema()`, `ZodType` generic bounds all work as expected with a single v4 instance.)

## Dependency Graph

```
Phase 0 (foundation) ──▶ Phase 1 (SDK core) ──▶ Phase 2 (downstream packages) ──▶ Phase 3 (cleanup + validation)
```

All phases are sequential — Phase 1 changes the SDK's Zod resolution which Phase 2 packages depend on.

---

## Phase 0: Foundation — Lock Zod v4 Workspace-Wide

**Objective:** Force single Zod v4 resolution across the entire pnpm workspace.

### T0.1 — Add pnpm override and update all peer dep ranges

#### Objective
Eliminate Zod v3 from the dependency tree and narrow all peer deps to `^4.0.0`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds `pnpm.overrides.zod = "^4.0.0"` to root `package.json`, updates peer dep ranges in 6 packages from `"^3.25.0 || ^4.0.0"` to `"^4.0.0"`, updates devDep ranges where they reference v3, runs `pnpm install` to re-resolve.

2. **Why it is necessary now** — this is the atomic foundation change that makes all subsequent fixes possible. Without single-version resolution, every other change is a workaround. Per ADR D1: dual-version peer range was the root cause. The override is the cheapest, safest way to force resolution before touching any source code.

#### Evidence
- `pnpm ls zod` currently shows 3 versions: 3.25.76, 4.0.0, 4.4.3 (verified 2026-06-10)
- `node -e` cross-instance test: v3 schema inside v4 `z.object()` → "expected a Zod schema" (reproduced)
- Same test with single v4 instance → PASS (reproduced)

#### Files to edit
```
package.json (root) — add pnpm.overrides.zod
packages/sdk/package.json — peerDependencies.zod: "^4.0.0", remove zod-to-json-schema peer
packages/sdk-cache/package.json — peerDependencies.zod: "^4.0.0", devDependencies.zod: "^4.0.0"
packages/sdk-tools/package.json — peerDependencies.zod + devDependencies.zod: "^4.0.0"
packages/sdk-handoff/package.json — peerDependencies.zod + devDependencies.zod: "^4.0.0"
packages/react/package.json — peerDependencies.zod: "^4.0.0", devDependencies.zod: "^4.0.0"
packages/cli/package.json — peerDependencies.zod: "^4.0.0"
```

#### Deep file dependency analysis
- `package.json` (root): workspace config. Adding `pnpm.overrides` affects resolution for all workspace members. No downstream code changes needed — this is a manifest-only change.
- Each `packages/*/package.json`: narrowing peer range from `"^3.25.0 || ^4.0.0"` to `"^4.0.0"`. Consumers who `pnpm add @theokit/sdk` with `zod@3.x` will get a peer warning.

#### Deep Dives
- **pnpm overrides**: forces ALL resolutions of `zod` to satisfy `^4.0.0`. Even transitive deps that declare `zod@^3` will get v4. This is safe because Zod v4 exports a `./v3` compat layer that transitive deps can use.
- **After `pnpm install`**: `node_modules/.pnpm/zod@3.*` directories must disappear. Verify with `ls node_modules/.pnpm/zod@*`.

#### Tasks
1. Add `"pnpm": { "overrides": { "zod": "^4.0.0" } }` to root `package.json`
2. Update all 6 package.json peer dep ranges
3. Remove `"zod-to-json-schema"` from sdk's peerDependencies and peerDependenciesMeta
4. Run `pnpm install`
5. Verify `ls node_modules/.pnpm/zod@*` shows only v4.x

#### TDD
```
RED:     test_single_zod_version_resolved() — `pnpm ls zod --depth=0` shows only v4.x entries
RED:     test_consumer_with_zod_v3_gets_peer_warning() — (EC-4, manual verification) `pnpm add @theokit/sdk zod@3.25.0` in a temp dir triggers peer dep warning
GREEN:   Apply manifest changes + pnpm install
REFACTOR: None expected
VERIFY:  pnpm install && ls node_modules/.pnpm/zod@*
```

#### Acceptance Criteria
- [ ] Run `ls node_modules/.pnpm/zod@*` and verify it shows only `zod@4.x.x` directories
- [ ] Run `pnpm install` and verify it exits 0 with no unresolved peer warnings for zod
- [ ] Verify no `zod@3.x` in `pnpm-lock.yaml`

#### DoD
- [ ] Verify all manifests updated
- [ ] Run `pnpm install` and confirm exit 0 with clean output
- [ ] Verify single v4 resolution via `ls node_modules/.pnpm/zod@*`

---

## Phase 1: SDK Core — Migrate Zod Surface

**Objective:** Update all Zod usage in `@theokit/sdk` to be v4-native. Remove v3 compat code.

### T1.1 — Restore `PersistenceSchema` with `.refine()` (D4)

#### Objective
Restore the original `.refine()` validation in `persistence-schema.ts` that was removed as a v4 workaround.

#### Why this step
1. **What:** Revert `persistence-schema.ts` to include the `.refine()` call checking `dir` when `backend === "json"`.
2. **Why now:** With single v4 resolution (Phase 0), `.refine()` inside `z.object()` works correctly. The ad-hoc runtime check in sdk-cache (T2.3) depends on this schema being properly validated. Per ADR D4.

#### Evidence
- Empirical test: `z.object({ p: z.object({x: z.number()}).refine(v => v.x > 0).optional() })` passes with single v4 (2026-06-10)

#### Files to edit
```
packages/sdk/src/internal/persistence/persistence-schema.ts — restore .refine()
```

#### Deep file dependency analysis
- `persistence-schema.ts`: currently a plain `z.object().optional()` without validation. Restoring `.refine()` re-adds the `dir is required when backend = "json"` constraint at the Zod level. Consumers: `workflow.ts` (via SDK barrel), `sdk-cache/cache.ts` (currently inlined — reunified in T2.3).

#### Tasks
1. Restore `.refine()` in `PersistenceSchema`
2. Verify `pnpm --filter @theokit/sdk exec tsc --noEmit` passes

#### TDD
```
RED:     test_persistence_schema_rejects_json_without_dir() — PersistenceSchema.parse({backend:"json"}) throws
GREEN:   Restore .refine()
REFACTOR: None
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/internal/persistence/
```

#### Acceptance Criteria
- [ ] Verify `PersistenceSchema.parse({backend: "json"})` throws with message matching `/dir is required/i`
- [ ] Verify `PersistenceSchema.parse({backend: "json", dir: "/tmp"})` succeeds
- [ ] Verify `PersistenceSchema.parse({backend: "memory"})` succeeds
- [ ] Verify `PersistenceSchema.parse(undefined)` succeeds (optional)
- [ ] Run `tsc --noEmit` and verify it passes

#### DoD
- [ ] Run `vitest run` and verify tests green
- [ ] Run `tsc --noEmit` and confirm exit 0

---

### T1.2 — Verify `ZodType` generic bounds work with v4

#### Objective
Confirm all `<T extends ZodType>` generics in the SDK compile correctly with Zod v4's `ZodType`.

#### Why this step
1. **What:** Run typecheck on the SDK after Phase 0 resolution change. The `ZodType` import from `"zod"` now resolves v4. All generic bounds (`DefineToolSpec<T>`, `GenerateObjectOptions<T>`, etc.) must still compile.
2. **Why now:** This is the core type-safety verification. If `ZodType` semantics changed in v4 enough to break generics, we need to know before touching downstream packages.

#### Evidence
- Zod v4 preserves `ZodType` as base class for all schemas (`typeof z.ZodType === 'function'`, verified 2026-06-10)
- `z.object({}).parse` exists, `instanceof z.ZodType` returns `true` (verified)

#### Files to edit
```
(no edits expected — verification only)
```

#### Tasks
1. Run `pnpm --filter @theokit/sdk exec tsc --noEmit`
2. If errors: fix the affected files (document which)
3. Run `pnpm --filter @theokit/sdk exec vitest run`

#### TDD
```
RED:     test_zod_issue_code_custom_is_available() — (EC-5) verify z.ZodIssueCode.custom exists in v4 (used by PersistenceSchema .refine/.superRefine)
RED:     (existing test suite is the main gate)
GREEN:   Phase 0 resolution change should make existing tests pass
VERIFY:  pnpm --filter @theokit/sdk exec tsc --noEmit && pnpm --filter @theokit/sdk exec vitest run
```

#### Acceptance Criteria
- [ ] Run `tsc --noEmit` and verify exit 0 for `@theokit/sdk`
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run` and verify all 2536 SDK tests pass
- [ ] Verify no new `as any` casts introduced
- [ ] Verify `z.ZodIssueCode.custom` resolves (EC-5 — regression guard against renamed issue codes)

#### DoD
- [ ] Run `pnpm typecheck && pnpm test` and verify both exit 0

---

### T1.3 — Simplify `to-json-schema.ts` — remove v3 fallback (D2)

#### Objective
Remove the `zod-to-json-schema` fallback path and use Zod v4 native `z.toJSONSchema()` exclusively.

#### Why this step
1. **What:** Rewrite `to-json-schema.ts` to call `z.toJSONSchema()` directly. Remove the feature-detection dance and the `createRequire` fallback. ~126 LoC → ~30 LoC.
2. **Why now:** With v4-only, the v3 codepath is dead. Per ADR D2 / YAGNI. The same cleanup applies to `sdk-handoff/src/internal/to-json-schema.ts`.

#### Evidence
- `z.toJSONSchema` is `function` in v4 (verified 2026-06-10)
- Handoff's `to-json-schema.ts` already has the v4 path implemented and tested

#### Files to edit
```
packages/sdk/src/internal/zod/to-json-schema.ts — simplify to v4-only
packages/sdk-handoff/src/internal/to-json-schema.ts — simplify to v4-only
```

#### Deep file dependency analysis
- SDK's `to-json-schema.ts`: called by `define-tool.ts:57` (`toJsonSchema(spec.inputSchema)`). Output must remain `Record<string, unknown>` with `type: "object"`.
- Handoff's `to-json-schema.ts`: called by `tool-injector.ts:115`. Same contract.

#### Tasks
1. Add snapshot test: capture current `toJsonSchema(z.object({x: z.string()}))` output as golden fixture
2. Rewrite SDK's `to-json-schema.ts` to use v4 native only
3. Rewrite handoff's `to-json-schema.ts` to use v4 native only
4. Verify snapshot test passes (output shape unchanged)

#### TDD
```
RED:     test_to_json_schema_produces_valid_json_schema() — golden snapshot of z.object output (NOTE: v4 native adds `$schema` + `additionalProperties: false` — snapshot MUST include both; EC-1)
RED:     test_to_json_schema_with_refine_produces_valid_schema() — z.toJSONSchema(z.object({x: z.string()}).refine(() => true), {unrepresentable: "any"}) produces valid JSON Schema without throwing (EC-3)
GREEN:   Rewrite to v4 native
REFACTOR: Remove dead code (createRequire, feature-detection, error messages about v3)
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/internal/zod/ && pnpm --filter @theokit/sdk-handoff exec vitest run
```

#### Acceptance Criteria
- [ ] Verify `toJsonSchema(z.object({x: z.string()}))` produces `{ "$schema": "...", type: "object", properties: { x: { type: "string" } }, required: ["x"], additionalProperties: false }` — v4 native output shape (EC-1: golden fixture updated to include `$schema` + `additionalProperties: false`; both fields are correct per OpenAI/Anthropic tool spec)
- [ ] Verify `toJsonSchema(z.object({x: z.string()}).refine(() => true))` produces valid JSON Schema without throwing (EC-3: `{unrepresentable: "any"}` option passed)
- [ ] Verify no `createRequire` in production code
- [ ] Verify no reference to `zod-to-json-schema` in production code
- [ ] Verify `to-json-schema.ts` ≤ 40 LoC via `wc -l`

#### DoD
- [ ] Run tests and verify all green
- [ ] Verify snapshot matches (v4 native shape with `$schema` + `additionalProperties`)

---

## Phase 2: Downstream Packages — Remove Workarounds

**Objective:** Remove all `as any` casts and inlined schemas from sdk-cache, sdk-tools, and sdk-handoff.

### T2.1 — Remove `as any` casts in sdk-tools (D5)

#### Objective
Remove all 5 `as any` casts on `inputSchema` in sdk-tools tool definitions.

#### Why this step
1. **What:** Remove `as any` from `git-diff.ts`, `list-dir.ts`, `read-file.ts`, `run-vitest.ts`, `search-text.ts`.
2. **Why now:** With single v4 resolution, `z.object()` returns a type that extends `ZodType` natively. The cast is no longer needed. Per ADR D5.

#### Files to edit
```
packages/sdk-tools/src/git-diff.ts — remove `as any` on inputSchema
packages/sdk-tools/src/list-dir.ts — same
packages/sdk-tools/src/read-file.ts — same
packages/sdk-tools/src/run-vitest.ts — same
packages/sdk-tools/src/search-text.ts — same
```

#### Tasks
1. Remove `as any` from all 5 files
2. Run `pnpm --filter @theokit/sdk-tools run build` (DTS must pass without the cast)
3. Run `pnpm --filter @theokit/sdk-tools exec vitest run`

#### TDD
```
RED:     (existing test suite — DTS build is the gate)
GREEN:   Remove casts; types align naturally
VERIFY:  pnpm --filter @theokit/sdk-tools run build && pnpm --filter @theokit/sdk-tools exec vitest run
```

#### Acceptance Criteria
- [ ] Verify zero `as any` in sdk-tools production source
- [ ] Run `pnpm --filter @theokit/sdk-tools run build` and verify DTS exit 0 with `dist/index.d.ts` emitted
- [ ] Run `pnpm --filter @theokit/sdk-tools exec vitest run` and verify exit 0 with 0 failures

#### DoD
- [ ] Run `pnpm --filter @theokit/sdk-tools run build && pnpm --filter @theokit/sdk-tools exec vitest run` and confirm both exit 0
- [ ] Run `grep "as any" packages/sdk-tools/src/*.ts` and verify it returns empty

---

### T2.2 — Verify sdk-handoff types align

#### Objective
Verify sdk-handoff's `ZodType` imports and `to-json-schema` work with v4-only resolution.

#### Why this step
1. **What:** Run typecheck + build + tests on sdk-handoff after Phase 0+1 changes.
2. **Why now:** Handoff has the most `ZodType` references (6 files, 12 occurrences). Must verify they compile.

#### Files to edit
```
(no edits expected — verification only; if errors surface, fix inline)
```

#### TDD
```
VERIFY:  pnpm --filter @theokit/sdk-handoff run build && pnpm --filter @theokit/sdk-handoff exec vitest run
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/sdk-handoff run build` and confirm exit 0 with `dist/index.d.ts` emitted
- [ ] Run `pnpm --filter @theokit/sdk-handoff exec vitest run` and confirm exit 0 with 0 failures

#### DoD
- [ ] Run `pnpm --filter @theokit/sdk-handoff run build && pnpm --filter @theokit/sdk-handoff exec vitest run` and confirm both exit 0

---

### T2.3 — Restore PersistenceSchema import in sdk-cache (D3)

#### Objective
Remove the inlined `PersistenceSchema` and runtime validation workaround in sdk-cache. Import from SDK again.

#### Why this step
1. **What:** In `cache.ts`, replace the inlined `z.object({backend, dir}).optional()` with `import { PersistenceSchema } from "@theokit/sdk/internal/persistence"`. Remove the manual `dir` validation. Restore the `embedder` field's original `.refine()` validation (remove the `z.unknown()` + runtime check workaround).
2. **Why now:** Per ADR D3. With single v4, the cross-instance bug is gone. DRY: one schema definition, not two.

#### Files to edit
```
packages/sdk-cache/src/cache.ts — restore import + refine, remove workarounds
```

#### Tasks
1. Restore `import { PersistenceSchema } from "@theokit/sdk/internal/persistence"`
2. Replace inlined persistence schema with `PersistenceSchema`
3. Restore `embedder: z.unknown().refine(...)` (was working in v4 with same instance)
4. Remove runtime validation for `persistence.dir` and `embedder` shape
5. Run tests

#### TDD
```
RED:     test_cache_semantic_rejects_json_without_dir() — already exists, must still pass
GREEN:   Restore imports + refine
VERIFY:  pnpm --filter @theokit/sdk-cache run build && pnpm --filter @theokit/sdk-cache exec vitest run
```

#### Acceptance Criteria
- [ ] Verify `grep -c "z\.object.*backend.*json" packages/sdk-cache/src/cache.ts` returns 0 (no inlined schema duplication)
- [ ] Verify `grep -c "options\.persistence.*backend.*json" packages/sdk-cache/src/cache.ts` returns 0 (no ad-hoc runtime validation)
- [ ] Run `pnpm --filter @theokit/sdk-cache exec vitest run` and confirm 7/7 test files pass with exit 0
- [ ] Run `pnpm --filter @theokit/sdk-cache run build` and confirm exit 0 with `dist/index.d.ts` emitted

#### DoD
- [ ] Run build + tests and verify both green
- [ ] Confirm `PersistenceSchema` imported from SDK, not defined locally

---

### T2.4 — Verify eval.ts `.refine()` patterns work

#### Objective
Confirm `eval.ts`'s `z.unknown().refine()` patterns work with v4.

#### Why this step
1. **What:** Run eval tests. The 3 refine calls in `eval.ts` must work since they're same-instance.
2. **Why now:** Completeness check. Eval is the third consumer of `.refine()` in the workspace.

#### Files to edit
```
(no edits expected — verification only)
```

#### TDD
```
VERIFY:  pnpm --filter @theokit/sdk exec vitest run tests/eval/
```

#### Acceptance Criteria
- [ ] Run `pnpm --filter @theokit/sdk exec vitest run tests/eval/` and confirm exit 0 with 0 failures

---

## Phase 3: Cleanup + Integration Validation

**Objective:** Final cleanup, CHANGELOG, and full workspace validation.

### T3.1 — Remove dead `zod-to-json-schema` references

#### Objective
Grep workspace for any remaining `zod-to-json-schema` references and remove them.

#### Files to edit
```
packages/sdk/package.json — already removed in T0.1; verify
docs/ — remove any install instructions referencing zod-to-json-schema
```

#### Tasks
1. `grep -rn "zod-to-json-schema" packages/ docs/ --include="*.ts" --include="*.md" --include="*.json" | grep -v node_modules`
2. Remove all references
3. Verify no test imports it

#### Acceptance Criteria
- [ ] Verify zero references to `zod-to-json-schema` in source or docs

---

### T3.2 — Update CHANGELOG + MIGRATION.md

#### Objective
Document the breaking change for consumers.

#### Files to edit
```
CHANGELOG.md — [Unreleased] § Changed: "BREAKING: Zod peer dependency narrowed from ^3.25||^4 to ^4.0.0 only"
packages/sdk/CHANGELOG.md — same
MIGRATION.md — add Zod v4 migration section
```

#### Tasks
1. Add CHANGELOG entries
2. Add MIGRATION.md section explaining `pnpm add zod@4` for consumers on v3
3. Document Zod v4 error message format change in MIGRATION.md (EC-2): "Zod v4 default error messages changed format (`'Expected string, received number'` → `'Invalid input: expected string, received number'`). Tests asserting on exact Zod error text must be updated. Custom `.refine()` messages are unaffected."
4. Document `additionalProperties: false` behavioral change in MIGRATION.md (EC-6): tool JSON schemas now include `additionalProperties: false` by default (Zod v4 native). This is correct per OpenAI/Anthropic tool spec. Consumers relying on LLMs passing undeclared extra fields (extremely unlikely) must be aware.

#### Acceptance Criteria
- [ ] Verify CHANGELOG contains entry under `### Changed`
- [ ] Verify MIGRATION.md contains Zod v4 migration section with install fix
- [ ] Verify MIGRATION.md contains error message format change documentation (EC-2)
- [ ] Verify MIGRATION.md contains `additionalProperties: false` change documentation (EC-6)

---

### T3.3 — Full workspace validation

#### Objective
Run the complete validation pipeline.

#### Tasks
1. `pnpm typecheck` — all packages
2. `pnpm -w run check` — biome
3. `pnpm test` — all tests
4. `pnpm build` — all packages
5. Verify zero `as any` on Zod types: `grep -rn "as any" packages/*/src/ --include="*.ts" | grep -i zod`

#### TDD
```
VERIFY:  pnpm typecheck && pnpm -w run check && pnpm test && pnpm build
```

#### Acceptance Criteria
- [ ] Run `pnpm typecheck` and verify 0 errors across all packages
- [ ] Run `pnpm -w run check` and verify 0 errors
- [ ] Run `pnpm test` and verify all passing (2536 SDK + 287 sdk-memory + sdk-cache + sdk-handoff + sdk-tools)
- [ ] Run `pnpm build` and verify all 28 packages build successfully
- [ ] Verify zero `as any` casts on Zod types in production source

---

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate that the implemented changes work as a cohesive whole.

### Execution

```bash
pnpm typecheck                    # zero type errors
pnpm -w run check                 # zero lint warnings
pnpm test                         # all tests green
pnpm build                        # all packages build
pnpm --filter @theokit/sdk exec vitest run  # SDK specifically
```

### Acceptance Criteria

- [ ] Run `pnpm test` and verify all test suites green
- [ ] Run `pnpm typecheck` and verify zero type errors
- [ ] Run `pnpm -w run check` and verify zero lint warnings
- [ ] Verify zero `as any` on Zod types
- [ ] Run `ls node_modules/.pnpm/zod@*` and verify only v4.x
- [ ] Run `grep "zod-to-json-schema" pnpm-lock.yaml` and verify it returns empty

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing
2. Fix all plan-caused failures before declaring the plan complete
3. Re-run the validation chain to confirm fixes

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Three Zod versions coexisting | T0.1 | pnpm override + peer dep narrowing forces single v4 |
| 2 | `PersistenceSchema` cross-instance crash | T1.1, T2.3 | Restore `.refine()` + reimport from SDK |
| 3 | `ZodType` generic bound incompatibility | T1.2 | Verified v4 `ZodType` preserves generic constraint API |
| 4 | Dead `zod-to-json-schema` fallback code | T1.3 | Simplified to v4 native `z.toJSONSchema()` |
| 5 | `as any` casts in sdk-tools | T2.1 | Removed; types align with single v4 |
| 6 | sdk-handoff type alignment | T2.2 | Verified builds + tests pass |
| 7 | Inlined schema in sdk-cache | T2.3 | Reimport from SDK |
| 8 | `eval.ts` refine patterns | T2.4 | Verified same-instance works |
| 9 | Consumer breaking change undocumented | T3.2 | CHANGELOG + MIGRATION.md |
| 10 | Full workspace validation | T3.3 | Typecheck + lint + tests + build |
| 11 | EC-1: `z.toJSONSchema()` output shape differs (adds `$schema` + `additionalProperties`) | T1.3 | Golden fixture updated to v4 native shape |
| 12 | EC-2: Zod v4 error messages format changed | T3.2 | Documented in MIGRATION.md |
| 13 | EC-3: `z.toJSONSchema()` with `.refine()` must throw without `unrepresentable: "any"` | T1.3 | Regression test added |
| 14 | EC-4: Consumer with Zod v3 peer dep experience | T0.1 | Manual verification in TDD |
| 15 | EC-5: `ZodIssueCode` enum values changed in v4 | T1.2 | Regression test for `z.ZodIssueCode.custom` |
| 16 | EC-6: `additionalProperties: false` behavioral change in tool schemas | T3.2 | Documented in MIGRATION.md |

**Coverage: 16/16 gaps covered (100%)**

## Global Definition of Done

- [ ] Verify all phases completed
- [ ] Run `pnpm test` and verify all passing across all workspace packages
- [ ] Run `pnpm typecheck` and verify zero type errors
- [ ] Run `pnpm -w run check` and verify zero lint warnings
- [ ] Verify file-size budget respected (all touched files ≤ 500 LoC)
- [ ] Verify CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Verify BREAKING change documented in CHANGELOG + MIGRATION.md
- [ ] Verify zero `as any` casts on Zod types in production source
- [ ] Verify zero references to `zod-to-json-schema` in production source
- [ ] Run `ls node_modules/.pnpm/zod@*` and verify single Zod v4 resolution (only v4.x)
- [ ] Confirm plan archived to `knowledge-base/plans/completed/` after merge
