---
"@theokit/sdk": patch
---

Fix (#58) — `JobQueue.cancel()` on a running job that ignores its `AbortSignal` (never settles) previously leaked its concurrency slot, deadlocking a `maxConcurrency`-bounded queue. Cancel now frees the slot immediately; `#release` is idempotent so the job's eventual settle is a no-op (no double-free).
