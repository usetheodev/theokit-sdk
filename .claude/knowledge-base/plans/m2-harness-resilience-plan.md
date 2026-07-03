---
slug: m2-harness-resilience
milestone_id: M2
created_at: 2026-07-02
goal: Close the four M2 resilience/I/O gaps so the Harness survives flaky providers, slow streams, and cross-process history writes — verified by new failing-first tests for 429 backoff, circuit-open, stream idle-timeout, truncation, tool-call repair, MCP reconnect, and atomic batch append.
---

# Plan: M2 Harness Resilience & I/O Robustness

## Goal

Wire resilience into the Harness so defects #60, #61, #59, #63 are closed: the LLM 429 path backs
off with full jitter and a circuit breaker, the SSE stream bounds idle reads and rejects truncation,
malformed tool-call JSON is repaired before `{raw}`, the MCP client reconnects after a transport
drop, and conversation history appends atomically in batch across processes with pagination — each
proven by a new failing-first test (fake-timer / chaos / cross-process).

**Metric:** all new RED tests for the 11 deliverables pass GREEN; full `@theokit/sdk` suite stays
green; `pnpm validate` gates pass.

## Baseline Context

### Files that will be touched

| File | LoC | Last sha | Role today |
|---|---|---|---|
| `packages/sdk/src/internal/llm/pool-aware-client.ts` | 210 | `1ed2866` 2026-06-08 | 429 retry does bare `continue` (no sleep) at `:110-118`; `parseRetryAfterMs` used in rotate path only |
| `packages/sdk/src/internal/llm/retry.ts` | 82 | `1e40f5a` 2026-06-08 | `computeBackoffMs` (`:51`) + `sleepWithAbort` (`:69`) — built, unwired |
| `packages/sdk/src/internal/memory/circuit-breaker.ts` | 71 | (memory) | generic per-key consecutive-failure breaker (`shouldSkip`/`recordSuccess`/`recordTimeout`, injectable clock) — to relocate to `internal/resilience/` |
| `packages/sdk/src/internal/llm/sse.ts` | 141 | `1384bad` 2026-06-08 | `readChunks` (`:52-62`) awaits `reader.read()` with only `signal.aborted` — no idle timeout |
| `packages/sdk/src/internal/llm/finish.ts` | 61 | `73895a5` 2026-06-11 | `parseToolArguments` (`:24-31`) wraps `{raw}` before any repair; also owns `finish()` builder |
| `packages/sdk/src/internal/llm/openai.ts` | — | — | stream finish defaults `end_turn`; needs `sawFinishReason` truncation guard |
| `packages/sdk/src/internal/mcp/client.ts` | 332 | `2e96359` 2026-07-02 | M0 added timeout; `StdioMcpClient` handles `child.on("error")` (`:179`) but NOT `exit`/`close`; `HttpMcpClient.close()` no-op (`:284`); no reconnect |
| `packages/sdk/src/internal/runtime/session/agent-session-store.ts` | 203 | `44d550c` 2026-06-15 | per-message `mkdir`+`appendFile` (`:70,76,170,171`); `compactSessionFile` read→slice→rename, no lock |
| `packages/sdk/src/internal/persistence/file-lock.ts` | 189 | `ff730b1` 2026-06-09 | `withFileLock` (`:133`) — present, unused in append/compact |
| `packages/sdk/src/types/conversation-storage.ts` | 85 | `0ffa3ac` 2026-06-20 | `ConversationStorageAdapter` has `appendMessage` (single), `getMessages` (full) — no batch, no pagination |

### Current callers / dependents

- `parseToolArguments` ← `anthropic.ts`, `openai.ts`, `anthropic-shared.ts`, `finish.ts`.
- `PoolAwareLlmClient` ← `stream-relay.ts`, `router.ts`, `fault-injection.ts`.
- `CircuitBreaker` ← `local-agent-memory.ts`, `active-memory.ts`, `fault-injection.ts` (3 memory importers to update on relocate).
- `appendAnyPersistedMessage`/`appendToSessionFile` ← `conversation-storage-fs.ts`, `agent-session-store.ts`.

