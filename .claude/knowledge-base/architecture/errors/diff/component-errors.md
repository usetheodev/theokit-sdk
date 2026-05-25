# Architecture Diff — `errors` (POST-IMPLEMENTATION 2026-05-25)

## `errors.ts` (337 → 480 lines)

### New public types

```ts
export type AgentRunErrorCode =
  | ErrorCode                    // 10 existing
  | "quota_exceeded"
  | "tool_runtime_error"
  | "aborted"
  | "invalid_model"
  | "safety_blocked"
  | "provider_unreachable"
  | (string & {})                // forward-compat escape hatch
```

### `AgentRunError` shape delta

| Member | Baseline | Post-plan |
|---|---|---|
| `code` | `string` | `AgentRunErrorCode` |
| `provider` | `string?` | unchanged |
| `raw` | `string?` | unchanged |
| `requestId` | — | **`string?`** NEW |
| `conversationId` | — | **`string?`** NEW |
| `retriable` | — | **`get retriable(): boolean`** NEW (alias for isRetryable) |
| `retryAfterMs` | — | **`get retryAfterMs(): number \| undefined`** NEW |
| `providerError` | — | **`get providerError(): unknown`** NEW (alias for metadata.raw) |
| constructor `retriable` | implicit false | **`retriable?: boolean`** caller override |

### New private helper

```ts
function defaultRetriableForCode(code: AgentRunErrorCode): boolean
```

Returns sensible default for new code values (rate_limit → true, network → true, etc).

## `internal/errors/mappers/` delta

| Mapper | Change |
|---|---|
| `shared.ts` | + `parseRequestId(headers)` helper (parses `x-request-id` / `request-id`) |
| `openai-compatible.ts` | + 402 + `insufficient_quota` body code → `invalid_request` (canonical HTTP→AgentRunErrorCode quota_exceeded happens at construction site) |

Bedrock + Vertex + Anthropic mappers unchanged — they inherit via dialect dispatcher pattern (D291, D292).

## Tests added

- `tests/errors/agent-run-error-fields.test.ts` (20 tests)
- `tests/tool-dispatch/tool-error-code.test.ts` (4 tests)
- `tests/internal/errors/mappers/shared.test.ts` + 5 new `parseRequestId` tests
- `tests/internal/errors/mappers/openai-compatible.test.ts` + 2 new quota tests
