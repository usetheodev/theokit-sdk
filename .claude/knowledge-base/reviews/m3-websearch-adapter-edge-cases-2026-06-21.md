# Discover Edge Case Review — m3-websearch-adapter

Date: 2026-06-21
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/m3-websearch-adapter-plan.md
Research questions analyzed: 5
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 2)

## MUST FIX
(none — all cited paths verified; 4 corners mapped; provider-agnostic + fail-fast + injectable-fetch are explicit gates.)

## SHOULD TEST

### EC-1: Brave response with a missing/empty `web.results` must map to [] (not throw)
- **Affected question:** Q4
- **Suggested halt-loop checkpoint:** before promising Q4 complete, assert the blueprint states the mapping reads `json.web?.results ?? []` (a query with zero results, or a response without a `web` key, yields an empty `WebSearchResult[]` — NOT a throw). A naive `json.web.results.map` would throw on an empty/odd response.

## DOCUMENT

### EC-2: per-result fields may be partial — coerce to strings
- **Accepted risk:** a Brave result lacking `description` (or `title`) maps `snippet`/`title` to `""` (coerce undefined → ""), so `WebSearchResult` always has the three string fields. Documented.

### EC-3: maxResults is honored by the tool, but the adapter SHOULD pass `count` to the API
- **Accepted risk:** `createWebSearchTool` already slices to `maxResults`; the adapter passes `count = maxResults` to Brave to avoid over-fetching, but the tool's slice is the final authority. Documented (no double-bounding bug — the tool slice is idempotent).

## Summary

| Question | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------|----------|-------------|----------|
| Q4 | 2 | 0 | EC-1 | EC-3 |
| Q5 | 1 | 0 | 0 | EC-2 |

**Verdict:** DISCOVERY PLAN OK (1 SHOULD TEST — empty-results maps to [] — elevated to a blueprint must-state; 2 DOCUMENT; no MUST FIX)
