# Cross-Validation Findings — m1-sdkmessage-readers

**Verdict:** Plan and implementation match faithfully. Both tasks (T1.1, T2.1) fully implemented, all Acceptance Criteria and DoD satisfied, all 4 ADRs (D1-D4) honored, all 6 Coverage-Matrix gaps delivered, Global DoD true against repo state, no plan drift. No BLOCKER/HIGH/MEDIUM findings. Two INFO notes below.

---

## Task-by-task audit

### T1.1 — `assistantText` + `extractToolUses` + `costAmountUsd`
- Commit: `69763c7` "feat(sdk): SDKMessage readers ... (M1-5 T1.1)"
- Declared files vs changed: `src/messages.ts` (NEW) + `tests/messages-readers.test.ts` (NEW) — both present, no undeclared production files touched. GOOD.
- Acceptance Criteria:
  - Unit tests pass — 13 tests green (plan said 12; superset, see INFO-1). SATISFIED.
  - `test_costAmountUsd_preserves_undefined_never_zero` — present & green. SATISFIED.
  - `test_assistantText_ignores_tool_use_blocks` — present & green. SATISFIED.
  - `grep -c "?? 0" src/messages.ts` == 0 — verified 0. SATISFIED.
  - biome clean on src/messages.ts — verified (3 files, no fixes). SATISFIED.
  - `wc -l src/messages.ts` ≤ 80 — 52 lines. SATISFIED.
- DoD: vitest green, typecheck exit 0, biome clean — all re-verified. SATISFIED.

### T2.1 — Wire subpath + integration test + docs + changeset
- Commit: `a21949f` "feat(sdk): wire @theokit/sdk/messages subpath + docs (M1-5 T2.1)"
- Declared files vs changed: package.json, tsup.config.ts, tsconfig.tools-dts.json, scripts/mirror-dts-to-cts.mjs, tests/messages-readers-wiring.test.ts (NEW), docs.md, packages/sdk/CHANGELOG.md, .changeset/m1-sdkmessage-readers.md — ALL present in the diff, all additive, no scope creep. GOOD.
- Acceptance Criteria:
  - wiring test 2/2 — green. SATISFIED.
  - package.json exports['./messages'] oracle — node exit 0. SATISFIED.
  - tsup `messages` entry + tsconfig include grep ≥ 1 — both present. SATISFIED.
  - mirror messages.d.ts grep ≥ 1 — present. SATISFIED.
  - docs.md `@theokit/sdk/messages` (3 hits) + changeset exists + CHANGELOG assistantText (1) — all SATISFIED.
  - biome clean — SATISFIED.
- DoD: wiring test green, typecheck 0, build succeeds (dist/messages.{js,cjs,d.ts,d.cts} all emitted), docs+changeset+CHANGELOG present. SATISFIED.

---

## ADR compliance (4/4 respected)

- **D1** signatures — `assistantText(msg: SDKMessage): string`, `extractToolUses(msg: SDKMessage): ToolUseBlock[]`, `costAmountUsd(cost: CostBreakdown | undefined): number | undefined`. Pure free functions in src/messages.ts. EXACT MATCH (messages.ts:20,37,50).
- **D2** discriminated `block.type` filter — `block.type === "text"` / `block.type === "tool_use"` over `msg.message.content`; reads assistant content NOT the `tool_call` lifecycle event. Verified messages.ts:24-25,41. Extra test `test_extractToolUses_empty_for_tool_call_lifecycle_message` explicitly locks the boundary. RESPECTED.
- **D3** `costAmountUsd` returns `cost?.amountUsd` with NO `?? 0` — verified messages.ts:51; `grep -c "?? 0"` == 0. RESPECTED.
- **D4** subpath on tsc-DTS path like path-safety, zero new deps — `./messages` exports block is byte-for-byte structurally identical to `./path-safety`; tsup entry + tsconfig.tools-dts include + cts mirror all wired; `dependencies` block unchanged (croner only — the devDep additions in main..HEAD come from prior milestones, not these two commits). RESPECTED.

---

## Coverage Matrix (6/6 delivered)

1. assistantText (M1-5) → T1.1 — delivered.
2. extractToolUses → T1.1 — delivered.
3. honest cost reader → T1.1 — delivered (D3).
4. ./messages subpath → T2.1 — delivered (D4).
5. zero new deps → verified (dependencies unchanged).
6. document+record+prove public surface → T2.1 — docs.md + changeset + CHANGELOG + 2-test integration. delivered.

---

## Global DoD (true against repo state)

- Reader tests green (15/15 across both files). PASS.
- Full SDK suite — 373 files / 2735 tests passed, 0 failed, 35 skipped. NO REGRESSION.
- typecheck exit 0. PASS.
- biome clean. PASS.
- knip (`pnpm quality:dead`) exit 0, no `messages` orphan. PASS.
- build clean; dist/messages.d.ts + dist/messages.d.cts both exist. PASS.
- file-size budget (≤ 500, target ≤ 80) — 52 lines. PASS.
- CHANGELOG `[Unreleased]` + changeset present. PASS.
- backward compat (additive subpath only). PASS.
- docs.md reflects new surface (section at docs.md:1840). PASS.
- plan-specific honesty (never `?? 0`; extractToolUses assistant blocks only; readers pure). PASS.

---

## Plan drift

NONE. Plan committed at `8b0b766` (15:24); last touched by that commit only. Implementation commits T1.1 (15:32) + T2.1 (15:39) are strictly AFTER. Plan frozen since /implement start — review is reliable.

---

## [INFO] Test count exceeds the plan's enumeration (superset, not a gap)
- file: packages/sdk/tests/messages-readers.test.ts
- detail: Plan AC declares "12/12" unit + "2/2" wiring = "14/14" final. Actual is 13 unit + 2 wiring = 15. The extra test is `test_extractToolUses_empty_for_tool_call_lifecycle_message` (messages.ts:93-105), which strengthens the D2 boundary (lifecycle `tool_call` event is a separate stream). This is a superset of the planned coverage — additive hardening, not divergence. The "12/12" oracle in the AC prose is now numerically stale.
- fix: None required. Optionally update the plan AC prose to "13/13 unit / 15 total" for numerical accuracy, but the spirit of the criterion (all enumerated RED tests present + green) is exceeded.

## [INFO] devDependency additions in main..HEAD are not from this feature
- file: packages/sdk/package.json
- detail: `git diff main..HEAD` on package.json shows added devDeps (@opentelemetry/*, @theokit/sdk-handoff, @theokit/sdk-memory, @types/ws, ws). These were introduced by OTHER milestones already merged onto develop ahead of this feature, NOT by commits 69763c7/a21949f. `git show a21949f -- package.json` confirms the only T2.1 change is the additive `./messages` exports block. D4 "zero new deps" is honored: the runtime `dependencies` block (croner only) is unchanged.
- fix: None — flagged only to document that the diff-level devDep delta is pre-existing baseline, not scope creep by this feature.
