# D368 — Task IDs grammar `^[a-z0-9][a-z0-9_-]*$` + reserved prefixes

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

JsonFileTaskStore writes one file per task: `{dir}/{id}.json`. Without input validation, a caller passing `id = "../../etc/passwd"` writes outside the store. Even with InMemoryStore, IDs leak into telemetry tags and log lines; arbitrary chars complicate observability.

## Decision

- Grammar: `^[a-z0-9][a-z0-9_-]*$` (lowercase alphanumeric + dash + underscore; must start alphanumeric).
- Reserved prefixes: `wf-`, `b-`, `cron-`. User-supplied IDs starting with these prefixes throw `InvalidTaskIdError`.
- Reuses D239 (workflow step ID grammar) and D81 (sanitizeIdentifier).

## Rationale

- Lowercase-only avoids collisions on case-insensitive filesystems (HFS+, NTFS default).
- Reserved prefixes (EC-5) guarantee adapter-generated IDs never collide with user-supplied ones.
- Same pattern as Personality slug (D161, EC-C).

## Consequences

- Auto-generated IDs use `crypto.randomUUID()` — UUID v4 satisfies the grammar.
- Caller migrating from a system with uppercase IDs must lowercase or remap.
- Adapter packages (workflow, batch, cron) are the only legitimate producers of `wf-` / `b-` / `cron-` prefixed IDs.
