---
type: Error Reference
title: AgentRunError code reference
description: The canonical AgentRunError.code union plus the provider-to-code mapping for OpenAI, Anthropic, Vertex, Bedrock and Ollama.
resource: https://github.com/usetheodev/theokit-sdk/blob/main/wiki/reference/error-codes.md
tags: [errors, providers, retry, shipped-to-npm]
generated: { by: human:paulohenriquevn, at: 2026-08-05T00:00:00Z }
status: stable
sources:
  - id: mappers
    resource: packages/sdk/src/internal/error-mappers/
    title: Per-provider mapping implementations — the authoritative list
  - id: adrs
    resource: ADRs D311-D314, D65-D68
    title: Error-system architecture decisions
---

# `@theokit/sdk` Error Codes Reference

Canonical reference for `AgentRunError.code` values + provider-to-code mapping (Production-Readiness #3, ADRs D311-D314).

## `AgentRunErrorCode` union (16 codes)

| Code | Origin | Retriable | When |
|---|---|:---:|---|
| `auth_failed` | provider HTTP 401/403 | no | bad API key, revoked token |
| `rate_limit` | provider HTTP 429 | **yes** | back off using `retryAfterMs` |
| `quota_exceeded` | provider HTTP 402 / billing body code | no | billing limit hit |
| `invalid_request` | provider HTTP 400 (generic) | no | malformed payload |
| `invalid_model` | provider HTTP 400 + "model not found" | no | model id wrong/unavailable |
| `context_too_long` | provider 400 + context_length code | no | input exceeds model window |
| `content_filtered` | provider safety filter | no | safety filter blocked |
| `safety_blocked` | provider safety filter (alias) | no | reserved for stricter mapping |
| `model_unavailable` | provider 400 + model_unavailable code | no | model temporarily unavailable |
| `timeout` | HTTP 408 | **yes** | retry with backoff |
| `network` | DNS/TCP/transport | **yes** | retry with backoff |
| `server_error` | HTTP 5xx | **yes** | retry with backoff |
| `provider_unreachable` | DNS/TCP/timeout/5xx (alias) | **yes** | reserved for stricter mapping |
| `tool_runtime_error` | tool handler throw inside dispatch | no | bug in handler |
| `aborted` | `AbortSignal` fired (Phase 4) | no | user/lifecycle cancel |
| `unknown` | unmapped | no | provider returned shape we don't recognize |

## Exhaustive `switch` pattern

```ts
import { AgentRunError } from "@theokit/sdk";

try {
  await agent.send(message);
} catch (err) {
  if (!(err instanceof AgentRunError)) throw err;
  switch (err.code) {
    case "auth_failed":
      // bad key — show login UI
      break;
    case "rate_limit":
      if (err.retryAfterMs !== undefined) {
        setTimeout(retry, err.retryAfterMs);
      }
      break;
    case "quota_exceeded":
      // billing — upsell page
      break;
    case "tool_runtime_error":
      // handler bug — log + tell user
      break;
    case "aborted":
      // user cancelled — no UI noise
      break;
    default:
      // unknown / new code — generic fallback
      break;
  }
}
```

## Provider mapping table

### OpenAI (and OpenAI-compat: OpenRouter, DeepSeek, Together, Mistral, Voyage, DeepInfra)

| Status | Body hint | → ErrorCode | → AgentRunErrorCode |
|---|---|---|---|
| 401 / 403 | any | `auth_failed` | `auth_failed` |
| 429 | any | `rate_limit` | `rate_limit` |
| 402 | any | `invalid_request` | `quota_exceeded` (at AgentRunError layer) |
| 400 | `code: "context_length_exceeded"` | `context_too_long` | `context_too_long` |
| 400 | `code: "content_policy_violation"` | `content_filtered` | `content_filtered` |
| 400 | `code: "model_not_found"` | `model_unavailable` | `model_unavailable` |
| 400 | `code: "insufficient_quota"` | `invalid_request` | `quota_exceeded` |
| 400 | other | `invalid_request` | `invalid_request` |
| 408 | any | `timeout` | `timeout` |
| 5xx | any | `server_error` | `server_error` |
| other | any | `unknown` | `unknown` |

### Anthropic

Same status-based map as OpenAI. Body code hints are dialect-specific (`overloaded_error` → `server_error`, etc.) — see `internal/error-mappers/anthropic.ts` for the authoritative list.

### Vertex AI

| GCP status | Canonical | Code |
|---|---|---|
| `429` / `RESOURCE_EXHAUSTED` | `RateLimitError` | `rate_limit` |
| `401` / `UNAUTHENTICATED` | `AuthenticationError` | `auth_failed` |
| `403` / `PERMISSION_DENIED` | `AuthenticationError` | `auth_failed` |
| `400` / `INVALID_ARGUMENT` | `ConfigurationError` | `invalid_request` |
| `408` / `DEADLINE_EXCEEDED` | `NetworkError` | `timeout` |
| `5xx` | `NetworkError` | `server_error` |
| other | `UnknownAgentError` | `unknown` |

### Bedrock

| AWS status / type | Canonical | Code |
|---|---|---|
| 429 / `ThrottlingException` | `RateLimitError` | `rate_limit` |
| 401/403 / `AccessDeniedException` | `AuthenticationError` | `auth_failed` |
| 400 / `ValidationException` | `ConfigurationError` | `invalid_request` |
| 5xx | `NetworkError` | `server_error` |

### Ollama (local)

| Failure mode | Code |
|---|---|
| Connection refused | `network` |
| Timeout | `timeout` |
| Unknown response | `unknown` |

Ollama has no billing, no rate limit, no auth → `quota_exceeded`/`rate_limit`/`auth_failed` never fire.

## Fields

```ts
class AgentRunError extends TheokitAgentError {
  readonly code: AgentRunErrorCode;
  readonly provider?: string;
  readonly raw?: string;
  readonly requestId?: string;      // x-request-id / request-id header
  readonly conversationId?: string; // SDK agentId where error fired

  get retriable(): boolean;          // alias for isRetryable
  get retryAfterMs(): number | undefined;  // metadata.retryAfter * 1000
  get providerError(): unknown;       // metadata.raw alias

  readonly metadata?: ErrorMetadata;  // full structured context
}
```

## `retryAfterMs` semantics

Returns milliseconds derived from `metadata.retryAfter` (seconds). Use with `setTimeout`:

```ts
if (err.retryAfterMs !== undefined) {
  setTimeout(retry, err.retryAfterMs);
}
```

**EC-11: Use `=== undefined` check, NOT truthy check.** `retryAfterMs === 0` is a legitimate value (provider asked for immediate retry — `setTimeout(0)` is valid).

## Anti-leak invariant

`AgentRunError.message` NEVER contains `providerError` content (raw response body may carry sensitive data — internal field names, log fragments, etc). To inspect the raw body:

```ts
console.log(err.providerError);    // alias for err.metadata?.raw
console.log(err.metadata?.raw);    // same value (already redacted via D68)
```

The redacted body is safe to log — `redactSecrets` strips known secret patterns (API keys, JWT, Authorization headers).

## See also

- `internal/error-mappers/` — per-provider mapping implementations
- ADRs D311-D314, D65-D68 (the broader error system)
- [Capability map](./harness-capability-map.md) — where the error classes are exported from

In the wiki: [failure taxonomy](../sdk/failure-taxonomy.md) turns these codes into a
response policy (retry vs fail-fast), and [run signals](../sdk/run-signals.md) places
`error` among the seven ways a run can end.
