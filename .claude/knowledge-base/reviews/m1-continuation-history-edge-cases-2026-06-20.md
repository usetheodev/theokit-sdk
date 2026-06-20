# Edge Case Review — m1-continuation-history

Date: 2026-06-20
Tasks analyzed: 2 (T1.1 pure core, T2.1 export/wiring)
Edge cases found: 7 (MUST FIX: 1, SHOULD TEST: 5, DOCUMENT: 1)

## MUST FIX

### EC-1: Non-finite `contextWindowTokens` silently defeats the bounding guarantee
- **Affected task:** T1.1
- **Family:** Input
- **Scenario:** Caller passes `NaN`/`Infinity`/`undefined`-coerced `contextWindowTokens` (e.g. read from an unset env or a model catalog miss). `budgetChars = max(0, NaN - 8000) * 4 = NaN`. The trim loop condition `total > NaN` is always `false`, so NOTHING is trimmed.
- **Impact:** the primitive returns an UNBOUNDED history — the exact failure it exists to prevent (silent context overflow downstream). Worse than throwing: the caller believes it is bounded.
- **Suggested fix:** in the budget helper, guard `Number.isFinite(contextWindowTokens)` (and `reserveTokens`); treat a non-finite window as budget `0` (keep ≥1 newest, truncated). One line: `const w = Number.isFinite(contextWindowTokens) ? contextWindowTokens : 0;`

## SHOULD TEST

### EC-2: Empty base AND empty events
- **Affected task:** T1.1
- **Suggested test:** `test_returns_empty_when_base_and_events_empty()` — assert `buildReplayHistory([], [], opts)` returns `[]` (the keep≥1 floor must not fabricate an element when there is nothing to keep).

### EC-3: Assistant event with no text (only tool_use blocks)
- **Affected task:** T1.1
- **Suggested test:** `test_skips_assistant_event_with_no_text_blocks()` — an `SDKAssistantMessage` whose content is only `ToolUseBlock`s produces NO assistant `StoredMessage` (the tool events carry it; D2 "if text blocks non-empty").

### EC-4: Tool `completed`/`error` event with `undefined` result
- **Affected task:** T1.1
- **Suggested test:** `test_tool_result_with_undefined_result_yields_empty_content_not_string_undefined()` — assert content is `"[tool_result <name>] "` (empty), never the literal `"undefined"`.

### EC-5: Orphan `tool_result` at the merged-array boundary (its `tool_call` is in `base` or already trimmed)
- **Affected task:** T1.1
- **Suggested test:** `test_drops_orphan_tool_result_without_crashing()` — a `tool_result` with no preceding `tool_call` in the array is dropped alone (pair-safety logic must not index out of bounds or throw).

### EC-6: Explicit `perItemCap: 0` (or negative) from the caller
- **Affected task:** T1.1
- **Suggested test:** `test_perItemCap_zero_truncates_to_empty_marker_safely()` — guard `perItemCap = max(0, opts.perItemCap ?? default)` so `truncateWithMarker(content, negative)` (which would `slice(0, negative)` and keep a weird tail) is never reached.

## DOCUMENT

### EC-7: A single oversized `base` message can exceed the budget (keep≥1 floor)
- **Affected task:** T1.1
- **Accepted risk:** per-item truncation (D3) applies to EVENT-derived turns, not to `base` (caller-owned durable history). If the caller passes a single `base` message larger than `budgetChars`, the keep≥1 floor returns it un-truncated, exceeding budget. This mirrors theocode (which truncates only tool_results). Documented as a caller responsibility in `docs.md`; not fixed because truncating caller-owned durable content would silently corrupt it.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 7 | 1 | 5 | 1 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX — guard non-finite context window; 5 SHOULD TEST to fold into T1.1 TDD)
