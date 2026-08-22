---
"@theokit/sdk-cache": minor
---

The `"json"` persistence backend now keeps the promise it was sold on.

`Cache.ready()` — which the code's own comment referred to long before it existed — resolves once
the snapshot has been read, and `consult` / `remember` await hydration themselves, so a lookup
issued right after construction no longer races the read and misses an entry that is on disk.

`Cache.flush()` writes the debounced snapshot and keeps every entry. Writes are debounced 200ms, so
a once-per-invocation CLI — the process this backend exists for — used to persist nothing unless it
happened to live longer, and `clear()` was the only public call that forced a write. Nothing
flushes on teardown: call `flush()` before exiting.

Two caches built with the same `dir` and `namespace` now share one store instead of each writing a
full snapshot and erasing the other's entries. The first construction's `maxEntries` applies.