### Domain glossary

- **Full jitter**: backoff = `random(0, min(cap, base·2^attempt))` (AWS Brooker 2015) — `computeBackoffMs`.
- **Circuit breaker**: closed → open after N consecutive terminal failures → half-open probe after cooldown.
- **Idle timeout**: bound on *no bytes at all* between SSE reads (distinct from a slow-but-alive stream).
- **Truncation**: SSE ends without `finish_reason` and without `[DONE]` → partial output must not be committed as complete.

### Architecture boundaries affected

`internal/llm/` must not import `internal/memory/` (cross-domain coupling). The circuit breaker is a
cross-cutting resilience primitive → relocate to a neutral `internal/resilience/circuit-breaker.ts`
(SRP), re-consumed by both `llm/` and `memory/`.

## Prior Art & Related Work

- Blueprint: `.claude/knowledge-base/discoveries/blueprints/m2-harness-resilience-blueprint.md` (SHIPPABLE 98.7).
- Cross-validation issues: `.claude/knowledge-base/audits/cross-validation/_issues/07-resilience-retry.md`, `.../08-streaming-toolcall.md`, `.../06-mcp-robustness.md`, `.../10-persistence-storage.md` (peer file:line embedded: codex `responses.rs:424/435`, mastra `fetchWithRetry.ts:49`/`transform.ts:58`, opencode `storage.ts:277`).

## ADRs

### D1 — #60: wire full-jitter backoff on 429; reuse+relocate the existing CircuitBreaker

**Decision:** insert `await sleepWithAbort(computeBackoffMs({attempt:0, retryAfterMs: parseRetryAfterMs(...)}), signal)` before the first-429 `continue`; relocate `CircuitBreaker` from `internal/memory/` to `internal/resilience/circuit-breaker.ts` (behavior-preserving move + update 3 memory importers) and guard `PoolAwareLlmClient.stream` with it (open → typed `NetworkError({code:"circuit_open"})`).
**Rejected alternatives:** (a) build a NEW breaker — violates Rule 9; a generic per-key breaker with injectable clock already exists. (b) import the breaker directly from `internal/memory/` into `internal/llm/` — DIP/architecture smell (llm→memory); relocation to a neutral module is the honest fix. (c) fixed-delay retry — no jitter, thundering herd persists. (d) a resilience library (opossum) — new runtime dep M2 avoids; existing helpers suffice.
**Rule basis:** Rule 9 (reuse `retry.ts` + `CircuitBreaker`), `architecture.md` §2 (no llm→memory coupling), KISS.

### D2 — #61: idle timeout via read-race, truncation typed-error, jsonrepair-before-{raw}

**Decision:** race `reader.read()` against a per-read idle timer → `NetworkError({code:"stream_idle_timeout"})`; track `sawFinishReason`, absent-at-end → `NetworkError({code:"stream_truncated"})`; `parseToolArguments` attempts `jsonrepair(buffered)` before `{raw}` fallback.
**Rejected alternatives:** (a) whole-stream deadline — punishes long-but-alive streams; per-read idle is codex's pattern. (b) keep truncation as `end_turn` — commits partial output (correctness bug). (c) keep `{raw}` always — wastes a provider round-trip on repairable args; SDK owns `jsonrepair`.
**Rule basis:** codex prior art (`_issues/08`), Rule 8 (typed errors), Rule 9 (`jsonrepair` reuse).

### D3 — #59: detect drop + reconnect-with-backoff; defer elicitation/notifications

