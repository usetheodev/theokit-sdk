---
"@theokit/sdk": minor
---

Conversation persistence is now batched, cross-process-safe, and paginated (#63).

- **Batch turn append:** `ConversationStorageAdapter.appendMessages(id, messages[])` writes a whole turn (user + assistant + N tool results) in ONE atomic write instead of N separate `mkdir` + `appendFile` cycles. The default FS adapter and the in-memory adapter both implement it; the single `appendMessage` now delegates to the batch of one.
- **Cross-process atomicity:** FS append and compaction now hold the same `proper-lockfile` cross-process lock (falls back to an in-process mutex when `proper-lockfile` is absent). Two Node processes sharing a cwd (CLI + daemon, parallel workers) can no longer tear a >4KB JSONL line or drop a line in the compaction read→rename window.
- **Pagination:** `getMessages(id, { offset, limit })` returns a bounded window so a caller hydrating a long history need not materialize the whole log (omit `opts` for the previous full read — backward-compatible). The in-memory adapter reads a true bounded slice; the FS/JSONL adapter bounds the materialized result (a future SQLite backend would bound the read itself).

No new dependency (`proper-lockfile` was already declared).
