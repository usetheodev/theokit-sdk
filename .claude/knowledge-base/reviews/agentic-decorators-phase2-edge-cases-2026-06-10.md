# Edge Case Review — agentic-decorators-phase2

Date: 2026-06-10
Tasks analyzed: 10 (T1.1, T2.1-T2.9)
Edge cases found: 2 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 1)

## SHOULD TEST

### EC-1: @Cron with invalid cron expression stored without validation
- **Affected task:** T2.4
- **Suggested test:** `test_cron_stores_invalid_expression_as_is()` — verify `@Cron({schedule: "not-a-cron"})` stores the string without error. Decorator is metadata-only; validation happens at runtime when `croner` parses the expression. Verify the decorator does NOT throw at decoration time.

## DOCUMENT

### EC-2: All 9 decorators inherit EC-1 from Phase 1 (reflect-metadata side-effect import)
- **Accepted risk:** The plan's ADR D1 states "each decorator starts with `import 'reflect-metadata'`" — this is the Phase 1 EC-1 fix applied uniformly. No new edge case; just confirming the pattern carries forward. Already tested in Phase 1.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 0 | 0 | 0 | 0 |
| T2.4 | 1 | 0 | 1 (EC-1) | 0 |
| T2.5 | 0 | 0 | 0 | 0 |
| T2.6 | 0 | 0 | 0 | 0 |
| T2.7 | 0 | 0 | 0 | 0 |
| T2.8 | 0 | 0 | 0 | 0 |
| T2.9 | 0 | 0 | 0 | 0 |
| All  | 1 | 0 | 0 | 1 (EC-2) |

**Verdict:** PLAN OK — zero MUST FIX. The pattern is proven by Phase 1 (4 decorators, 35 tests, real LLM validation). Phase 2 is mechanical replication.
