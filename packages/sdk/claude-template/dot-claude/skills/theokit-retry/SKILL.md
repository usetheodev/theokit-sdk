---
user-invocable: false
paths:
  - "**/*retry*"
  - "**/*Retry*"
description: TheoKit SDK retry primitive — @theokit/sdk/retry (Retry.create executor with exponential backoff + full jitter, RetryOptions)
---

# TheoKit Retry

`@theokit/sdk/retry` exposes one primitive: `Retry`. NOTE — `Retry.create` is an
EXECUTOR, not a constructor. `Retry.create(fn, opts)` RUNS `fn` with retry/backoff and
resolves to its result (`Promise<T>`) — it does not return a `Retry` instance.

```typescript
import { Retry, type RetryOptions } from "@theokit/sdk/retry";
```

## Run a fn with retry

Exponential backoff with full jitter. The default `isRetryable` predicate is the SDK's
own `isTransientError`, so retries follow the SDK's error classification (rate-limit /
network retry; business-rule violations do not).

```typescript
const data = await Retry.create(() => fetchJson(url));
// retries transient failures up to 3 times (4 attempts total), then throws the last error
```

## Tuning with `RetryOptions`

All fields are optional; defaults shown in comments.

```typescript
const result = await Retry.create(
  () => callFlakyApi(),
  {
    retries: 5,               // retries AFTER the first attempt (default 3)
    initialDelayMs: 200,      // base backoff for the first retry (default 100)
    maxDelayMs: 10_000,       // cap per single sleep (default 30_000)
    backoffMultiplier: 2,     // exponential multiplier per retry (default 2)
    isRetryable: (err) => err instanceof NetworkGlitch, // default: isTransientError
    signal: controller.signal, // aborts the backoff loop when triggered
  } satisfies RetryOptions,
);
```

`rng` and `sleep` are also injectable — override them for deterministic tests (no real
timers). When retries are exhausted or the error is not retryable, `Retry.create`
re-throws the last error.
