# Edge Case Review — m3-websearch-adapter (PLAN cycle)

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m3-websearch-adapter-plan.md
Tasks analyzed: 2 (T1.1 adapter, T2.1 export/docs)
Edge cases found: 2 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 1)

## Boundary map
The adapter does I/O via an injectable fetch. Live edge family: response parsing (empty/odd JSON, partial fields) + HTTP error propagation + env key resolution. Fully testable with a stub fetch (no network).

## MUST FIX
(none — empty-safe mapping + fail-fast + injected-fetch are ADR D2/D3/D4 + T1.1 TDD.)

## SHOULD TEST

### EC-1: res.json() that rejects (malformed body) must surface as search_failed, not an unhandled rejection
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** a 200 response with a non-JSON body → `await res.json()` rejects. The callback must let it propagate (so `createWebSearchTool` maps it to `search_failed`), not swallow it into a bad result.
- **Suggested test:** `test_malformed_json_body_throws` — stub `res.ok=true` but `res.json()` rejects → callback rejects (the tool then returns search_failed).

## DOCUMENT

### EC-2: empty query string
- **Accepted risk:** an empty `query` is passed through to Brave as `q=` (Brave returns no/odd results → mapped to []). Not the adapter's job to validate query content; the tool's input schema requires a query. Documented.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 2 | 0 | EC-1 | EC-2 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (1 SHOULD TEST — malformed-json-body throws — fold into T1.1 TDD; no MUST FIX)