**Decision:** `StdioMcpClient` adds `child.on("exit"|"close")` → reject pending `NetworkError({code:"mcp_disconnected"})` + null child; `request()` reconnects once-with-backoff after a detected drop (bounded attempts); `HttpMcpClient` marks dropped on fetch transport failure and reconnects on next call.
**Rejected alternatives:** (a) adopt `@modelcontextprotocol/sdk` now — big surface + new dep; ROADMAP scopes #59 to reconnect; adoption is a separate decision (documented). (b) eager background reconnect — YAGNI; lazy on next use suffices.
**Rule basis:** ROADMAP scope (YAGNI), Rule 8 (typed `mcp_disconnected`), `_issues/06` findings 3+4.

### D4 — #63: batch append + withFileLock on append/compact + pagination

**Decision:** add `appendMessages(id, messages[])` (one `appendFile`, dir-existence cache; single `appendMessage` delegates to it); wrap batch append AND `compactSessionFile` in `withFileLock`; add paginated `getMessages(id, {offset?, limit?})` (no options = full read, backward-compatible).
**Rejected alternatives:** (a) migrate to SQLite transcript — larger churn; JSONL + file-lock closes the race with less risk (KISS). (b) no lock (in-process queue only) — the documented cross-process race. (c) apply-patch/git-snapshot — separate optional packages, out of hot-path DoD (YAGNI).
**Rule basis:** Rule 9 (`withFileLock` reuse), DRY (single delegates to batch), YAGNI.

## Dependency Graph

Phases 1–4 are independent (no shared files) and may proceed in any order; Phase 5 (integration
validation) depends on all. Recommended order 1→2→3→4→5 (Phase 4 touches the session store; do last).

## Phase 1 — #60: 429 backoff + circuit breaker

### T1.1 — Relocate CircuitBreaker to internal/resilience + wire into pool 429 backoff

#### Why this step
Action: move the generic breaker to a neutral module, wire the abortable backoff sleep into the
first-429 retry, and guard the pool with the breaker. Reasoning: `retry.ts` helpers + `CircuitBreaker`
exist but neither is invoked on the hot 429 path (`no-stubs-no-mocks-no-wired`); the ROADMAP DoD is
"429 zero-backoff fixed + circuit breaker" — ADR D1.

#### Files to edit
- `packages/sdk/src/internal/resilience/circuit-breaker.ts` (NEW — moved from `internal/memory/circuit-breaker.ts`)
- `packages/sdk/src/internal/memory/circuit-breaker.ts` (re-export shim OR delete + update importers)
- `packages/sdk/src/internal/memory/active-memory.ts`, `.../local-agent/local-agent-memory.ts`, `.../llm/fault-injection.ts` (import path update)
- `packages/sdk/src/internal/llm/pool-aware-client.ts` (wire backoff + breaker)
- `packages/sdk/src/errors.ts` (add `circuit_open` to error-code union if needed)

#### TDD
- RED `test_pool_429_sleeps_full_jitter_backoff_before_retry`: with `vi.useFakeTimers()`, a client that returns 429 then success — assert the second attempt fires only after `computeBackoffMs` elapses (advance timers; assert no early call).
- RED `test_pool_circuit_opens_after_consecutive_failures_and_fails_fast`: N consecutive terminal failures → next `stream` throws `NetworkError({code:"circuit_open"})` without invoking the transport.
- RED `test_pool_circuit_half_open_probe_after_cooldown`: after cooldown, one probe call is allowed.
- RED `test_circuit_breaker_relocated_memory_callers_still_work`: existing active-memory breaker tests pass against the relocated module.

#### Concurrency tests
Backoff + breaker are timer-driven and single-owner per pool instance; determinism via `vi.useFakeTimers()` + injectable `now()` (breaker already supports it). No shared mutable cross-thread state — assert atomic-counter invariant on the breaker's consecutive-failure count. Not race-prone (single event loop).

#### Acceptance criteria
- The 429 path calls `sleepWithAbort(computeBackoffMs(...), signal)` before `continue` (grep + test).
- Breaker opens after `maxTimeouts` consecutive failures and fails fast with `circuit_open`.
- All 3 relocated-importer memory suites stay green; no `internal/llm/` → `internal/memory/` import remains (grep).

