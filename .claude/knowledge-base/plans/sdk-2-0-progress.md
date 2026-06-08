---
slug: sdk-2-0-package-split
artifact: progress-log
started_at: 2026-06-07T22:55Z
---

# SDK 2.0 split — progress log (ralph-loop)

Tracking which phases/tasks are committed. Updated each iteration.

## Phase 0 — Baseline snapshot

| Task | Status | Commit | Tests |
|---|---|---|---|
| T0.1 — Subsystem map + bundle baseline | ✅ DONE 2026-06-08 | `aa8b079` | 4/4 GREEN |

**Deliverables shipped:**
- `.claude/knowledge-base/baselines/sdk-2-0-baseline-bundle-2026-06-07.md`
- `.claude/knowledge-base/baselines/sdk-2-0-baseline-subsystems-2026-06-07.md`
- `packages/sdk/tests/sdk-2-0-baseline.test.ts` (4 tests)
- `packages/sdk/dist/index.js` measured at **138677 bytes gzipped** (matches plan).

## Phase 1 — Extract `@theokit/sdk-memory`

| Task | Status | Notes |
|---|---|---|
| T1.1 — Scaffold + move 40 files / 4070 LOC | ⏳ POSTPONED | Pivoted to Phase 3 (Cache) first — see below. Pre-step (EC-1) for Memory already shipped at commit `26c15a6`. |

**Next steps for T1.1:**
1. `pnpm-workspace.yaml` already captures `packages/*` glob — no edit needed.
2. Create `packages/sdk-memory/{package.json, tsconfig.json, tsup.config.ts, LICENSE, README.md, src/, tests/}`.
   - `package.json` peerDeps: `@theokit/sdk-core` (will be sdk-core post-Phase-6; for now use `@theokit/sdk@^1.7.0`), `better-sqlite3@>=11`, `sqlite-vec@>=0.1`, `@lancedb/lancedb@>=0.10`.
   - **EC-2 absorbed:** `tsup.config.ts` MUST declare `external: [/^@theokit\//, 'better-sqlite3', 'sqlite-vec', '@lancedb/lancedb']`.
3. **EC-1 absorbed:** Add `./internal/persistence` sub-path to `packages/sdk/package.json` exports BEFORE move (sdk-memory will import via this sub-path).
4. Write move script `tools/move-memory-subsystem.mjs` (dry-run first).
5. Move:
   - `packages/sdk/src/memory.ts` (191 LOC) → `packages/sdk-memory/src/memory.ts`
   - `packages/sdk/src/memory-adapter-helpers.ts` → `packages/sdk-memory/src/memory-adapter-helpers.ts`
   - `packages/sdk/src/internal/memory/**` (40 files, 4070 LOC) → `packages/sdk-memory/src/internal/`
     - Adjust import paths: `from "./internal/memory/X"` → `from "./internal/X"`.
   - `packages/sdk/src/types/memory-adapter.ts` → `packages/sdk-memory/src/types/memory-adapter.ts`
   - Tests in `packages/sdk/tests/memory*.test.ts` (and `internal/memory/**/*.test.ts`) → `packages/sdk-memory/tests/`.
6. Strip Memory exports from `packages/sdk/src/index.ts`:
   - Remove `export { Memory, ... } from './memory.js';`
   - Remove `export { extractRawId, mkMemoryId } from './memory-adapter-helpers.js';`
