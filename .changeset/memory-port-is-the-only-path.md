---
"@theokit/sdk": minor
---

The `MemoryProvider` port is now the only memory path. `THEOKIT_PORT_MEMORY_PATH`
is gone, and the adapter over the built-in memory runs by default; a
consumer-supplied `memoryProvider` still takes precedence.

No typed API was removed — the flag was internal and never appeared in your
TypeScript types — but three behaviours change:

- **Recalled memory is now escaped before it reaches the model.** The port path
  concatenated the recall summary into the system prompt raw, while the assembly
  pipeline has always wrapped it as `<active-memory>` with XML escaping. A recalled
  fact containing `</active-memory>` could close the block early and have everything
  after it read as a system instruction. Both paths now wrap and escape.
- **Memory tools receive the run's abort signal and transcript projection.** They
  arrive through the same channel as your own tools, so a long memory search is now
  cancellable with the run.
- **`.theokit/memory` is no longer created by a send that never reaches the agent
  loop** — a fixture-mode send with a `theo_test_*` key used to leave an empty
  SQLite index behind. Real runs are unchanged: the index is created and searchable
  exactly as before.
