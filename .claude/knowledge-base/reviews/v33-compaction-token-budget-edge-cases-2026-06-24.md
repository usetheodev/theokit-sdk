# Edge Case Review — v33-compaction-token-budget

Date: 2026-06-24
Tasks analyzed: 6 (T1.1, T2.1, T2.2, T3.1, T3.2, T4.1/T4.2)
Edge cases found: 7 (MUST FIX: 0, SHOULD TEST: 5, DOCUMENT: 2)

The plan is for pure, single-threaded functions over an in-memory transcript; the only boundary is the caller-injected `summarize` callback (covered by D4 fail-safe). No I/O, no persistence, no concurrency in the SDK code itself. Edge cases live at the option-combination + degenerate-input boundaries.

## MUST FIX

(none — the plan already carries backward-compat regression tests, the D6 system-handling decision, and the D4 propagate-default contract. No unhandled crash / data-loss / security hole was found.)

## SHOULD TEST

### EC-1: `keepTokens` and `keepRecent` both provided
- **Affected task:** T1.1
- **Family:** Input
- **Suggested test:** `test_compactTranscript_keepTokens_wins_over_keepRecent` — when both options are set, the token-budget path is taken and `keepRecent` is ignored (ADR D1 declares them mutually exclusive; pin it so the precedence can't silently flip).

### EC-2: `keepTokens = 0` (and negative)
- **Affected task:** T1.1
- **Family:** Boundary
- **Suggested test:** `test_selectByTokenBudget_zero_keepTokens_keeps_one_recent` — `keepTokens: 0` keeps exactly 1 recent turn (the `i < length-1` guard), head = the rest; never throws, never empty recent (Q3). A negative value behaves identically.

### EC-3: empty `marker` string
- **Affected task:** T2.1
- **Family:** Input
- **Suggested test:** `test_buildCheckpoint_rejects_empty_marker` (or guard) — an empty `marker` makes `startsWith("")` match every turn, so in keepRecent mode every `system` turn would be treated as a checkpoint and silently dropped. Add a 1-line guard: `if (marker === "") throw new TheokitAgentError(... "marker must be non-empty")` OR document the precondition and assert the throw. Cheapest correct fix: guard in `buildCheckpoint`/`compactTranscript`.

### EC-4: `summarize` throws a non-`Error` value under `failSafe`
- **Affected task:** T3.2
- **Family:** Format
- **Suggested test:** `test_compactTranscript_failSafe_handles_non_error_throw` — when `summarize` rejects with a string/object and `failSafe:true`, the warn uses `err instanceof Error ? err.message : String(err)` (mirror theocode `:146`) and the original is returned. Pins the breadcrumb formatting.

### EC-5: token-budget mode must not mutate input
- **Affected task:** T1.1
- **Family:** State
- **Suggested test:** `test_compactTranscript_token_budget_does_not_mutate_input` — mirror the existing keepRecent mutation guard for the new branch (slice/spread only; input array + elements unchanged).

## DOCUMENT

### EC-6: `startsWith` vs theocode's `includes` for marker detection
- **Accepted risk:** ADR D5 deliberately uses `startsWith(marker)` (M2 semantics) instead of theocode's `.includes` (`theocode/.../compaction.ts:98`). This is STRICTER (a user message that merely contains the marker text mid-content is NOT a false checkpoint). Parity holds because theocode's `buildCheckpoint` places the marker at content start (`startsWith` finds it) — the corpus test `compaction.test.ts:85-99` builds checkpoints at the start. Documented divergence: the SDK is safer; if theocode ever embedded a marker mid-content it would diverge, but that never happens in its codebase.

### EC-7: parity is behavioral, not signature-identical
- **Accepted risk:** Already Q1 in the plan. theocode's `summarize` returns a `string`; the SDK's returns a `CompressibleMessage`. The parity suite (T4.1) asserts BEHAVIOR (split points, marker, template, fail-safe, filter), not signature identity. theocode adopts via a thin callback adapter — out of THIS slice's scope (theocode-side follow-up).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 3 | 0 | 3 (EC-1, EC-2, EC-5) | 0 |
| T2.1 | 1 | 0 | 1 (EC-3) | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 1 | 0 | 1 (EC-4) | 0 |
| T4.1 | 2 | 0 | 0 | 2 (EC-6, EC-7) |

**Verdict:** PLAN OK

The plan is well-scoped and backward-compat-disciplined. The 5 SHOULD TEST items are cheap additions to existing task TDD sections (no new modules, no structural change). EC-3 (empty marker) is the most valuable — a 1-line guard turns a silent-data-loss footgun into an explicit typed error. The 2 DOCUMENT items record deliberate, parity-safe divergences. No MUST FIX; the plan may proceed to `/deps-audit` → `/plan-confidence` after the SHOULD TEST items are absorbed into v1.1.
