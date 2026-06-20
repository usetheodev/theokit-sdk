---
"@theokit/sdk": minor
---

M2-1 — `@theokit/sdk/compaction`: public compaction / context-management helpers (plan `m2-compaction-public-api`).

Promotes the SDK's compaction capability to a public sub-path so consumers can manage the context window without reaching into `internal/`:

- `compactTranscript(messages, { keepRecent = 6, summarize? })` — keep the last `keepRecent` turns verbatim, preserve leading system turns, and either summarize the older window (via an optional `summarize` callback that can wire the SDK's internal LLM summarizer) or drop it. Reuses the internal `selectCompressionWindow` (no second algorithm). Never mutates its input.
- `buildCheckpoint(label?)` / `filterFromLatestCheckpoint(messages)` / `CHECKPOINT_MARKER` — a string-sentinel checkpoint: mark a point in a transcript and later filter back to the turns after the most recent marker.
- `isContextOverflowError(err)` — true iff `err` is a `TheokitAgentError` (or subclass) reporting the typed `context_too_long` code (reads both `err.code` and `err.metadata?.code`; no brittle message regex).

Operates on the SDK's own `CompressibleMessage` type (re-exported). Zero new dependencies.
