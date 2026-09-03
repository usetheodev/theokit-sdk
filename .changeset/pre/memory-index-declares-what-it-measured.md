---
"@theokit/sdk": patch
---

`MemoryIndex.sync()` and `.status()` now say whether their numbers were measured.

`MemoryIndex` has two implementations. `IndexManager` walks a markdown corpus and counts rows with
`SELECT COUNT(*)`. The Lance backend has no corpus — it is a vector store fed by explicit writes —
and it answered with a frozen all-zeros `SyncResult` and a hardcoded `filesIndexed: 0,
chunksIndexed: 0`. Those are indistinguishable from a real sync that found nothing to do and a real
index that is empty, and the comment above them stated that as the goal: *"Returns zero counts so
callers' existing logging does not break."*

The consequence was a false negative rather than a crash. A caller deciding "is the index
populated?" from `chunksIndexed > 0` got `false` on every Lance run, however many rows the table
held.

Two required fields make the difference visible:

- `SyncResult.supported` — `true` from `IndexManager`, `false` from Lance
- `IndexStatus.countsExact` — `true` when counted, `false` when the number is a placeholder

The counts stay zero. Inventing a number would have traded one false claim for another; what changed
is that a caller can no longer read a placeholder as a measurement. Both fields are also on the
public `MemoryIndexHandle`, so a consumer holding the handle can see them. If you need the real Lance
count, `unwrap().countFacts()` still returns it.