#### DoD
`pnpm --filter @theokit/sdk test tests/**/pool-aware* tests/**/circuit-breaker*` green; `pnpm typecheck` clean; CHANGELOG `.changeset/` entry added.

## Phase 2 — #61: idle timeout + truncation + jsonrepair

### T2.1 — SSE idle timeout
#### Why this step
Action: race each `reader.read()` against an idle timer. Reasoning: a stalled upstream hangs the
AsyncGenerator forever with no error (`_issues/08` finding 3) — ADR D2.
#### Files to edit
- `packages/sdk/src/internal/llm/sse.ts` (`readChunks` race), `packages/sdk/src/errors.ts` (`stream_idle_timeout` code)
#### TDD
- RED `test_sse_idle_timeout_rejects_typed_error_when_upstream_stalls`: mock `ReadableStream` yields one chunk then a never-settling `read()`; with fake timers, advancing past `idleTimeoutMs` → `NetworkError({code:"stream_idle_timeout"})`; the body is cancelled.
- RED `test_sse_slow_but_alive_stream_not_falsely_timed_out`: chunks arriving just under the idle bound do NOT trip.
#### Concurrency tests
Timer-vs-read race made deterministic with `vi.useFakeTimers()`; assert the read promise loses to the idle timer only when no chunk arrives. (none — single-threaded).
#### Acceptance criteria
Stalled stream rejects the typed error within the idle bound and cancels the socket; slow-alive stream unaffected.
#### DoD
`pnpm --filter @theokit/sdk test tests/**/sse* tests/**/stream*` green; typecheck clean.

### T2.2 — Truncation typed-error
#### Why this step
Action: track `sawFinishReason`; throw typed truncation error if absent at stream end. Reasoning: a
truncated stream is silently reported as clean `end_turn` (`_issues/08` finding 4) — ADR D2.
#### Files to edit
- `packages/sdk/src/internal/llm/openai.ts` (+ `anthropic.ts` if the same default), `packages/sdk/src/errors.ts` (`stream_truncated`)
#### TDD
- RED `test_stream_without_finish_reason_throws_truncation_error`: SSE ends without `finish_reason`/`[DONE]` → `NetworkError({code:"stream_truncated"})`, not a default `end_turn` finish.
- RED `test_stream_with_finish_reason_completes_normally`: regression — a proper finish still returns `end_turn`.
#### Concurrency tests
(none — single-threaded).
#### Acceptance criteria
Truncated stream throws typed error; well-formed stream unaffected.
#### DoD
`pnpm --filter @theokit/sdk test tests/**/openai* tests/**/stream*` green; typecheck clean.

### T2.3 — jsonrepair before {raw}
#### Why this step
Action: attempt `jsonrepair(buffered)` in `parseToolArguments` before the `{raw}` fallback. Reasoning:
malformed native tool-call JSON is wrapped in `{raw}` before repair can run, bouncing to the model as
`invalid_request` (`_issues/08` finding 5) — ADR D2.
#### Files to edit
- `packages/sdk/src/internal/llm/finish.ts` (`parseToolArguments`)
#### TDD
- RED `test_malformed_but_repairable_toolcall_json_parses_after_repair`: `{"a":1,}` (trailing comma) → `{a:1}`, not `{raw}`.
- RED `test_unrepairable_toolcall_json_still_falls_back_to_raw`: regression — genuinely broken input → `{raw}` preserved.
- RED `test_wellformed_toolcall_json_unaffected`: valid JSON parses without invoking repair.
#### Concurrency tests
(none — single-threaded).
#### Acceptance criteria
Repairable args parse; unrepairable → `{raw}`; valid → parsed directly; `jsonrepair` lazy-loaded only when needed.
#### DoD
`pnpm --filter @theokit/sdk test tests/**/finish* tests/**/tool*` green; typecheck clean.

## Phase 3 — #59: MCP reconnect-after-drop

