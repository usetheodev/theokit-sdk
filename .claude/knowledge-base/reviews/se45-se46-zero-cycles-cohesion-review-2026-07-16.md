# Review: SE45 (zero-import-cycles) + SE46 (internal/ structural cohesion)

**Date:** 2026-07-16
**Diff range:** `a2e97546..HEAD` (`packages/sdk/src` structural refactor)
**Reviewers (spawned agents):** 3 parallel — architecture/DIP, wiring/dead-code, cross-validation (public-API + behavior preservation)
**Findings:** 2 total (BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 1 [fixed], INFO: 1)
**Verdict:** READY_TO_MERGE

## Scope

Behavior-preserving structural refactor delivering two roadmap milestones:

- **SE45** — eliminate 3 madge import cycles (3→0), tighten `quality:cycles` gate 3→0, close #129.
  - Cycle 1: `ToolResultGuardOptions` → `types/run.ts` (re-export from internal).
  - Cycle 2: `SDKAgent` cluster → `types/sdk-agent.ts` leaf (decomposed 975-LoC `types/agent.ts` god-file).
  - Cycle 3: `a2a/subagent.ts` → `getAgentFacade()` DIP seam (replaced dynamic `import("../agent.js")`).
- **SE46** — internal/ structural cohesion:
  - Budget one-home: `internal/runtime/budget/` → `internal/budget/tracker/`.
  - Telemetry one-home: `internal/observability/tracer-loader.ts` → `internal/telemetry/` (empty `observability/` removed).
  - 2 loose files relocated: `fixture-mode.ts` → `runtime/fixtures/`, `default-retriable.ts` → `runtime/retry/`.
  - Dead-code removal: orphaned `internal/cache-discipline-guard.ts` (#131).
  - DIP direction restored for 4/5 contract types (`EnvPolicy`, `BudgetTracker`, `SessionRecord`, `MemoryProvider`) relocated to `types/` with internal re-export; `Plugin` deliberately deferred (runtime const+type merge embedding `ProviderProfile` — moving it would relocate not remove the violation).

## Findings

### LOW (fixed in this review)
- **F-1 — stale doc-comment path.** `tests/agent-loop-budget-gate.test.ts:5` referenced the old `internal/runtime/budget-tracker.ts` path in a JSDoc comment (the actual import was already correct). Fixed to point at the new authoritative home `types/budget-tracker.ts` (commit `d8f13726`).

### INFO
- **F-2 — stale coverage artifacts.** `packages/sdk/coverage/**/cache-discipline-guard.ts.html` are stale HTML for the deleted file; regenerated on next coverage run. Not source. No action.

## Evidence per lens

### Architecture / DIP — no BLOCKER/HIGH
- All 4 DIP relocations are genuine move+re-export (single definition per type, verified by grep) — no duplication, no drift risk.
- No NEW `types/→internal/` coupling introduced; only the documented deferred `Plugin` remains.
- `getAgentFacade()` seam is real (registered at `agent.ts` module-init via `setAgentFacade`), guarded by a dependency-cruiser rule; not a workaround.
- Budget/telemetry co-locations are clean moves — old dirs gone, zero stale-path imports, no orphaned shims.

### Wiring / dead-code — no BLOCKER/HIGH
- `cache-discipline-guard` symbols have ZERO remaining references anywhere (src/tests/examples); removal is safe (typecheck exit 0 proves no dangling import).
- Every new/moved file has ≥1 real importer (no orphans).
- No `not_implemented`/`TODO`/`Mock`/`Stub` introduced in changed src.
- Tests reference the NEW paths (no stale `runtime/budget/`, `observability/tracer-loader`, `../agent.js` mock paths).

### Cross-validation (public API + behavior) — claim TRUE
- **Public API byte-stable:** `index.ts` 147 exported names before = 147 after (zero diff); all sub-path barrels identical; `package.json` `exports` unchanged.
- **Behavior preserved:** 6 relocated runtime files are byte-identical (sha256 R100 moves); type-extraction splits are clean 1:1 name moves with verbatim bodies; the single genuine change (a2a DIP-seam) is a proven thin pass-through (`create: (o) => Agent.create(o)`), 49 subagent-delegation tests pass.
- **docs.md** correctly needs no change (no public sub-path moved user-visibly).
- **CHANGELOG** `[Unreleased]` covers SE45 + SE46 (Unbreakable Rule 6).
- **No secrets** in the diff.

## Quality gates (empirical)

- `pnpm -w run validate` → **exit 0** (full workspace).
- `node tools/check-cycles.mjs` → **madge 0 cycles**, gate ≤0 passes.
- Test suite: `@theokit/sdk` 3501 passed / 39 skipped; sdk-tools 433, sdk-memory 342, sdk-cache 65, cli 107, peer-integration 13, memory-honcho 17 — all green.
- depcruise: no dependency violations (470 modules).
- G8 LoC: 457 files ≤ 400 LoC. publint: All good. bundle-budget: 5/5 PASS.
- Independent post-refactor architecture re-audit: **96/100 ("Keep")**, up from 78/100 baseline.

## Handoff decision

**READY_TO_MERGE.** Zero BLOCKER/HIGH across all three lenses; the one LOW is fixed; public API is byte-stable and behavior is preserved with empirical proof. Proceed to `cycle-release`.
