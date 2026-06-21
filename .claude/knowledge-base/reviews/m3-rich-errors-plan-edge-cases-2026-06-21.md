# Edge Case Review — m3-rich-errors (PLAN cycle)

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m3-rich-errors-plan.md
Tasks analyzed: 2 (T1.1 wrapper, T2.1 export/docs)
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 2)

## Boundary map
`injectGuidance` is a pure string transform. Live edge family: JSON parse correctness (non-JSON, JSON-array, JSON-null, ok:true, missing error) + idempotency (existing guidance).

## MUST FIX
(none — never-throw passthrough is ADR D3 + T1.1 TDD; additive/idempotent tested.)

## SHOULD TEST

### EC-1: parsed JSON that is valid but NOT an object (array / number / null)
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** `JSON.parse("[1,2]")` / `JSON.parse("null")` / `JSON.parse("5")` succeed but are not `{ok:false}` objects. The `isObject(parsed) && parsed.ok===false` guard must reject them (return unchanged), not crash on `parsed.ok`.
- **Suggested test:** `test_inject_non_object_json_passthrough` — `injectGuidance("[1,2]", MAP)` and `injectGuidance("null", MAP)` → returned unchanged.

## DOCUMENT

### EC-2: handler returns a promise — wrapper must await
- **Accepted risk:** `tool.handler` may be sync or async; the wrapper awaits it before injecting. Covered by the async wrapper signature. Documented.

### EC-3: guidance text is advisory, not enforced
- **Accepted risk:** the model may ignore the hint; the `error` code stays authoritative. Documented.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 3 | 0 | EC-1 | EC-2, EC-3 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (1 SHOULD TEST — non-object-JSON passthrough — fold into T1.1 TDD; no MUST FIX)
