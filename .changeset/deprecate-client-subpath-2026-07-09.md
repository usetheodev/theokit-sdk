---
"@theokit/sdk": patch
---

Deprecate the `@theokit/sdk/client` sub-path (`TheoKitClient`).

`TheoKitClient` consumes a legacy server-adapter HTTP contract (`POST /agent/send`, `GET /agent/stream`) that the ecosystem no longer produces — the framework (`theokit`) exposes agents at `POST /api/agents/<name>` over a `UIMessageStream` with its own typed client, and the SDK's own in-process path is the `Agent` façade. The sub-path has zero consumers across the monorepo (evidence-based dead-code review, 2026-07-09).

Marked `@deprecated` (class + barrel + types). No behavior change — the sub-path still works this major. It will be **removed in the next major**. Migrate to `Agent` (`@theokit/sdk`) for in-process runs, or the framework's `/api/agents/<name>` typed client for HTTP.
