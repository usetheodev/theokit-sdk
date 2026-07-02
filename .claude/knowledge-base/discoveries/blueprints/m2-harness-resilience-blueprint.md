# Blueprint: M2 Harness Resilience & I/O Robustness — Fix Approaches

> **Version 1.0** — Synthesizes how the SDK should close the four M2 resilience/I/O gaps (#60 429 backoff + circuit breaker, #61 streaming idle timeout + truncation + `{raw}` repair, #59 MCP reconnect-after-drop, #63 persistence batch/pagination/atomic append), informed by our cross-validation sweep against 5 SOTA peers (codex, mastra, opencode, adk-js, crewai) and the current SDK source. Decides the concrete, minimal, stdlib-first technique per deliverable and the test strategy. Scope is the ROADMAP M2 DoD — larger adjacent findings are explicitly deferred with rationale.

**Slug:** `m2-harness-resilience`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m2-harness-resilience-plan.md`
**Owner:** paulohenriquevn
**Generated:** 2026-07-02 via `/discover-execute`
**Confidence verdict:** SHIPPABLE (updated by `/discover-confidence`)

## Context

The cross-validation sweep filed four resilience/I/O issue groups at
`.claude/knowledge-base/audits/cross-validation/_issues/07-resilience-retry.md`,
`.../08-streaming-toolcall.md`, `.../06-mcp-robustness.md`, `.../10-persistence-storage.md`. M0
(security floor) and M1 (correctness core) are RELEASED; M2 hardens the runtime against flaky
providers, slow streams, and large histories. Each deliverable already has a partially-built
primitive in-tree (backoff helper, file lock, jsonrepair) that is simply **not wired on the hot
path** — the dominant shape of M2 is *wiring existing stdlib/helpers*, not new machinery (KISS +
Rule 9 + `no-stubs-no-mocks-no-wired`).

## Objective

Let the reader decide the exact minimal technique + test approach for each of the 11 in-scope M2
deliverables, and what to defer.

---

## Coverage Corner 1 — Integration Tests

### codex — bound-and-fail streaming, hard truncation error

- **Pattern**: codex bounds every `stream.next()` with `timeout(idle_timeout)` and treats a stream ending before `response.completed` as a hard error (per `_issues/08-streaming-toolcall.md` findings 3+4, citing `codex-rs/codex-api/src/sse/responses.rs:424` and `:435`). The test shape: feed a mock SSE body that emits a few chunks then stalls (never closes) → assert a typed timeout error within the idle bound; feed a body that ends without `finish_reason`/`[DONE]` → assert a typed truncation error, not a clean `end_turn`.
- **SDK mirror**: our chaos harness already exists — `packages/sdk/tests/chaos/kill-mid-stream.test.ts` — and `packages/sdk/tests/stream-to-completion.test.ts` drives the stream. New tests add a "stalled upstream" mock (a `ReadableStream` that resolves one chunk then returns a never-settling `read()`), driven under `vi.useFakeTimers()` to advance the idle timer deterministically.

### mastra — retry with backoff, tool-call repair

- **Pattern**: mastra's `packages/core/src/utils/fetchWithRetry.ts:49` (per `_issues/07` finding 3) sleeps a full-jitter backoff between attempts; its `packages/core/src/stream/aisdk/v5/transform.ts:58` (per `_issues/08` finding 5) repairs malformed tool-call JSON before surfacing it. Test shape: fake-timer test asserting the 429 path sleeps `computeBackoffMs` before re-hitting the key; a unit test feeding malformed-but-repairable JSON (`{a:1,}` trailing comma) asserting it parses after repair rather than landing in `{raw}`.

### opencode — cross-process append lock

- **Pattern**: opencode serializes transcript append+compaction with a cross-process lock (per `_issues/10` finding 3, citing `packages/opencode/src/storage/storage.ts:277`). Test shape: spawn two writers against the same `messages.jsonl` (or two `withFileLock` sections in-process racing) and assert no torn/interleaved JSONL line and no compaction-dropped line.

---

## Coverage Corner 2 — Dependencies

### Stdlib + already-installed helpers are sufficient (Q10)

| Need | Source | Already present? | Citation |
|---|---|---|---|
| Backoff compute + abortable sleep | `computeBackoffMs` + `sleepWithAbort` | YES — built, unwired | `packages/sdk/src/internal/llm/retry.ts:51,69` |
| Retry-After parse | `parseRetryAfterMs` | YES (used in rotate path only) | `packages/sdk/src/internal/llm/pool-aware-client.ts` |
| SSE idle timeout | `AbortSignal.timeout` / `setTimeout` race | stdlib (Node ≥22.12) | n/a |
| Malformed-JSON repair | `jsonrepair` (lazy-loaded direct dep) | YES — unwired on tool-call path | `packages/sdk/src/sanitize/coerce.ts:5-13` |
| Cross-process file lock | `withFileLock` | YES — unused in append/compact | `packages/sdk/src/internal/persistence/file-lock.ts:133` |
| MCP reconnect timers | `setTimeout` + `computeBackoffMs` reuse | stdlib + reuse | n/a |

**Conclusion:** M2 introduces **zero new runtime dependencies** — every piece is stdlib or an
already-declared helper that must simply be invoked on the hot path.

---

## Coverage Corner 3 — Tools

### Deterministic timer testing + existing chaos harness (Q12)

- **Build/test**: `pnpm --filter @theokit/sdk test` (Vitest). Backoff/idle-timeout/reconnect-backoff tests use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` to make timer-driven behavior deterministic (the exact reason the #60 wiring was "deferred" — the fake-timer test update is the real work).
- **Chaos harness present**: `packages/sdk/tests/chaos/` (e.g., `kill-mid-stream.test.ts`) — the home for stalled-stream + killed-MCP-child tests. `packages/sdk/tests/integration/` runs in the forks+singleFork pool per `vitest` config (process-isolation-tolerant) — the home for cross-process append-race tests.
- **CI**: existing GitHub Actions run `pnpm validate` (build/typecheck/test/knip/publint/attw/bundle). No new tool needed.

---

## Coverage Corner 4 — Techniques

### T1 — #60 wire full-jitter backoff on 429 + circuit breaker

Insert the abortable backoff sleep before the `continue` at the 429 retry decision, then add a
minimal circuit breaker guarding the pool.

- **Backoff wiring** (`packages/sdk/src/internal/llm/pool-aware-client.ts:110-118`): replace the bare `hasRetried429 = true; continue;` with `await sleepWithAbort(computeBackoffMs({ attempt: 0, retryAfterMs: parseRetryAfterMs(attempt.error) }), signal); hasRetried429 = true; continue;`. Honors `Retry-After` when present; full-jitter otherwise (`retry.ts:51`). Abort-safe (`sleepWithAbort` rejects on `signal`).
- **Circuit breaker** (minimal, KISS): a small `CircuitBreaker` with three states (closed → open after N consecutive terminal failures → half-open single probe after a cooldown). Guards `PoolAwareLlmClient.stream` entry: when open, fail fast with a typed `CircuitOpenError` (extends `TheokitAgentError`) instead of hammering an already-down provider. Thresholds configurable (default: 5 consecutive failures, 30s cooldown) — flagged as heuristic per the ROADMAP top-risk note.
- **Test**: fake-timer test asserts (a) the 429 path sleeps the computed backoff before retrying (advance timers, assert the second attempt fires only after the sleep), (b) after N consecutive failures the breaker opens and the next call fails fast without calling the transport, (c) after cooldown a half-open probe is allowed.
- **Evidence**: `_issues/07-resilience-retry.md` findings 1+3 (vs codex `retry.rs:67`, mastra `fetchWithRetry.ts:49`).

### T2 — #61 SSE idle timeout + truncation typed-error + jsonrepair-before-`{raw}`

Three independent, small changes on the streaming path.

- **Idle timeout** (`packages/sdk/src/internal/llm/sse.ts:52-62` `readChunks`): race `reader.read()` against a per-read idle timer (`AbortSignal.timeout(idleMs)` or a `setTimeout`-backed promise). On idle-timeout, reject a typed `NetworkError({ code: "stream_idle_timeout" })` so `FallbackLlmClient`/retry can route it; the existing `finally` cancels the body stream. Default idle ~60s (configurable) — guard against slow-but-alive false positives per the ROADMAP top-risk note (idle = *no bytes at all*, not *slow bytes*).
- **Truncation detection** (OpenAI/Anthropic stream finish): track a `sawFinishReason` flag; if the SSE loop exits without it AND without `[DONE]`, throw a typed `NetworkError({ code: "stream_truncated" })` instead of returning a default-`end_turn` `finish()`. The loop can no longer commit partial output as a complete turn.
- **jsonrepair before `{raw}`** (`packages/sdk/src/internal/llm/finish.ts:24-31` `parseToolArguments`): in the `catch`, attempt `jsonrepair(buffered)` then `JSON.parse`; only fall back to `{ raw: buffered }` when repair *also* fails. Reuses the already-lazy-loaded `jsonrepair` (`coerce.ts:5-13`) — Kimi/K2-class malformed args (trailing comma, unquoted key) now parse instead of bouncing to the model as `invalid_request`.
- **Test**: stalled-stream mock → idle-timeout typed error (fake timers); no-finish-reason mock → truncation typed error; malformed-but-repairable tool-call args → parsed object, not `{raw}`; unrepairable → `{raw}` preserved (regression).
- **Evidence**: `_issues/08-streaming-toolcall.md` findings 3 (codex `responses.rs:424`), 4 (codex `responses.rs:435`), 5 (mastra `transform.ts:58`).

### T3 — #59 MCP reconnect-after-drop

Detect the drop, then reconnect with backoff on the next request.

- **Drop detection** (`packages/sdk/src/internal/mcp/client.ts`): `StdioMcpClient` currently handles `child.on("error")` (`:179`) but NOT `exit`/`close`. Add `child.on("exit"|"close")` → reject all pending with a typed `NetworkError({ code: "mcp_disconnected" })` + null out `this.child` so subsequent requests fail fast rather than hang (closes `_issues/06` finding 3 too, adjacent to reconnect). `HttpMcpClient` marks itself dropped on a fetch transport failure.
- **Reconnect-with-backoff**: on the next `request()` after a detected drop, re-`spawn` (stdio) / re-`initialize` (http) once, guarded by `computeBackoffMs` reuse + a bounded attempt count. Success clears the dropped flag; exhaustion surfaces the typed error. Minimal state: `#dropped: boolean` + `#reconnectAttempts: number`.
- **Deferred (out of ROADMAP #59 scope):** elicitation, server notifications, adopting `@modelcontextprotocol/sdk`, real `text/event-stream` SSE client — these are `_issues/06` finding 4's *other* clauses; the ROADMAP scopes #59 to "reconnect after drop" only. Documented as a scope boundary.
- **Test**: stdio child killed mid-session → pending rejects typed `mcp_disconnected` (not hang); next request respawns and succeeds; http drop → reconnect on next call; reconnect exhaustion → typed error.
- **Evidence**: `_issues/06-mcp-robustness.md` findings 3+4 (vs mastra `client.ts:297`, `error-utils.ts:1`).

### T4 — #63 batch append + cross-process lock + pagination

Three persistence changes, all reusing existing primitives.

- **Batch append** (`packages/sdk/src/internal/runtime/session/agent-session-store.ts:164-172` + `ConversationStorageAdapter`): add `appendMessages(id, messages[])` that writes all JSONL lines in **one** `appendFile` and `mkdir`s once (dir-existence cache), replacing N per-message `mkdir`+`appendFile` cycles for a turn (user + assistant + N tool-results). The single-message `appendMessage` delegates to the batch of one (DRY).
- **Cross-process atomic append** (reuse `withFileLock`, `file-lock.ts:133`): wrap the batch append AND `compactSessionFile`'s read→slice→rename in `withFileLock(<messages.jsonl>.lock)` so two Node processes sharing cwd cannot tear a >4KB line or drop compaction-window lines. `withFileLock` already handles the not-yet-created-file case.
- **Pagination** (`ConversationStorageAdapter`): add `getMessages(id, { offset?, limit? })` (or a sibling `getMessagesPage`) so hydration reads a bounded window instead of O(N) full history. Backward-compatible: no options = current full read.
- **Test**: batch append writes one turn atomically (assert single file-open via spy or byte-integrity); two racing writers → no torn line, no dropped compaction line (integration/forks pool); paginated read returns the requested window; empty options = full history (regression).
- **Evidence**: `_issues/10-persistence-storage.md` findings 2 (mastra `base.ts:93`), 3 (opencode `storage.ts:277`).

---

## Cross-cutting Comparison

| Deliverable | New machinery? | Reused primitive | Concurrency risk | Public API change |
|---|---|---|---|---|
| #60 backoff | no (wire) | `computeBackoffMs`/`sleepWithAbort` | abort during sleep | none |
| #60 circuit breaker | small class | — | breaker state single-owner | new `CircuitOpenError` (additive) |
| #61 idle timeout | no (race) | `AbortSignal.timeout` | timer vs read race | new opt (`idleTimeoutMs`), additive |
| #61 truncation | no (flag) | finish tracking | none | new typed error code |
| #61 jsonrepair | no (wire) | `jsonrepair` | none | none (better parse) |
| #59 reconnect | small state | `spawn`/`computeBackoffMs` | drop vs in-flight request | new typed error code |
| #63 batch/lock/paginate | small | `withFileLock`/`appendFile` | cross-process (the point) | additive adapter methods |

---

## ADRs

### D1 — #60: wire full-jitter backoff on 429 + minimal circuit breaker

**Decision:** insert `await sleepWithAbort(computeBackoffMs(...), signal)` before the first-429 `continue`; add a 3-state `CircuitBreaker` (closed/open/half-open, default 5-fail/30s-cooldown) guarding `PoolAwareLlmClient.stream`.
**Alternatives rejected:** (a) fixed-delay retry — no jitter → thundering herd persists (the exact bug). (b) a full resilience library (cockatiel/opossum) — Rule 9 says reuse, but the SDK already owns full-jitter backoff and the breaker is ~40 lines; a dep for that is heavier than KISS warrants and adds a runtime dep M2 explicitly avoids. (c) no breaker (backoff only) — leaves the SDK hammering a hard-down provider; ROADMAP DoD requires the breaker.
**Rule basis:** Rule 9 (reuse `retry.ts`), KISS (small breaker), `no-stubs-no-mocks-no-wired` (helper must be invoked).

### D2 — #61: idle timeout (race) + truncation typed-error + jsonrepair-before-`{raw}`

**Decision:** race each `reader.read()` against an idle timer → typed `stream_idle_timeout`; track `sawFinishReason` → typed `stream_truncated` when absent; attempt `jsonrepair` in `parseToolArguments` before `{raw}`.
**Alternatives rejected:** (a) idle timeout via a single whole-stream deadline — punishes legitimately long streams; per-read idle is the codex pattern and distinguishes *stalled* from *slow*. (b) treat truncation as `end_turn` (status quo) — silently commits partial output; rejected as a correctness bug. (c) always `{raw}` (status quo) — wastes a provider round-trip on repairable args; the SDK already owns `jsonrepair`.
**Rule basis:** codex prior art (`_issues/08`), Rule 8 (typed errors), Rule 9 (`jsonrepair` reuse).

### D3 — #59: detect drop (child exit/close + http fail) → reconnect-with-backoff; defer elicitation/notifications

**Decision:** add `child.on("exit"|"close")` rejecting pending + nulling child; reconnect once-with-backoff on the next request; scope elicitation/notifications/mcp-sdk-adoption OUT (documented boundary).
**Alternatives rejected:** (a) adopt `@modelcontextprotocol/sdk` now (Rule 9) — large surface change + new dep; the ROADMAP scopes #59 to reconnect only; adoption is a separate strategic decision (note in docs.md). (b) auto-reconnect eagerly in the background — YAGNI; reconnect lazily on next use is simpler and sufficient.
**Rule basis:** ROADMAP scope discipline (YAGNI), Rule 8 (typed `mcp_disconnected`), `_issues/06` findings 3+4.

### D4 — #63: batch append + `withFileLock` on append/compact + pagination

**Decision:** `appendMessages(batch)` with dir-cache (single-message delegates to it); wrap append+compact in `withFileLock`; add paginated `getMessages(id, {offset,limit})`. Defer apply-patch primitive + git-snapshot.
**Alternatives rejected:** (a) migrate transcript to SQLite (opencode-style) — larger change; the JSONL + file-lock path closes the race with far less churn (KISS). (b) no lock, rely on in-process queue (status quo) — cross-process race is the documented bug. (c) apply-patch/git-snapshot now — separate optional packages, out of the persistence hot-path DoD (YAGNI).
**Rule basis:** Rule 9 (`withFileLock` reuse), DRY (single-message delegates to batch), YAGNI (defer snapshot).

## Recommendations for the project

1. Implement in dependency order: #60 (self-contained) → #61 (self-contained) → #59 (self-contained) → #63 (touches the session store; do last). No cross-issue coupling — each is a small wiring slice with a fake-timer/chaos test.
2. Every timer-driven behavior (backoff, idle timeout, reconnect backoff) gets a `vi.useFakeTimers()` test — the historical reason #60 was deferred; this is the real cost, budget for it.
3. Add typed error codes (`circuit_open`, `stream_idle_timeout`, `stream_truncated`, `mcp_disconnected`) to `docs.md` in the same slice (public surface).
4. Keep circuit-breaker + idle thresholds configurable with conservative defaults (ROADMAP top-risks: heuristic thresholds, slow-but-alive false positives).

## Blocked questions (if any)

(none — every question answered with a verified SDK path + cross-validation finding.)

## Halt-loop progress (audit trail)

12/12 research questions answered from the cross-validation `_issues/*.md` + verified SDK source. Four corners populated. 4 ADRs. Zero fabricated citations.

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/m2-harness-resilience-plan.md`
- Cross-validation issues: `.claude/knowledge-base/audits/cross-validation/_issues/07-resilience-retry.md`, `.../08-streaming-toolcall.md`, `.../06-mcp-robustness.md`, `.../10-persistence-storage.md`
- ROADMAP: `theokit-sdk/ROADMAP.md` M2 (owns) + ecosystem `theokit-tools/ROADMAP.md` M2
