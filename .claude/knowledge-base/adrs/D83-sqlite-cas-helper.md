# D83 — `casUpdate` SQLite compare-and-swap helper

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D62, plan `security-block-completion-plan.md`

## Decision

`packages/sdk/src/internal/persistence/sqlite-cas.ts` exports
`casUpdate(db, sql, params, expectedChanges = 1): boolean`:

- Caller supplies the full SQL including `WHERE` predicate that guards
  the version column or other CAS predicate. Helper does NOT generate
  SQL.
- Executes the prepared statement, returns `boolean` based on
  `result.changes === expectedChanges`.
- Caller responsible for retry/backoff (no hidden loops in the helper).

## Rationale

Canonical pattern: Hermes `kanban_db.py:1922-1934` claim_task:
`UPDATE tasks SET status = 'running', claim = ? WHERE id = ? AND status = 'ready' AND claim IS NULL`.
Returns affected rows; 0 means race lost.

Why a helper instead of inlining the pattern at each callsite:

1. Establishes a convention name (`casUpdate`) that future maintainers
   recognize.
2. Documents the contract: caller writes the SQL, helper checks the
   result.
3. Boolean return forces the caller to handle the race-lost case
   explicitly (no exception unwind in a retry loop).

Not opinionated about retry strategy — Hermes uses exponential backoff
in some places, immediate retry in others. SDK lets callers decide.

## Consequences

- **Enables:** optimistic concurrency in any future SQLite-backed store
  (agent registry future migration, cron jobs store, etc.).
- **Constrains:** caller carries the SQL string — not a query builder.
  This is intentional (DRY at the convention level, not the SQL level).
