# Edge Case Review — mastra-parity-cross-validation

Date: 2026-06-09
Tasks analyzed: 11
Edge cases found: 12 (MUST FIX: 3, SHOULD TEST: 5, DOCUMENT: 4)

## MUST FIX

### EC-1: Provider catalog JSON schema validation at load time
- **Affected task:** T10.1
- **Family:** Input / Format
- **Scenario:** `provider-catalog.json` is hand-edited (or community PR) and contains a malformed entry — missing `capabilities` field, wrong type for `supportsToolUse`, duplicate provider ID. `loadProviderCatalog()` loads it at boot without schema validation, producing a runtime crash deep in `router.ts` when a user picks the malformed provider.
- **Impact:** Agent creation fails with cryptic error ("Cannot read property 'supportsToolUse' of undefined") instead of actionable diagnostic at boot.
- **Suggested fix:** Add `validateCatalogEntry(entry)` with Zod schema at load time. Reject invalid entries with a WARN log and skip them — don't crash the entire registry because one community-contributed entry is broken.

### EC-2: BoundedBuffer deadlock on synchronous consumer
- **Affected task:** T10.3
- **Family:** State / Timing
- **Scenario:** If `push()` returns a Promise that blocks the event loop (because highWaterMark is reached) and the consumer `pull()` is scheduled on the same microtask queue, a deadlock occurs — push waits for pull, but pull is queued after push resolves.
- **Impact:** `subscribe()` hangs indefinitely. Slow consumer scenario becomes no-consumer scenario.
- **Suggested fix:** Use `setTimeout(resolve, 0)` (or `queueMicrotask`) in the push-blocked path to yield to the event loop. Add a `deadlockTimeoutMs` option (default 30s) that rejects the push promise if the buffer is not drained in time.

### EC-3: Evented workflow cron timer leak on dispose
- **Affected task:** T11.2
- **Family:** Resource
- **Scenario:** `workflow.evented({ schedule: "*/5 * * * *" })` creates a `Croner` instance internally. If the workflow is abandoned (reference dropped) without calling `.stop()` or `.dispose()`, the cron timer keeps firing on a GC'd workflow, leaking memory and potentially executing stale callbacks.
- **Impact:** Memory leak + phantom executions in long-running processes.
- **Suggested fix:** Implement `[Symbol.dispose]()` on `EventedWorkflowExecutor` that calls `croner.stop()`. Add a FinalizationRegistry fallback as defense-in-depth (log WARN if GC triggers before explicit dispose).

## SHOULD TEST

### EC-4: Provider catalog — `Theokit.registerProvider` called twice with same ID
- **Affected task:** T10.1
- **Suggested test:** `test_registerProvider_duplicate_id_throws` — calling `Theokit.registerProvider({ id: "custom" })` twice with the same ID must throw `ConfigurationError({code: "provider_already_registered"})` instead of silently overwriting.

### EC-5: RAG text splitter with empty/single-char input
- **Affected task:** T11.1
- **Suggested test:** `test_splitRecursive_empty_string_returns_empty_array` — `splitRecursive("", { chunkSize: 100 })` returns `[]`, not `[""]` or throws. Also: `splitRecursive("x", { chunkSize: 100 })` returns `[{text: "x"}]`.

### EC-6: RAG retriever with zero results
- **Affected task:** T11.1
- **Suggested test:** `test_vectorRetriever_returns_empty_when_no_match` — `retrieve("query about quantum physics")` on an index containing only cooking recipes returns `[]` with no error, not undefined or throw.

### EC-7: TheoKitContainer `.run()` with disposed agent
- **Affected task:** T11.3
- **Suggested test:** `test_container_run_after_agent_disposed_throws_AgentDisposedError` — if the agent returned by `container.agent("name")` has been `.dispose()`'d, a subsequent `container.run("name", input)` throws `AgentDisposedError` (from existing error hierarchy, T1.6 in the sister plan), not a generic error.

### EC-8: Server adapter SSE stream — client disconnect mid-stream
- **Affected task:** T12.2
- **Suggested test:** `test_hono_sse_stream_client_disconnect_cleans_up` — when the HTTP client disconnects during an SSE stream, the adapter must abort the agent's `AbortSignal`, close the stream, and not leak sockets. Verify via `response.on('close', ...)` callback.

## DOCUMENT

### EC-9: Voice interface — audio format compatibility across browsers
- **Accepted risk:** The `VoiceProvider` interface defines `textToSpeech(text, opts)` returning an audio buffer, but different browsers support different audio codecs (Opus, PCM, AAC). The plan ships one adapter (OpenAI Realtime) which uses Opus — but the interface itself doesn't enforce a codec negotiation step. This is acceptable for v1: the adapter documents its output format, and consumers handle transcoding. Interface revision is noted in R4 (plan Drawbacks).

### EC-10: Provider catalog staleness — models retire, capabilities change
- **Accepted risk:** The JSON catalog is a snapshot. Models deprecate (e.g., `gpt-4-turbo` → `gpt-4o`), capabilities evolve (vision support added post-launch). Stale entries won't crash (capability flags are conservative — false negative, not false positive), but users may miss newly available features. `last_verified` date per entry (R3 mitigation) is the escape hatch. A CI job checking provider API documentation quarterly is deferred to a follow-up task.

### EC-11: E2E tests with real-LLM — cost accumulation in CI
- **Accepted risk:** `real-llm-full-flow.e2e.test.ts` is gated by `OPENROUTER_API_KEY`, but if accidentally run in CI with the key set on every push, cost accumulates (~$0.01/run × 50 pushes/day = ~$15/month). Acceptable because: (a) the test is `skipIf` gated, (b) CI config controls which env vars are exposed, (c) the sister plan (T0.2) already addresses this with nightly-only scheduling for real-LLM tests.

### EC-12: Templates assume `@theokit/sdk` is published at specific version
- **Accepted risk:** Templates reference `@theokit/sdk` as a dependency in their `package.json`. If the plan's new features (RAG, voice, server/adapter) are in `develop` but not yet published to npm, templates won't work for external users. Acceptable because templates are shipped alongside the SDK release — they won't be `create-theokit`-available until the promote cohort (~2026-07-15).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T10.1 | 3 | 1 (EC-1) | 1 (EC-4) | 1 (EC-10) |
| T10.2 | 0 | 0 | 0 | 0 |
| T10.3 | 1 | 1 (EC-2) | 0 | 0 |
| T11.1 | 2 | 0 | 2 (EC-5, EC-6) | 0 |
| T11.2 | 1 | 1 (EC-3) | 0 | 0 |
| T11.3 | 1 | 0 | 1 (EC-7) | 0 |
| T11.4 | 1 | 0 | 0 | 1 (EC-11) |
| T12.1 | 1 | 0 | 0 | 1 (EC-12) |
| T12.2 | 1 | 0 | 1 (EC-8) | 0 |
| T12.3 | 1 | 0 | 0 | 1 (EC-9) |
| T13.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 3 MUST FIX items must be absorbed as sub-tasks before `/implement`.
