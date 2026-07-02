---
"@theokit/sdk": minor
---

Cancellation now actually interrupts in-flight work, tools get a per-call timeout, and the job queue is bounded (#58).

- `JobQueue` runs each job under an `AbortController` whose signal is passed to the job fn, so `cancel(id)` interrupts a cooperative running job instead of only flipping a status flag. A new `maxConcurrency` option bounds how many jobs run at once (omit for the previous unbounded behavior; values < 1 clamp to 1). The job fn signature is now `(signal: AbortSignal) => Promise<T>` — existing `() => Promise<T>` callers are unaffected (the signal is simply ignored).
- Tool dispatch threads the run's `AbortSignal` into each tool handler and bounds each tool call with an optional per-tool timeout (`SendOptions.perToolTimeoutMs`) (via `AbortSignal.any([runSignal, AbortSignal.timeout(ms)])`), so cancelling a run interrupts a running tool and a hung tool rejects a typed timeout instead of wedging the loop; the loop also checks for cancellation between iterations. All stdlib (Node ≥22.12) — no new dependency.