### T3.1 — Detect drop + reconnect-with-backoff
#### Why this step
Action: reject pending on child `exit`/`close`, null the child, reconnect once-with-backoff on next
request. Reasoning: a dropped stdio child / failed http transport leaves pending promises hung and
never reconnects (`_issues/06` findings 3+4) — ADR D3.
#### Files to edit
- `packages/sdk/src/internal/mcp/client.ts` (child exit/close handlers + reconnect state), `packages/sdk/src/errors.ts` (`mcp_disconnected`)
#### TDD
- RED `test_stdio_child_exit_rejects_pending_with_typed_error`: kill child mid-request → pending rejects `NetworkError({code:"mcp_disconnected"})`, not a hang.
- RED `test_stdio_reconnects_on_next_request_after_drop`: after a drop, next `request()` respawns and succeeds.
- RED `test_http_reconnects_after_transport_failure`: fetch transport failure marks dropped; next call reconnects.
- RED `test_reconnect_exhaustion_surfaces_typed_error`: bounded attempts exhausted → typed error, no infinite loop.
#### Concurrency tests
Drop-vs-in-flight-request is the race: assert a request in flight when the child exits rejects exactly once (no double-settle) — reuses the M0 pending-map single-settle invariant. cancellation propagation via the existing timeout path.
#### Acceptance criteria
Dropped transport rejects pending (typed) + reconnects on next use; reconnect is bounded; no double-settle.
#### DoD
`pnpm --filter @theokit/sdk test tests/mcp/**` green; typecheck clean.

## Phase 4 — #63: batch append + file lock + pagination

### T4.1 — Batch append + dir cache + cross-process lock
#### Why this step
Action: add `appendMessages` (one write, dir cache), delegate single-append to it, wrap append+compact
in `withFileLock`. Reasoning: per-message `mkdir`+`appendFile` and no cross-process lock tear >4KB
lines / drop compaction-window lines (`_issues/10` findings 2+3) — ADR D4.
#### Files to edit
- `packages/sdk/src/internal/runtime/session/agent-session-store.ts` (batch + lock), `packages/sdk/src/internal/persistence/conversation-storage-fs.ts` (adapter batch method), `packages/sdk/src/types/conversation-storage.ts` (interface `appendMessages`)
#### TDD
- RED `test_append_messages_writes_turn_in_single_appendfile`: a turn (user+assistant+2 tool-results) → one `appendFile` call (spy) + all lines present in order.
- RED `test_concurrent_writers_do_not_tear_jsonl_line`: two `withFileLock` sections append a >4KB message concurrently → both lines intact, none interleaved.
- RED `test_compaction_under_lock_does_not_drop_concurrent_append`: compaction + append race → no dropped line.
#### Concurrency tests
This IS the cross-process concurrency deliverable — a **parallel test** in the `tests/integration/**`
forks+singleFork pool with real concurrent file handles (not mocked). Invariant: with `withFileLock`,
N concurrent appenders produce exactly N intact JSONL lines — an **atomic-counter invariant** on the
line count (byte integrity + count). The append-vs-compaction **race condition** is exercised directly.
#### Acceptance criteria
Batch append = one write per turn (dir `mkdir` once); concurrent writers never tear a line; compaction never drops a concurrently-appended line; single `appendMessage` delegates to batch.
#### DoD
`pnpm --filter @theokit/sdk test tests/**/conversation-storage* tests/**/session*` green; typecheck clean.

