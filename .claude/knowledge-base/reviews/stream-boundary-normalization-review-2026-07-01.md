# Review — stream-boundary-normalization (R7)

Date: 2026-07-01 · Cycle: REVIEW (cycle-review.md) · Branch: `develop`
Subject diff: `6336f81^..78076fe` (packages/) — T1.1 `6336f81`, T2.1 `78076fe`, + review-round fixes `3d089a6`.
Reviewers: 4 independent specialist agents (correctness, architecture+hot-path, test-quality, wiring+cross-validation).

**Verdict:** READY_TO_MERGE

## Severity matrix (post-fix)

| # | Severity (as filed) | Finding | Disposition |
|---|---|---|---|
| F1 | **MEDIUM** (correctness, wiring) | prose + `<function=` marker in ONE content delta → the raw dialect was streamed as `text_delta` (the FSM only recognized a marker at the buffer's trim-start), defeating R7's core guarantee for batched-delta providers (its target population). | **FIXED** — `firstPossibleMarkerStart` (pure) finds the first `<` whose suffix could still be a tool call; `applyContentDelta` flushes the prose prefix and holds only that suffix. `test_accumulator_prose_then_marker_in_one_delta_flushes_prefix_only` + 2 unit tests. |
| F2 | **MEDIUM** (correctness, arch, wiring) | held text was SILENTLY DROPPED if the stream ended without a `finish_reason` terminal chunk (truncation / non-conformant proxy) — a fail-loud violation (content vanishes). | **FIXED** — `stream()` now calls `accumulator.finalizeHeldText()` AFTER the SSE loop (idempotent) so held text is drained even without a terminal chunk. `test_accumulator_drains_held_when_no_finish_reason_chunk`. |
| F3 | **MEDIUM** (test, arch) | native `tool_calls` + a held leaked block diverged: the terminal flush stripped the block unconditionally, but `finish()` only strips when `toolCalls.length === 0` → streamed `""` while `finish.text` kept the raw dialect. | **FIXED** — `finalizeHeldText` now checks `this.toolCalls.size`; when native calls exist it streams the held text WHOLE (mirroring `finish()`'s size-guard), so `accumulatedText == finish.text`. `test_accumulator_native_wins_streamed_text_equals_finish_text`. |
| F4 | **MEDIUM** (wiring) | the plan's own Final-Phase AC mandated a never-closing fail-open test that was missing. | **FIXED** — `test_accumulator_never_closing_marker_fails_open_to_text` (a `<function=shell_exec>…` with no `</tool_call>` flushes as visible text, 0 recovered). |
| F5 | **MEDIUM** (test) | FSM complete-name exact-vs-prefix boundary untested (`read` vs declared `read_file`) — a regression to prefix matching would pass the suite. | **FIXED** — `test_state_impossible_for_complete_name_prefix_of_allowed`. |
| F6 | **LOW** (test) | FSM `"building"` (bare `<function=`) + `"invalid"` (`<function=>`) branches + held-then-recovered weak assertion. | **FIXED** — `test_state_possible_for_bare_marker_no_name`, `test_state_impossible_for_empty_name_closed`, `test_accumulator_held_then_recovered_emits_zero_text_delta`. |
| F7 | **LOW** (arch) | docs.md not updated for the streaming-suppression behavior change of the documented `extractToolCallsFromContent` flag. | **FIXED** — docs.md:2967 documents the stream-boundary hold + fail-open. |
| — | LOW/INFO (accepted) | `openai.ts` +44 net lines vs the plan's ≤30 AC — the `applyChoice` extraction was required by the cognitive-complexity gate (honestly disclosed; still under the 500 file budget). Trim asymmetry (`accumulatedText` has a trailing space `finish.text` trims) — cosmetic; the consumer uses `accumulatedText`. Observability of the hold action (no per-hold log) — the R5 recover/drop stderr logs still fire; a per-hold log deferred (transparent by design). | No blocker; documented. |

## Confirmed-correct (independent verification)

- **Reconciliation** — the correctness agent proved `accumulatedText == finish.text` for the covered cases and (with the F1/F2/F3 fixes) the divergence paths; the loop derives the final text from `accumulatedText` (`loop-llm-stream.ts:109`), so holding deltas alone yields a clean live view AND final text.
- **Case-sensitivity (EC-1)** — marker match is case-sensitive, agreeing with `HERMES_BLOCK`; `<Function=read>` → "impossible" (verified by probe).
- **Hot path** — for normal prose the buffer is "impossible" immediately and resets each delta; no unbounded growth, no O(n²) on the hot path; the FSM is not called when the flag is off.
- **DIP** — the FSM (`streamToolCallBufferState`, `firstPossibleMarkerStart`) is pure/request-blind in `hermes-tool-extract.ts`; the stateful buffer lives in the accumulator; the allowlist is the R5 Set.
- **Wiring triad** — (a) caller `client.stream() → accumulator → applyChoice → applyContentDelta → streamToolCallBufferState` + terminal/post-loop `finalizeHeldText`; (b) golden `test_flag_on_leaked_call_is_not_streamed_as_text` + 13 accumulator tests; (c) R5 recover/drop stderr logs (holding transparent).
- **Plan fidelity** — every task/ADR/coverage-row/edge-case maps to committed code + tests; no scope creep; no public API change (`docs.md` behavior-only); no new dependency.
- **Gates** — knip clean, depcruise clean, typecheck + biome clean, `pnpm validate` green.

## Hard gates (cycle-review.md)

- No failing tests on the branch · No secrets · On `develop` · No Co-Authored-By trailer · CHANGELOG updated. All PASS.

## Outcome

No BLOCKER and no HIGH. All 5 MEDIUM (mixed-delta suppression, silent-drop fail-loud, native divergence, missing fail-open test, exact-vs-prefix test) + LOWs are FIXED; remaining items accepted with rationale. **READY_TO_MERGE.**
