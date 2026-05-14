# Error handling

All SDK errors extend `TheokitAgentError`. Use `isRetryable` to drive retry/backoff logic without coupling to specific subclasses.

## The error class hierarchy

```
Error
└── TheokitAgentError
    ├── AuthenticationError
    ├── RateLimitError
    ├── ConfigurationError
    │   └── IntegrationNotConnectedError
    ├── NetworkError
    └── UnknownAgentError

Error
└── UnsupportedRunOperationError   (separate hierarchy — not retryable, not a TheokitAgentError)
```

| Error | When | `isRetryable` |
| --- | --- | --- |
| `AuthenticationError` | Invalid API key, not logged in, insufficient permissions | `false` |
| `RateLimitError` | Too many requests or usage limits exceeded | `true` |
| `ConfigurationError` | Invalid model, bad request parameters, malformed options | `false` |
| `IntegrationNotConnectedError` | Cloud agent for a repo whose SCM provider is not connected (carries `provider` and `helpUrl`) | `false` |
| `NetworkError` | Service unavailable, timeout, transport-level failure | `true` |
| `UnknownAgentError` | Catch-all for unclassified errors | `false` |
| `UnsupportedRunOperationError` | A `Run` operation is not available on the current runtime | n/a |

## Retry pattern

```typescript
import { TheokitAgentError, type Run } from "@usetheo/sdk";

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

## Inspecting a `TheokitAgentError`

```typescript
class TheokitAgentError extends Error {
  readonly isRetryable: boolean;
  readonly code?: string;
  readonly protoErrorCode?: string;
  readonly cause?: unknown;
}
```

- `code` — stable SDK-level code (e.g., `"INVALID_MODEL"`).
- `protoErrorCode` — backend protocol error code, when available.
- `cause` — the underlying error (per ES2022 `Error.cause`).

## `IntegrationNotConnectedError`

```typescript
import { IntegrationNotConnectedError } from "@usetheo/sdk/errors";

try {
  await Agent.create({ /* cloud with disconnected repo */ });
} catch (err) {
  if (err instanceof IntegrationNotConnectedError) {
    console.error(
      `Connect ${err.provider} at ${err.helpUrl} to use this repo.`,
    );
  }
}
```

`provider` is the SCM name (e.g., `"github"`, `"gitlab"`, `"azuredevops"`). `helpUrl` is the dashboard link to reconnect.

## `UnsupportedRunOperationError`

Some `Run` operations are runtime-dependent. Check first:

```typescript
if (run.supports("conversation")) {
  const turns = await run.conversation();
} else {
  console.log(run.unsupportedReason("conversation"));
}
```

`UnsupportedRunOperationError` does NOT extend `TheokitAgentError` — it's a programming error, not an operational one.

## Tree-shaking

Import error classes from the `/errors` subpath if you don't need the rest of the SDK:

```typescript
import {
  TheokitAgentError,
  RateLimitError,
  AuthenticationError,
} from "@usetheo/sdk/errors";
```

## Next

- [Resource management](./resource-management.md) — disposing agents when errors happen
- [Stream events](../concepts/stream-events.md) — errors that surface during streaming
