---
id: D8
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D8 — Cron persistence stays as JSON file with atomic write

## Context
Cron jobs persist to `.theokit/cron/jobs.json`. Open Decision asked whether to migrate to SQLite (crash-recovery + concurrent-process safety) or an append-only log.

## Decision
JSON file with `replaceFileAtomic` (tmp + fsync + rename). No SQLite migration.

## Rationale
- Cron jobs are rarely >100 entries — well under any indexing threshold.
- JSON is human-editable and git-friendly (matches the memory subsystem's markdown-first ethos).
- Atomic writes via tmp+rename already give crash-safety (no partial files).
- Concurrent processes are an anti-pattern for the local runtime — only one scheduler should hold a workspace at a time.
- SQLite for cron jobs is premature optimization.

## Consequences
- JSON schema is locked (matches `CronJob` type in `packages/sdk/src/types/cron.ts`).
- Future migration to SQLite requires explicit ADR superseding D8.
- Concurrent-process safety is documented as out-of-scope for v1.0.

## Alternatives Considered
- **SQLite** — rejected; complexity-vs-benefit unjustified at expected scale.
- **Append-only log** — rejected; replay cost on every read.
