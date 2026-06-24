# Implementation — v33-compaction-token-budget (V3-3)

**Date:** 2026-06-24 · **Branch:** develop · **Plan:** `knowledge-base/plans/v33-compaction-token-budget-plan.md` (v1.1, SHIPPABLE 90.8)

## What shipped

Token-budget mode + configurable marker + template-driven summarizer + opt-in fail-safe on `@theokit/sdk/compaction` — all additive, default-preserving. One file changed (`packages/sdk/src/compaction.ts`, 128 → 288 LoC ≤ 500) + tests + docs + changeset.

## Tasks (TDD RED → GREEN → REFACTOR → WIRING)

| Task | Delta | Tests (new) | Status |
|---|---|---|---|
| T1.1 | `keepTokens` token-budget mode (private `selectByTokenBudget`; no system special-casing, D6) | 8 (token-budget mode block) | committed |
| T2.1 | configurable `marker` (`buildCheckpoint`/`filterFromLatestCheckpoint`/`compactTranscript` + `isSystemPrompt`) + empty-marker guard (EC-3) | 5 (marker block) | committed |
| T2.2 | `filterFromLatestCheckpoint` `include: 'after'\|'from'` (D5) | 2 (include block) | committed |
| T3.1 | export `SUMMARY_TEMPLATE` + `summarize(older, template)` 2nd arg + `summaryTemplate` (D3) | 4 | committed |
| T3.2 | opt-in `failSafe` (catch → warn → original; default propagates, D4) | 4 (incl. non-Error throw EC-4) | committed |
| T4.1 | theocode-corpus parity suite (`compaction-parity.test.ts`) | 7 | committed |
| T4.2 | docs.md + CHANGELOG/changeset + wiring (`SUMMARY_TEMPLATE` on subpath) | 1 (wiring) | committed |

## Wiring triad

- **(a) Caller:** `compactTranscript`/`buildCheckpoint`/`filterFromLatestCheckpoint`/`SUMMARY_TEMPLATE` are public exports on the `@theokit/sdk/compaction` subpath (declared in `package.json` exports); exercised by `compaction.test.ts` + `compaction-parity.test.ts` + `compaction-wiring.test.ts` and documented in `docs.md`. The loop-closure caller is theocode (adopts + deletes `server/lib/compaction.ts`).
- **(b) Integration test:** `compaction-wiring.test.ts` asserts every symbol resolves through the published subpath.
- **(c) Runtime observability:** the `failSafe` `console.warn("[compaction] summarizer failed …")` breadcrumb; pinned by `test_compactTranscript_failSafe_warns_on_throw`.

## Validation

- compaction suites: 61 tests (24 pre-existing M2 + 22 new V3-3 + parity 7 + wiring extended) — all green.
- typecheck exit 0; biome clean (cc ≤ 10); `compaction.ts` 288 LoC.
- Backward compat: every M2 test green unchanged; defaults reproduce M2 (keepRecent=6, `[[theokit:checkpoint]]`, propagate-on-throw).
- Full `pnpm validate` gate: (running) — jscpd 0 clones / knip / publint / attw / bundle budget.

## Notes / honest divergences

- Parity is BEHAVIORAL, not signature-identical (Q1): theocode's `summarize` returns a string; the SDK's returns a `CompressibleMessage`. theocode adopts via a thin callback adapter (theocode-side follow-up, out of this slice).
- `filterFromLatestCheckpoint` uses `startsWith` (M2, stricter) not theocode's `includes` (EC-6) — parity-safe because theocode places markers at content start.
