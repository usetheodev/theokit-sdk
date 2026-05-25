# Component — `errors` (BASELINE 2026-05-25)

Single file: `packages/sdk/src/errors.ts` (337 lines).

## Classes

| Class | Constructor sig | isRetryable | code shape |
|---|---|---|---|
| `TheokitAgentError` | `(msg, { isRetryable, code, protoErrorCode, cause, metadata })` | configurable | `string` opaque |
| `AuthenticationError` | extends TKE, isRetryable=false | false | string |
| `RateLimitError` | extends TKE, isRetryable=true | true | string |
| `ConfigurationError` | extends TKE, isRetryable=false | false | string |
| `IntegrationNotConnectedError` | extends ConfigurationError + provider/helpUrl | false | string |
| `NetworkError` | extends TKE, isRetryable=true | true | string |
| `UnknownAgentError` | extends TKE, isRetryable=false | false | string |
| `AgentRunError` | extends TKE, isRetryable=false; + provider, raw | false | string (Phase 3 → AgentRunErrorCode) |
| `UnsupportedRunOperationError` | extends TKE, isRetryable=false; + operation | false | "unsupported_run_operation" |
| `CredentialPoolExhaustedError` | extends TKE, isRetryable=true; + provider, nextRetryAt | true | "credential_pool_exhausted" |
| `MemoryAdapterError` | extends TKE; + adapterId | code-dependent | `MemoryAdapterErrorCode` |

## Public types

- `ErrorCode` (10 values) — used by mappers via `metadata.code`
- `ErrorMetadata { provider, endpoint, code, statusCode?, retryAfter?, raw? }`
- `MemoryAdapterErrorCode` (6 values)
