# ADR D62 — Schema versioning helpers (SQLite `user_version` + JSON envelope)

Date: 2026-05-18
Status: Accepted
Plan: [persistence-state-hardening](../plans/persistence-state-hardening-plan.md)

## Decision

Two parallel APIs in `internal/persistence/schema-version.ts`:

1. **SQLite**: `migrateSchema({ db, currentVersion, migrations })` reads
   `PRAGMA user_version`, sorts migrations by `toVersion`, runs the pending
   ones inside a single transaction, bumps the pragma after each migration's
   `up` callback. Forward-only — throws on `stored > currentVersion`
   (downgrade attempt).

2. **JSON**: `readVersionedJson` / `writeVersionedJson` use a wrapper shape
   `{ _schemaVersion: N, data: T }`. The migrate callback receives the FULL
   parsed object (not just `.data`), so legacy shapes without the wrapper
   (e.g., the pre-D62 `{ schemaVersion: "1.0", agents: {...} }` registry)
   can be migrated correctly — this is the EC-2 fix from the edge-case-plan
   review.

## Rationale

- `PRAGMA user_version` is the idiomatic SQLite versioning channel (single
  32-bit integer per database, no extra table).
- The JSON envelope mirrors the SQLite pattern conceptually but in a
  filesystem-readable shape: humans can `cat` the file and see the version.
- Forward-only avoids the "delete data on downgrade" footgun. Users who
  downgrade get a fail-safe (default value) and a stderr warning instead
  of silent data loss.
- The full-parsed migrate callback unlocks transparent upgrades from any
  legacy shape; without it, legacy `{ schemaVersion, agents }` files would
  appear empty after the v1.3 upgrade (real data loss bug).

## Consequences

- `agent-registry-store.ts` migrates from ad-hoc `SCHEMA_VERSION = "1.0"`
  (string) to the standard envelope (`_schemaVersion: 1`). Legacy on-disk
  files are read transparently and rewritten in the new shape on next save.
- Golden tests `agent-registry-persistence.golden.test.ts` and
  `resume-regressions.golden.test.ts` were updated to assert the new envelope.
- Future DBs (kanban, checkpoints, autonomous skills) reuse `migrateSchema`
  rather than each inventing its own version field.
