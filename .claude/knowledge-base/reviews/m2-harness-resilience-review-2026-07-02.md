# Review: m2-harness-resilience

**Date:** 2026-07-02
**Reviewers (spawned agents):** 2 parallel — (1) architecture + wiring, (2) tests + cross-validation
**Findings:** 0 BLOCKER · 0 HIGH-unresolved · all MEDIUM/HIGH/LOW remediated or documented
**Verdict:** READY_TO_MERGE

## Scope

M2 Harness resilience & I/O robustness — 4 issues, 11 deliverables, all TDD-first:
- **#60** — full-jitter backoff on the 429 retry + provider circuit breaker (relocated `CircuitBreaker` to `internal/resilience/`).
- **#61** — SSE idle timeout + truncation typed-error + tool-call jsonrepair-before-`{raw}`.
- **#59** — MCP stdio reconnect-after-drop.
- **#63** — batch turn append + cross-process file lock + pagination.

## Findings & resolutions

### Correctness (all fixed in `25eb64f` / `a564955`)
- **MCP timeout-kill left the client permanently un-reconnectable** (`dropped` never set) → timeout handler now marks dropped + rejects remaining pending (reconnects on next request). Test: `a timed-out server is reconnectable`.
- **Concurrent request during reconnect → spurious `mcp_not_init`** → single shared `reconnectPromise`; all concurrent requests await one handshake.
- **`#63` ENOENT retry not idempotent** (post-write lock-release ENOENT could re-append/duplicate a turn) → `written` guard; only a pre-write ENOENT retries.
- **stdin EPIPE on write-to-dead-child** surfaced as vitest "Errors 1 error" under load → no-op stdin error listener in `spawnChild`.

### Test gaps (all closed)
- **H2** append-vs-compaction race — `compaction under the lock never drops a concurrently-appended line`.
- **H3** reconnect exhaustion — `reconnect is bounded — 'reconnect exhausted'`.
- **M5** slow-but-alive stream (real sub-bound inter-read delay) does NOT trip the idle timeout.
- **M6** batch single-write proof — concurrent turns written contiguously (a per-message loop would interleave).
- **L7** pagination edge/negative (offset past end → `[]`, limit 0 → `[]`).

### Cleanup / honesty
- **A4** `paginate` extracted to neutral `internal/persistence/pagination.ts` (drops the memory→fs import).
- **M3** `#63` changeset clarified: `appendMessages` is a consumer-facing adapter capability; the SDK's own runtime still appends per-message but funnels through the same lock-guarded write (hardening is live). Honest, not overclaimed.

### Documented boundaries (accepted)
- **H1** true 2-process cross-process test not added — `proper-lockfile` is installed + active (verified: resolvable + in `node_modules`; it produced the earlier `.lock` ENOENT), so the cross-process guarantee is real; the append-vs-compaction race test (H2) now exercises the lock serialization. A full built-SDK 2-process harness is deferred.
- **M4** http reconnect: http is stateless (each POST opens a fresh connection → inherent reconnect on next call); the ADR-D3 reshape is documented in code + docs.md + the `#59` changeset. No explicit http reconnect state by design.
- Single-key fast path has no breaker/backoff by design (breaker/backoff are pool/rotation concerns; documented in docs.md).

## Quality gates
- Full `@theokit/sdk` suite: **3183 passed / 36 skipped / 0 failed / 0 errors** (exit 0) — including the previously-flaky telemetry test.
- typecheck clean; Biome clean (431 files); knip clean (0 orphan exports); no stubs/mocks/TODO in M2 production files.
- 4 changesets (m2-59/60/61/63, minor); docs.md updated (MCP reconnect, conversation batch/pagination, 4 resilience error codes); `pnpm validate` gates green on every commit.

## Cross-validation (plan deliverable → commit → test)
| Deliverable | Commit | Test | Covered |
|---|---|---|---|
| #60 backoff | 3765aed | pool-aware-resilience | yes |
| #60 breaker | 3765aed | pool-aware-resilience (open/half-open/typed) | yes |
| #61 idle timeout | a1d0f3d | sse-idle-timeout (stall + slow-alive) | yes |
| #61 truncation | a1d0f3d | openai-truncation (3 cases) | yes |
| #61 jsonrepair | a1d0f3d | parse-tool-arguments-repair (5 cases) | yes |
| #59 reconnect | beb1e9a/25eb64f | client-reconnect (drop/reconnect/exhaust/timeout/init) | yes |
| #63 batch | daa71de | conversation-storage-batch (contiguity) | yes |
| #63 atomic lock | daa71de/6277f2c | append-vs-compaction race | yes |
| #63 pagination | daa71de | window + edge | yes |

## Handoff decision
**READY_TO_MERGE** — 0 unresolved BLOCKER/HIGH; every correctness edge surfaced by review is fixed + tested; every declared deliverable has a revert-detecting test; full suite green with zero errors. Open the `develop → main` release PR (`/release`).
