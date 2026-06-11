# Edge Case Review — theocode-phase4-infra

Date: 2026-06-11
Tasks analyzed: 9 (T4.1-T4.9)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: Job queue job function throws synchronously — unhandled rejection crashes process
- **Affected task:** T4.3
- **Family:** State / Resource
- **Scenario:** `jobQueue.enqueue(fn)` runs `fn()` which throws synchronously (not async). If the queue uses `Promise.resolve().then(fn)` the error is caught, but if it uses `fn()` directly in a try-catch, a synchronous throw in an async context may not be caught.
- **Impact:** Unhandled exception → process crash → all pending jobs lost.
- **Suggested fix:** Wrap every job execution in `Promise.resolve().then(() => fn())` to normalize sync throws into rejected promises, then catch and mark status as "failed".

## SHOULD TEST

### EC-2: Event bus handler throws — should not block other subscribers
- **Affected task:** T4.1
- **Suggested test:** `test_subscriber_error_does_not_block_others()` — subscriber A throws, subscriber B should still receive the event. Wrap each handler call in try-catch.

### EC-3: Image handler with 0-byte file
- **Affected task:** T4.7
- **Suggested test:** `test_image_empty_file_returns_error()` — 0-byte .png file → `{ ok: false, error: "empty_file" }`. Don't attempt base64 encoding of empty content.

## DOCUMENT

### EC-4: ACP bridge is a structural stub — no real ACP server wired in Phase 4
- **Accepted risk:** The ACP bridge creates protocol-compatible descriptors (service, session, message, tool event) but does NOT start an ACP HTTP server. Actual server startup is Phase 5+ work that requires `@theokit/acp` wiring. Phase 4 delivers the mapping layer only. Acceptable because: the bridge is testable in isolation with unit tests, and the server wiring is a separate concern.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T4.1 | 1 | 0 | 1 (EC-2) | 0 |
| T4.2 | 0 | 0 | 0 | 0 |
| T4.3 | 1 | 1 (EC-1) | 0 | 0 |
| T4.4 | 0 | 0 | 0 | 0 |
| T4.5 | 0 | 0 | 0 | 0 |
| T4.6 | 0 | 0 | 0 | 0 |
| T4.7 | 1 | 0 | 1 (EC-3) | 0 |
| T4.8 | 0 | 0 | 0 | 0 |
| T4.9 | 1 | 0 | 0 | 1 (EC-4) |

**Verdict:** PLAN NEEDS ADJUSTMENT — 1 MUST FIX: job queue must normalize sync throws into rejected promises.
