---
user-invocable: false
paths:
  - "**/*error*"
  - "**/*Error*"
  - "**/*exception*"
description: TheoKit SDK error hierarchy — TheokitAgentError, error codes, retry patterns
---

# TheoKit Error Handling

All SDK errors extend `TheokitAgentError`. Use `isRetryable` to drive
retry/backoff logic without coupling to specific subclasses.

## Error hierarchy

```
Error
+-- TheokitAgentError
|   +-- AuthenticationError
|   +-- RateLimitError
|   +-- ConfigurationError
|   |   +-- IntegrationNotConnectedError
|   +-- NetworkError
|   +-- UnknownAgentError
|
+-- UnsupportedRunOperationError   (separate hierarchy)
+-- AgentRunError                  (thrown by Agent.prompt with throwOnError)
```

## Error reference

| Error | When | `isRetryable` |
|---|---|---|
| `AuthenticationError` | Invalid API key, not logged in, insufficient permissions | `false` |
| `RateLimitError` | Too many requests or usage limits exceeded | `true` |
| `ConfigurationError` | Invalid model, bad request parameters, malformed options | `false` |
| `IntegrationNotConnectedError` | Cloud agent for a repo whose SCM is not connected | `false` |
| `NetworkError` | Service unavailable, timeout, transport failure | `true` |
| `UnknownAgentError` | Catch-all for unclassified errors | `false` |
| `UnsupportedRunOperationError` | Runtime does not support a `Run` operation | n/a |
| `AgentRunError` | Run finished with error status (only with `throwOnError: true`) | n/a |

## `TheokitAgentError` properties

```typescript
class TheokitAgentError extends Error {
  readonly isRetryable: boolean;
  readonly code?: string;
  readonly protoErrorCode?: string;
  readonly cause?: unknown;
  readonly metadata?: ErrorMetadata;  // v1.3+ provider HTTP errors
}
```

## `ErrorMetadata` (v1.3+)

When an error originates from a provider HTTP call:

```typescript
interface ErrorMetadata {
  provider: string;          // "anthropic" | "openai" | "openrouter" | ...
  endpoint: string;          // "/v1/messages" | "/v1/chat/completions"
  code: ErrorCode;
  statusCode?: number;
  retryAfter?: number;       // seconds
  raw?: unknown;             // raw response body (truncated ~2KB)
}

type ErrorCode =
  | "rate_limit" | "auth_failed" | "invalid_request"
  | "timeout" | "server_error" | "context_too_long"
  | "content_filtered" | "model_unavailable"
  | "network" | "unknown";
```

## Retry pattern

```typescript
import { TheokitAgentError, type Run } from "@theokit/sdk";

async function withRetry(send: () => Promise<Run>, attempts = 3): Promise<Run> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await send();
    } catch (err) {
      lastError = err;
      if (err instanceof TheokitAgentError && err.isRetryable) {
        await new Promise((r) => setTimeout(r, 2 ** i * 1000));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
```

## Using metadata for programmatic handling

```typescript
try {
  await agent.send("...");
} catch (err) {
  if (err instanceof TheokitAgentError && err.metadata) {
    switch (err.metadata.code) {
      case "rate_limit":
        await wait(err.metadata.retryAfter ?? 60);
        return retry();
      case "auth_failed":
        throw new Error(`Check API key for ${err.metadata.provider}`);
      case "context_too_long":
        // trigger prompt compression
        break;
    }
  }
  throw err;
}
```

## `IntegrationNotConnectedError`

```typescript
import { IntegrationNotConnectedError } from "@theokit/sdk/errors";

try {
  await Agent.create({ /* cloud with disconnected repo */ });
} catch (err) {
  if (err instanceof IntegrationNotConnectedError) {
    console.error(`Connect ${err.provider} at ${err.helpUrl}`);
  }
}
```

## `UnsupportedRunOperationError`

Check before calling runtime-dependent operations:

```typescript
if (run.supports("conversation")) {
  const turns = await run.conversation();
} else {
  console.log(run.unsupportedReason("conversation"));
}
```

## Tree-shaking

Import error classes from the `/errors` subpath to avoid pulling the full SDK:

```typescript
import { TheokitAgentError, RateLimitError } from "@theokit/sdk/errors";
```

## `throwOnError` on `Agent.prompt`

```typescript
import { Agent, AgentRunError } from "@theokit/sdk";

try {
  const result = await Agent.prompt("hi", {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: { id: "claude-sonnet-4-5-20250929" },
    throwOnError: true,
  });
} catch (err) {
  if (err instanceof AgentRunError && err.code === "auth_failed") {
    // bad API key
  }
}
```