### T4.2 — Pagination read
#### Why this step
Action: add `getMessages(id, {offset?, limit?})`. Reasoning: full-history O(N) read on every hydration
(`_issues/10`, ROADMAP #63 "pagination") — ADR D4.
#### Files to edit
- `packages/sdk/src/types/conversation-storage.ts`, `packages/sdk/src/internal/persistence/conversation-storage-fs.ts`, `.../conversation-storage-memory.ts`
#### TDD
- RED `test_get_messages_paginated_returns_requested_window`: `{offset:2, limit:3}` returns messages 2..4.
- RED `test_get_messages_no_options_returns_full_history`: regression — backward-compatible full read.
#### Concurrency tests
(none — single-threaded).
#### Acceptance criteria
Paginated read returns the bounded window; no-options read = full history (both fs + memory adapters).
#### DoD
`pnpm --filter @theokit/sdk test tests/**/conversation-storage*` green; typecheck clean.

## Failure scenarios

| External dependency | Failure mode | Test reproduces | Expected behavior |
|---|---|---|---|
| LLM provider (pool) | 429 shared-quota storm | fake-timer 429-then-ok | full-jitter backoff sleep, then retry; no <1ms burn |
| LLM provider | hard-down (repeated 5xx/429) | N consecutive failures | circuit opens → fail fast `circuit_open` |
| SSE upstream | stalls after partial output | never-settling `read()` | `stream_idle_timeout` typed error; socket cancelled |
| SSE upstream | drops before finish_reason | stream ends early | `stream_truncated` typed error (not `end_turn`) |
| Native tool-call | malformed-but-repairable JSON | trailing-comma input | `jsonrepair` then parse; `{raw}` only if unrepairable |
| MCP server (stdio) | child exits mid-request | kill child | pending rejects `mcp_disconnected`; reconnect on next |
| MCP server (http) | transport failure | fetch throws | marked dropped; reconnect on next call; bounded |
| Filesystem (transcript) | two processes append/compact | concurrent writers | `withFileLock` → no torn line, no dropped compaction |

## Coverage Matrix

| Requirement (ROADMAP M2 DoD) | Task(s) |
|---|---|
| #60 429 zero-backoff fixed (full-jitter helper wired) | T1.1 |
| #60 circuit breaker | T1.1 |
| #61 streaming idle timeout | T2.1 |
| #61 truncation flag | T2.2 |
| #61 `{raw}` passthrough (repair before raw) | T2.3 |
| #59 MCP reconnect after drop | T3.1 |
| #63 batch writes | T4.1 |
| #63 atomic turn append (cross-process lock) | T4.1 |
| #63 pagination | T4.2 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Circuit-breaker + idle thresholds are heuristic (ROADMAP top-risk) | MEDIUM | conservative configurable defaults (breaker 3-fail/60s reuse; idle ~60s); document as tunable | paulohenriquevn |
| Idle timeout false-positive on slow-but-alive model (ROADMAP top-risk) | MEDIUM | idle = *no bytes at all* between reads, not slow bytes; regression test `slow_but_alive_not_timed_out` | paulohenriquevn |
| CircuitBreaker relocation breaks 3 memory importers | LOW | behavior-preserving move; run all 3 memory suites in T1.1 DoD | paulohenriquevn |
| Cross-process lock test flakiness in CI | MEDIUM | run in forks+singleFork pool; byte-integrity assertions, no timing assertions | paulohenriquevn |
| New typed error codes are public surface | LOW | add to `docs.md` + changeset in the same slice | paulohenriquevn |

## Unresolved Questions

(none — every decision is resolved at plan time; ADR D3 explicitly scopes elicitation/notifications OUT.)

## Global DoD

- Every task's RED test written first and passing GREEN.
- Full `@theokit/sdk` suite green; `pnpm typecheck` clean; `pnpm lint` (Biome) clean; `knip` clean (no orphan exports).
- New public error codes (`circuit_open`, `stream_idle_timeout`, `stream_truncated`, `mcp_disconnected`) documented in `docs.md`.
- Changesets added (minor) per issue.
- No new runtime dependency.
- No file exceeds the 500 LoC budget after edits.

## Final Phase: Integration Validation

- `pnpm --filter @theokit/sdk test` (full suite) green.
- `pnpm validate` (build/typecheck/test/knip/publint/attw/bundle) green.
- Failure-scenarios chaos pass: stalled-stream, killed-MCP-child, cross-process append tests all green.
- `/code-quality m2-harness-resilience` → PASS/PASS_WITH_CAVEATS.
