# Edge Case Review — theocode-phase2-session

Date: 2026-06-11
Tasks analyzed: 8 (T2.1-T2.8)
Edge cases found: 5 (MUST FIX: 1, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: Fork session with large message history can exceed SQLite transaction size
- **Affected task:** T2.2
- **Family:** Resource / State
- **Scenario:** `SessionManager.fork()` copies all messages from the source session into a new session. If the source has 10,000+ messages (long coding session with many tool calls), the INSERT batch inside a single transaction may lock SQLite for seconds and consume significant memory.
- **Impact:** Slow fork operation; potential "database is locked" error if another read happens concurrently.
- **Suggested fix:** Fork in batches of 500 messages within a single transaction. Use `db.transaction(() => { for (batch of chunks(messages, 500)) { insertBatch(batch); } })()` — still atomic but with predictable memory usage.

## SHOULD TEST

### EC-2: Compaction with only system messages (no user/assistant)
- **Affected task:** T2.5
- **Suggested test:** `test_compact_with_only_system_messages()` — a session with 3 system messages and no user/assistant content. `autoSummarize` receives only system messages → should return them unchanged (nothing meaningful to summarize). Verify no crash and no LLM call.

### EC-3: Retry with zero maxAttempts
- **Affected task:** T2.6
- **Suggested test:** `test_retry_zero_max_attempts_throws_immediately()` — `retryWithBackoff(fn, { maxAttempts: 0 })` should throw immediately without calling fn. Guard: `if (maxAttempts <= 0) throw new Error("maxAttempts must be >= 1")`.

### EC-4: RunState transition from error → busy (recovery)
- **Affected task:** T2.7
- **Suggested test:** `test_run_state_can_restart_after_error()` — after `fail(error)` puts state to "error", calling `start()` should transition to "busy" (allowing retry). If not, the session is permanently stuck in error state.

## DOCUMENT

### EC-5: `pnpm-workspace.yaml` must be updated to include `packages/theocode`
- **Accepted risk:** The plan creates a new package at `packages/theocode/` but doesn't mention updating `pnpm-workspace.yaml`. Current workspace config is `packages: ['packages/*', 'examples/*']` — the glob `packages/*` already matches `packages/theocode/`, so NO change needed. Documenting to prevent confusion during implementation.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T2.1 | 1 | 0 | 0 | 1 (EC-5) |
| T2.2 | 1 | 1 (EC-1) | 0 | 0 |
| T2.3 | 0 | 0 | 0 | 0 |
| T2.4 | 0 | 0 | 0 | 0 |
| T2.5 | 1 | 0 | 1 (EC-2) | 0 |
| T2.6 | 1 | 0 | 1 (EC-3) | 0 |
| T2.7 | 1 | 0 | 1 (EC-4) | 0 |
| T2.8 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 1 MUST FIX: fork in batches of 500 to prevent large-session lock/memory issues.
