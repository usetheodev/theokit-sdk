# Implementation: M1-3 — `buildReplayHistory` (stateless continuation history)

**Slug:** `m1-continuation-history`
**Date:** 2026-06-20
**Plan:** `knowledge-base/plans/m1-continuation-history-plan.md` (SHIPPABLE 94.8)
**Blueprint:** `knowledge-base/discoveries/blueprints/m1-continuation-history-blueprint.md` (SHIPPABLE 99.7)
**Promise:** IMPLEMENTATION_COMPLETE

## What shipped

Pure, sync, dependency-free `buildReplayHistory(base, events, options): StoredMessage[]` — the stateless complement to M1 Phase 3's `runToCompletion`. Serializes a round's `SDKMessage[]` into a bounded `StoredMessage[]` replay history a server/serverless handler can re-send into a fresh agent.

## Files

| File | Task | Change |
|---|---|---|
| `packages/sdk/src/internal/runtime/context/replay-history.ts` | T1.1 + review | NEW (158 LoC) — `buildReplayHistory` + pure helpers (`charBudget`, `mapEvent`, `cap`, `evictionIndices`, `totalChars`, `trimToBudget`, `finiteOr`, `stringifyPayload`, `assistantText`); `call_id` pairing added in review. |
| `packages/sdk/tests/replay-history.test.ts` | T1.1 + review | NEW — 19 unit tests (9 core + EC-1..EC-6 + 4 review: non-adjacent pair drop, interleaved pairs, lone call, error status, mixed text+tool_use). |
| `packages/sdk/src/index.ts` | T2.1 | barrel export `buildReplayHistory` + `ReplayHistoryOptions`. |
| `packages/sdk/tests/replay-history-wiring.test.ts` | T2.1 | NEW — 2 integration tests through the public barrel. |
| `docs.md` | T2.1 | "Replay history (stateless continuation)" section. |
| `CHANGELOG.md` (root, workspace-level manual changelog) | T2.1 | `[Unreleased] § Added` entry (the package `CHANGELOG.md` is changeset-generated at version time). |
| `packages/sdk/src/types/conversation-storage.ts` | review | `StoredMessage.role` JSDoc reconciled — `tool_call`/`tool_result` now produced by `buildReplayHistory`, not "forward compat reserved". |
| `.changeset/m1-continuation-history.md` | T2.1 | minor changeset. |

## Design (blueprint ADRs D1-D5 + edge-case EC-1..EC-7)

- **D1** input `SDKMessage[]` → output `StoredMessage[]` (SDK-native types, Rule 9).
- **D2** role mapping: assistant text → `assistant`; tool `running` → `tool_call` (args); tool `completed`/`error` → `tool_result` (result content); non-replayable events skipped; double-emission collapsed by status.
- **D3** trim: drop-oldest + keep ≥1 + tool-pair safety (`tool_call`+`tool_result` dropped together, never orphaned); oversized single turn truncated via reused `truncateWithMarker`.
- **D4** pure return, no mutation, no runtime processor.
- **D5** budget `(window - reserve) * 4`, sync, no tokenizer dep.
- **EC-1** non-finite `contextWindowTokens` → budget 0 (never unbounded). **EC-6** `perItemCap` guarded ≥ 0. **EC-7** base not per-item truncated (documented).

## Wiring triad

- **(a) Caller** — public barrel export `@theokit/sdk` → `buildReplayHistory` (consumer-facing primitive, M0-style public-primitive exception per `no-stubs-no-mocks-no-wired.md`).
- **(b) Integration test** — `replay-history-wiring.test.ts` drives it through the public barrel on a realistic event stream (assistant + tool pair), crossing the boundary the unit test bypasses.
- **(c) Runtime metric** — N/A (pure function; consistent with M0 pure primitives `withRetry`/`mapWithConcurrency`).

## Review round (cycle-review, 5 specialist agents)

Verdicts: 4 READY, 1 NEEDS_FIXES (2 HIGH). All confirmed findings fixed:

| Finding | Sev | Resolution |
|---|---|---|
| Tool-pair safety was POSITIONAL (`dropCountAt0` assumed call/result adjacent) → orphaned `tool_result` on interleaved/non-adjacent calls | MEDIUM×2 (correctness) | Re-paired by `call_id`: `mapEvent` attaches `pairId`; `evictionIndices` drops a turn + all turns sharing its `call_id` together — robust to interleaving. |
| `test_never_splits_tool_call_from_tool_result` was VACUOUS (budget 0 → all content `""` → trim loop never ran) | HIGH | Replaced with a real-drop, NON-ADJACENT pair test that enters the loop + a multiple-interleaved-pairs test. |
| `error` status tool branch untested | HIGH | Added `test_tool_error_status_maps_to_tool_result`. |
| lone tool_call / mixed text+tool_use untested | MEDIUM | Added `test_lone_tool_call_survives_and_is_not_paired` + `test_assistant_mixed_text_and_tool_use_maps_text_only`. |
| docs budget-0 wording imprecise ("keep ≥1 newest") | MEDIUM (DX) | Reworded to "trimmed toward effectively-empty working memory". |
| `StoredMessage` JSDoc said tool roles "forward compat reserved" but the fn emits them; mapping requirement under-weighted | MEDIUM (DX) | JSDoc reconciled + promoted an **Important** tool-role-mapping note in docs.md. |
| impl summary claimed package CHANGELOG; entry is in root | INFO | Clarified (root is the manual workspace changelog; package CHANGELOG is changeset-generated). |

## Gates

- Unit + wiring: 21/21 GREEN (19 unit + 2 wiring).
- Full SDK suite: 370 files / 2706 tests passed, 0 failed (19/35 skips are Ollama/env-gated).
- `tsc --noEmit`: clean.
- Biome (cognitive-complexity ≤ 10): clean — core decomposed into small helpers.
- knip (dead-code): clean — public export not flagged as orphan.
- LoC: `replay-history.ts` 158 (≤ 500 budget; slightly over the 150 target after call_id pairing — acceptable, single cohesive module, 500 budget).

## Commits (develop)

- `54a9f72` feat(sdk): buildReplayHistory pure core (T1.1)
- `d7d5215` feat(sdk): export buildReplayHistory + docs + changeset (T2.1)