7. **CRITICAL — external consumers of Memory in sdk/src/:**
   - theokit.ts, migrate.ts, internal/llm/credential-pool.ts, internal/runtime/fixtures/*, internal/runtime/local-agent-dispatch.ts, internal/runtime/local-agent-personality-extensions.ts
   - These import `Memory` from `./memory.js`. After move they need `from '@theokit/sdk-memory'` BUT this creates kernel→extension dep direction violation.
   - **Resolution:** type-only imports stay; runtime imports need redesign. Specifically check which usages are types vs runtime values.
8. `pnpm install -w` after package created (EC-5 absorbed).
9. Build + tests in sdk-memory.
10. Commit: `feat(sdk-memory): extract @theokit/sdk-memory 0.1.0 from @theokit/sdk@1.7.0 (T1.1)`.

**Open concern surfaced during baseline measurement:**

The plan ADR D1 stated "Memory subsystem (4070 LOC) — barrel re-exports Memory namespace mas agent-loop não importa Memory diretamente; Memory é state observada por hooks. Extractable." But empirical grep shows Memory is used by **7+ files outside internal/memory** (theokit.ts, migrate.ts, credential-pool.ts, fixtures, local-agent-dispatch.ts, personality-extensions.ts). These external usages need careful handling — either:
- (a) move those external users TO sdk-memory if they're memory-tools (theokit.ts probably has the public Memory facade — already moved with memory.ts; migrate.ts handles memory migration scripts — could stay in core OR move).
- (b) refactor those files to import Memory from `@theokit/sdk-memory` peer (creates kernel→extension dep — bad).
- (c) leave a thin Memory facade in core that delegates to sdk-memory at runtime (defeats bundle gain).

**Recommendation for T1.1 execution:** classify each external usage as type-only vs runtime. Type-only imports stay (TS only, no bundle impact). Runtime imports require per-case decision. If we find > 3 runtime imports that can't be cleanly resolved, surface as a BLOCKED finding and revisit ADR D1.

## Phase 3 — Extract `@theokit/sdk-cache` (PIVOTED — done before Phase 1)

| Task | Status | Commit | Tests |
|---|---|---|---|
| Pre-step EC-1 + plugin types — internal sub-paths | ✅ DONE 2026-06-08 | `26c15a6` | 11/11 GREEN |
| T3.1 — Cache extraction | ✅ DONE 2026-06-08 | `f67ed6d` | 54/54 GREEN |

**Why pivot:** Phase 0 baseline + iter 2 investigation revealed Memory has 7+ external runtime consumers (theokit.ts, migrate.ts, credential-pool.ts, fixtures, etc.) requiring per-case decisions. Cache had ZERO external runtime consumers — clean extraction. Plan T3.1 explicitly says Phases 1-5 are independent and parallelizable, so reordering doesn't break dependency graph.

**Deliverables Phase 3:**
- `packages/sdk-cache/` (new package, 18.51 KB ESM / 5.20 KB gzipped — 79% under 25 KB budget).
- 7 test files (cache-create, consult-remember, cosine-key, lookup, store-handler, store, ttl) all 54 tests GREEN.
- sdk barrel stripped of `Cache, CacheEmbedderError, CacheInvalidTtlError` (breadcrumb comment points consumers at `@theokit/sdk-cache`).
- `@theokit/sdk/internal/persistence` sub-path expanded with `atomicWriteText` + `PersistenceSchema`.
- `@theokit/sdk/internal/observability` sub-path created (infrastructure for Memory/Handoff future work).

**Quality gates Phase 3:**
- EC-2 verified: `grep -c "class Agent\|function definePlugin" sdk-cache/dist/index.js` = 0.
- EC-5 verified: `pnpm list @theokit/sdk-cache` finds workspace registration.
- Dual-Zod-realm bug surfaced + fixed: aligned sdk-cache devDep zod ^3.25.76 → ^4.0.0 to match sdk's resolved zod@4.4.3.
- Inline tracer-loader workaround documented (rollup-plugin-dts emits empty stub for new internal barrels — runtime works, only DTS affected; future investigation).

## Phase 5 — Extract `@theokit/sdk-tools` (PIVOTED — done before Phase 1)

| Task | Status | Commit | Tests |
|---|---|---|---|
| T5.1 — Tools extraction | ✅ DONE 2026-06-08 | `e67d1db` | 46/46 GREEN |

**Deliverables Phase 5:**
- `packages/sdk-tools/` (new package, 19.69 KB ESM / 5.20 KB gzipped — 65% under 15 KB budget).
- 6 test files (git-diff, list-dir, read-file, run-vitest, search-text, sub-export-smoke) all 46 tests GREEN.
- sdk barrel additions: `CustomTool` type explicit export (needed by extracted package).
- `@theokit/sdk/internal/security` sub-path created (parallel to persistence/plugins/observability).
- Inline `path-guard.ts` in sdk-tools/internal/ — full ~200 LOC duplicate of the security primitives. Rationale: rollup-plugin-dts bug consistently emits incomplete `index.d.ts` for newly-modified internal/ barrels.

**Quality gates Phase 5:**
- AC1-AC10 all PASS (build, tests, EC-2, EC-5, bundle budget, sdk regression check).
- EC-2 verified: `grep -c "class Agent" sdk-tools/dist/index.js` = 0.
- EC-5 verified: `pnpm list @theokit/sdk-tools` finds workspace registration.

## Phase 10 — CI Bundle Budget Gate

| Task | Status | Commit | Tests |
|---|---|---|---|
| T10.1 — `scripts/check-bundle-budget.mjs` + `.bundle-budget.json` + CI step | ✅ DONE 2026-06-08 | `fb5cb96` | 6/6 GREEN |

**Deliverables Phase 10:**
- `scripts/check-bundle-budget.mjs` — Node script, zero deps, reads every `packages/<name>/.bundle-budget.json`, measures gzipped, fails CI on overshoot. Supports --json + --package=<name> filter.
- `packages/sdk-cache/.bundle-budget.json` = `{ "dist/index.js": 25000 }` (current: 5339 / 21%)
- `packages/sdk-tools/.bundle-budget.json` = `{ "dist/index.js": 15000 }` (current: 5164 / 34%)
- `pnpm check:bundle` script wired into `pnpm validate`
- `.github/workflows/ci.yml` "Bundle budget gate" step after Quality

## Phase 8 — Migration Codemod (jscodeshift)

| Task | Status | Commit | Tests |
|---|---|---|---|
| T8.1 — Codemod `1-x-to-2-0.cjs` + 5 fixtures + 8 tests | ✅ DONE 2026-06-08 | `2b3ad4e` | 8/8 GREEN |

**Deliverables Phase 8:**
- `scripts/migrations/1-x-to-2-0.cjs` — jscodeshift transformer (CommonJS — jscodeshift loads via require). Five transforms:
  - (A) Sub-path: `@theokit/sdk/tools` → `@theokit/sdk-tools`
  - (B) Named import split: `@theokit/sdk` → multiple targets per map.json
  - (C) Re-export rewrite: `export { X } from "@theokit/sdk"` → new target
  - (D) EC-3: `Agent.create({...})` sem `budgetTracker` → CODEMOD-WARN comment
  - (E) EC-4: `Agent.create({ handoffs })` → CODEMOD comment (no auto-rewrite)
- `scripts/migrations/1-x-to-2-0-map.json` — 21 symbol→target entries (Cache + Tools). Pending: Memory/Budget/Handoff entries land when Phases 1/2/4 extract those.
- 5 byte-equal fixtures: single-cache-import, mixed-imports, aliased, agent-create-no-budget, agent-create-handoffs.
- 8 tests including idempotency check (md5-stable on re-run).

**Quality gates Phase 8:**
- `pnpm vitest run tests/codemod-1-x-to-2-0.test.ts`: 8/8 GREEN
- Idempotency: PASS (walkUpToStatement helper attaches comments to outer statement, not inner CallExpression, so the hasLeadingComment check finds the marker on subsequent runs)

## Phase 9 — Documentation

| Task | Status | Commit | Tests |
|---|---|---|---|
| T9.1 — packages/README.md families + 1-x-to-2-0 migration guide | ✅ DONE 2026-06-08 | `0addd94` | 11/11 GREEN |

**Deliverables Phase 9:**
- `packages/README.md` (NEW) — 5-family table (Core / Channels / Memory adapters / React / Integrations) listing all 24 packages. Status table for SDK 2.0 split phases.
- `docs/migration/1-x-to-2-0.md` (NEW) — consumer guide with:
  - 5-row subsystem summary (Cache/Tools shipped; Memory/Budget/Handoff pending)
  - One-command upgrade snippet (jscodeshift dry-run → apply)
  - Before/after diff blocks per surface
  - **⚠ silent breaking change** flag for Agent.create without budgetTracker (EC-3)
  - Handoff option removal walkthrough (EC-4)
  - 8-row breaking changes table
  - Rollback procedure (pin 1.7.0)
  - Known codemod limitations
- `packages/sdk/tests/docs-sdk-2-0.test.ts` — 11 validation tests (existence, 5 families, every package name appears, codemod snippet present, ≥4 diff blocks, budget+handoff sections present, sub-package READMEs).

## Phase 2, 4, 6, 7 + Final + Phase 1 (Memory still postponed)

Not started. See `sdk-2-0-package-split-plan.md` for tasks.

**Phase 4 (Handoff) planning notes (surfaced iter 5):**
- 491 LOC internal + 120 LOC public + 109 LOC types + 4 tests.
- agent.ts has lazy `await import("./internal/handoff/tool-injector.js")` in `maybeInjectHandoffTools()` — needs to point at sdk-handoff after move.
- Handoff.asPlugin() does NOT exist yet — must be added per plan T4.1.
- EC-4 absorbed in v1.1 mandates `AgentCreateOptions` removes `handoffs?` field (breaking change to `Agent.create`).
- Strategy for next iter: (a) scaffold sdk-handoff, (b) move source, (c) implement asPlugin via dispatcher wrapper, (d) agent.ts uses try-catch dynamic import of sdk-handoff (optional peer model), (e) keep `handoffs:` option transitional with deprecation warning, (f) full removal lands in Phase 6 cohort.

**Concurrent session note (updated iter 3):** The sdk-superiority session reached iter 10 and finished T3.1 (SSE parser HTML LS compliance) + acknowledged my prior commits via `7f4b98c`. My Phase 5 commit `e67d1db` accidentally swept up 4 pre-staged files from their session (CHANGELOG.md, ollama-native.ts, sse.ts, sse-abort-cancels-body.test.ts) because they were in the git index before I ran `git commit`. Work preserved correctly; their next iteration will recognize their files are committed.

**Concurrent session note:** the sdk-superiority halt-loop session (iter 9+) is ACTIVE in this repo and committed T2.1 (`1af7f5d`, `17d8552`, `351eee0`) AFTER my Phase 0 / pre-step / Phase 3. The two sessions work in orthogonal areas (sdk-superiority touches `internal/agent-loop/loop.ts`; SDK 2.0 split touches subsystem extraction). No conflicts yet but Phase 2 of SDK 2.0 plan WILL touch agent-loop — coordinate before starting.

## Pre-existing uncommitted state (NOT from this loop)

The following files have changes from a prior session (sdk-superiority halt-loop, iteration 8 marked Wave 1 complete). They are NOT touched by this loop and SHOULD be committed/cleaned separately by their owner:

```
M packages/sdk/src/internal/agent-loop/loop.ts  (+33 lines)
?? .claude/CHANGELOG.md
?? packages/sdk/tests/internal/agent-loop/validate-response-nudge.test.ts
```

The biome errors in `loop.ts` (2 errors) and the warning in `tests/chaos/kill-mid-stream.test.ts` are also pre-existing.

**Impact on SDK 2.0 split:** loop.ts is touched by Phase 2 T2.1 (BudgetTracker interface inversion). The uncommitted +33 lines will need to be either committed by the prior owner OR rebased into the Phase 2 refactor. Surface to user before starting Phase 2.

## Iteration log

| Iteration | Date | Phase/Task | Outcome |
|---|---|---|---|
| 1 | 2026-06-08 | Phase 0 / T0.1 | DONE — commit `aa8b079`; 4/4 tests GREEN |
| 2 | 2026-06-08 | Pre-step + Phase 3 / T3.1 | DONE — commits `26c15a6` + `f67ed6d`; 65/65 cumulative tests GREEN (11 pre-step + 54 cache) |
| 3 | 2026-06-08 | Phase 5 / T5.1 | DONE — commit `e67d1db`; 46/46 sdk-tools tests GREEN; 165 cumulative tests across 3 packages (sdk baseline + sdk-cache + sdk-tools) |
| 4 | 2026-06-08 | Phase 10 / T10.1 + Phase 8 / T8.1 | DONE — commits `fb5cb96` (bundle gate) + `2b3ad4e` (codemod); 6+8 = 14 new tests GREEN; cumulative 179 tests |
| 5 | 2026-06-08 | Phase 9 / T9.1 | DONE — commit `0addd94`; 11/11 docs tests GREEN; cumulative 190 tests across 4 packages |
