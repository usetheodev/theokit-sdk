---
user-invocable: false
description: Bound in-process parallelism with Semaphore.create and mapWithConcurrency from @theokit/sdk/concurrency.
paths:
  - "**/*concurren*"
  - "**/*semaphore*"
  - "**/*Semaphore*"
---

# TheoKit SDK -- Concurrency

In-house concurrency helpers (no `p-limit`/`p-map` dependency). `Semaphore.create(permits)` builds an N-permit async counting gate; `mapWithConcurrency` runs an async mapper over items with bounded parallelism while preserving input order.

## Import

```typescript
import { Semaphore, mapWithConcurrency } from "@theokit/sdk/concurrency";
import type { AsyncSemaphore } from "@theokit/sdk/concurrency";
```

## Signatures

```typescript
class Semaphore {
  static create(permits: number): AsyncSemaphore; // canonical factory (ADR 0015)
}

interface AsyncSemaphore {
  acquire(): Promise<() => void>; // returns a release fn; call it exactly once
  inFlight(): number;             // permits currently held
  pending(): number;              // in-flight + queued waiters
}

function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,                                     // positive integer; validated
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  options?: { signal?: AbortSignal },
): Promise<R[]>; // ordered; fail-fast; throws ConfigurationError on bad concurrency
```

## Semaphore -- release in a finally

```typescript
const sem = Semaphore.create(4); // at most 4 in flight

async function guarded<T>(task: () => Promise<T>): Promise<T> {
  const release = await sem.acquire();
  try {
    return await task();
  } finally {
    release(); // release exactly once (idempotent, but leaking it consumes a permit)
  }
}
```

## mapWithConcurrency -- ordered bounded map

```typescript
const controller = new AbortController();
const results = await mapWithConcurrency(
  ["a", "b", "c"],
  2, // max 2 concurrent fetches
  async (url, _index, signal) => (await fetch(url, { signal })).json(),
  { signal: controller.signal },
);
// results align with input order; rejects on the first task error
```
