---
"@theokit/sdk": minor
---

SE2 — the typed `RunEvent` stream (`SendOptions.onRunEvent`) now EMITS every declared variant end-to-end (previously only `tool_progress` + `permission_denied` fired; the rest were dead-in-the-sink). Newly wired: `rate_limit` (pool-aware LLM client, on a 429 retry backoff), `compact_boundary` (session auto-compaction boundary), and `task_started`/`task_updated`/`task_completed` (opt-in bridge — `Task.submit(kind, work, { onRunEvent })` forwards the task lifecycle as RunEvents). The sink stays strictly opt-in and fail-safe; no RunEvent is pushed into `Run.stream()`. Documented in docs.md.
