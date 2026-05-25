# Container Diagram — `errors` (BASELINE 2026-05-25)

| Container | Path | Phase 3 change |
|---|---|---|
| Public hierarchy | `errors.ts` (337 lines) | + `AgentRunErrorCode` union, + 3 getters (retriable/retryAfterMs/providerError), + 2 fields (requestId/conversationId) |
| Provider mappers | `internal/errors/mappers/` | + `quota_exceeded`, `invalid_model` branches; + `requestId` parsing |
| Tool dispatch | `internal/tool-dispatch/dispatch.ts` | + `code: "tool_runtime_error"` on catch |
| Run loop | `internal/runtime/real-local-run.ts` | + wrap abort → `code: "aborted"` |
