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
| `packages/sdk/src/internal/runtime/context/replay-history.ts` | T1.1 | NEW (135 LoC) — `buildReplayHistory` + pure helpers (`charBudget`, `mapEvent`, `cap`, `dropCountAt0`, `trimToBudget`, `finiteOr`, `stringifyPayload`, `assistantText`). |
| `packages/sdk/tests/replay-history.test.ts` | T1.1 | NEW — 15 unit tests (9 core + EC-1..EC-6). |
| `packages/sdk/src/index.ts` | T2.1 | barrel export `buildReplayHistory` + `ReplayHistoryOptions`. |
| `packages/sdk/tests/replay-history-wiring.test.ts` | T2.1 | NEW — 2 integration tests through the public barrel. |
| `docs.md` | T2.1 | "Replay history (stateless continuation)" section. |
| `CHANGELOG.md` (root) | T2.1 | `[Unreleased] § Added` entry. |
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

## Gates

- Unit + wiring: 17/17 GREEN (15 + 2).
- Full SDK suite: 370 files / 2702 tests passed, 0 failed (19/35 skips are Ollama/env-gated).
- `tsc --noEmit`: clean.
- Biome (cognitive-complexity ≤ 10): clean — core decomposed into small helpers.
- knip (dead-code): clean — public export not flagged as orphan.
- LoC: `replay-history.ts` 135 (≤ 150 target, 500 budget).

## Commits (develop)

- `54a9f72` feat(sdk): buildReplayHistory pure core (T1.1)
- `d7d5215` feat(sdk): export buildReplayHistory + docs + changeset (T2.1)
