# Architecture Diff — `runtime` domain (POST-IMPLEMENTATION 2026-05-25)

Production-Readiness plan delivered. Compare against baseline at `.claude/knowledge-base/architecture/runtime/` (captured T0.1).

## Inventory delta

| Container | Baseline | Post-plan | Delta |
|---|---:|---:|---:|
| `internal/runtime/` .ts files | 74 | 76 | +2 |
| `internal/persistence/` .ts files | 12 | 14 | +2 |

### New files in `internal/runtime/`

- `live-agent-registry.ts` (Phase 2, ADRs D307-D310) — LRU + idle GC cache for live SDKAgent instances
- `abort-utils.ts` (Phase 4, ADR D324) — `anySignal` ponyfill + `abortReasonAsError`

### New files in `internal/persistence/`

- `conversation-storage-fs.ts` (Phase 1, ADR D304) — FileSystemConversationStorage adapter wrapping pre-D303 JSONL writes
- `conversation-storage-memory.ts` (Phase 1, ADR D304) — InMemoryConversationStorage for tests + ephemeral dev

## Public API surface added

- `ConversationStorageAdapter` interface + `StoredMessage` type (Phase 1)
- `InMemoryConversationStorage`, `FileSystemConversationStorage` classes (Phase 1)
- `AgentOptions.conversationStorage?` (Phase 1)
- `Agent.registry` static (LiveAgentRegistry singleton, Phase 2)
- `AgentRegistryOptions`, `EvictReason`, `LiveAgentRegistry` types (Phase 2)
- `AgentRunErrorCode` union (Phase 3) — 16 codes
- `AgentRunError.requestId`, `.conversationId` fields; `.retriable`, `.retryAfterMs`, `.providerError` getters (Phase 3)
- `AgentOptions.onToolStart/End/Error` (Phase 5)
- `AgentOptions.onBeforeCreate/onBeforeSend` (Phase 6)
- `AgentRunError code: "aborted"` (Phase 4)

## Modified files

| File | Phase | Change |
|---|---|---|
| `agent.ts` | 1,2,3,6 | + `Agent.registry`, `getOrCreateUncached`, `rehydrateExistingAgent` extracted, onBeforeCreate wiring, conversationStorage option, strict resume |
| `agent-session.ts` | 1 | refactored to consume `ConversationStorageAdapter`; backcompat `cwd: string` overload preserved |
| `agent-session-store.ts` | 1 | + `PersistedSessionMessage.role` widened to 5 roles, `readAllPersistedMessages`, `appendAnyPersistedMessage` |
| `agent-registry.ts` | 1 | + `requiresCustomStorage` marker field |
| `agent-registry-store.ts` | 1 | + serialize/deserialize marker |
| `local-agent.ts` | 1,4,6 | + `conversationStorage` field, `#lifecycleAbortController`, `storageHandle()`, signal compose, onBeforeSend wiring |
| `post-run-lifecycle.ts` | 1 | + `storageHandle` param, dispatched to `appendSessionMessage` |
| `local-agent-personality-extensions.ts` | 1 | + `storageHandle` param threaded through |
| `real-local-run.ts` | 4,5 | + forward `sendOptions.signal` + `onToolStart/End/Error` to `AgentLoopInputs` |
| `agent-loop/loop.ts` | 4 | + `inputs.signal` used in `streamLlmTurn`; collector loop catches abort + emits `[aborted]` marker |
| `agent-loop/loop-types.ts` | 4,5 | + `signal?: AbortSignal`, `onToolStart/End/Error` on `AgentLoopInputs` |
| `agent-loop/tool-dispatch.ts` | 5 | + `safeEmitToolHook` wrapper around dispatch (start/end/error pair, callId reuse, durationMs) |
| `tool-dispatch/dispatch.ts` | 3 | + `DispatchResult.errorCode` (tool_runtime_error / invalid_request / unknown) |
| `errors.ts` | 3 | + `AgentRunErrorCode`, new fields + getters on `AgentRunError`; `defaultRetriableForCode` helper |
| `errors/mappers/openai-compatible.ts` | 3 | + 402 + insufficient_quota → invalid_request → quota_exceeded at AgentRunError layer |
| `errors/mappers/shared.ts` | 3 | + `parseRequestId` helper |
| `types/agent.ts` | 1,2,5,6 | + `conversationStorage`, `onToolStart/End/Error`, `onBeforeCreate/Send` |
| `index.ts` | 1,2,3 | + 10 new exports |

## Architecture invariants verified

- I1 backward compat: all new options opt-in; existing examples (telegram-pro, slack-bot, whatsapp-bot, email-bot, teams-bot, vertex-bot, bedrock-bot, handoffs, workflows, cache, eval, skills-google-workspace) compile + run unmodified
- I2 real-LLM validation: 3 new examples (conversation-storage, abort-mid-stream, tool-hooks-tracking) ran with OPENROUTER_API_KEY against `openai/gpt-4o-mini`
- I3 no stubs: zero new `*_not_implemented` or `MockX/FakeX/StubX` exports
- I6 dogfood: telegram-pro 44/44 PASS + 1 SKIP (env-gated honcho)
- I9 redaction: FS adapter delegates through `redactSecrets`; test pins
- I10 `pnpm validate`: green (post-zod-v4 fix)

## Phase 7 conclusion

The implementation domain is materially the same shape as the baseline — the 4 new files extend existing patterns (Map cache, adapter interface) without introducing new architectural primitives. The system-context and container diagrams in the baseline remain accurate; only the inventory + public surface expanded.
