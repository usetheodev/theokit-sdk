# D77 — Loader: MD-dir first, JSON fallback with deprecation warn

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D74, D78, plan `markdown-config-migration-plan.md`

## Decision

Each of the 3 loaders (hooks, context, plugin manifest) tries the
markdown directory first; if empty or absent, falls back to the legacy
JSON file with a **one-time stderr deprecation warn**. If BOTH exist, MD
wins and a different warn says "remove the JSON".

Deprecation timeline:

- **v1.5** — warn (current).
- **v2.0 (planned Q2 2027)** — JSON loader removed; users must migrate
  via `theokit-migrate-config` before v2.0 ships.

## Rationale

Zero breaking change in v1.x. Users with `.theokit/hooks.json` today
continue to work; they just see one deprecation line on each loader
call (deduped per process via `warnOnce`). The warn explicitly names
the CLI to run for migration.

Mirrors the pattern from D54 (OAuth token cached only) — graceful
fallback when the primary path is absent.

Alternatives rejected:

- **Hard cutover at v1.5** — would break every user's config on update.
- **Silent JSON support forever** — defeats the migration purpose;
  warns are the social contract.

## Consequences

- Enables migration in the user's own window. A user can run
  `theokit-migrate-config` whenever convenient between v1.5 and v2.0.
- Constrains: loader is slightly more complex (2 paths). Mitigated by
  shared `loadHookConfig` / `loadContextConfig` / per-folder check
  pattern — each surface has one fallback function, not duplicated
  inline at every callsite.
- Constrains: warn dedup is per-process. Spawned workers (cron,
  subagent) re-emit. Aceitável — 1 warn per process boot, not per
  call.
