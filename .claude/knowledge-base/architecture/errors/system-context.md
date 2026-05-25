# System Context — `errors` domain (BASELINE 2026-05-25)

## Boundary

```
Caller catch(err)
   │
   ▼
TheokitAgentError (base — errors.ts)
   ├── AuthenticationError
   ├── RateLimitError
   ├── ConfigurationError (→ IntegrationNotConnectedError)
   ├── NetworkError
   ├── UnknownAgentError
   ├── AgentRunError              ← Phase 3 expands
   ├── UnsupportedRunOperationError
   ├── CredentialPoolExhaustedError
   └── MemoryAdapterError

mappers (internal/errors/mappers/)
   ├── shared.ts          (Retry-After parsing, ~80 lines)
   ├── anthropic.ts
   ├── openai-compatible.ts   ← Phase 3 expands: invalid_model, quota_exceeded
   ├── bedrock.ts
   ├── vertex.ts
   ├── ollama.ts
   └── index.ts (barrel)
```

## Current ErrorCode union (10 values)

`rate_limit | auth_failed | invalid_request | timeout | server_error | context_too_long | content_filtered | model_unavailable | network | unknown`

Phase 3 adds: `quota_exceeded | tool_runtime_error | aborted | invalid_model | safety_blocked | provider_unreachable`.

Final union (`AgentRunErrorCode`): superset of `ErrorCode` + 3-4 net-new codes (some overlap: `safety_blocked` ≈ `content_filtered`, `provider_unreachable` ≈ `network|timeout|server_error`).
