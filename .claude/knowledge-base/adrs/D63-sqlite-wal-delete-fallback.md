# ADR D63 — SQLite WAL with DELETE journal fallback on NFS/SMB/FUSE

Date: 2026-05-18
Status: Accepted
Plan: [persistence-state-hardening](../plans/persistence-state-hardening-plan.md)

## Decision

`internal/persistence/sqlite-wal.ts` exports
`applyWalWithFallback(db, label)`. It tries `PRAGMA journal_mode = WAL`;
if the pragma either:

- returns a value other than `wal` (some FUSE/SMB drivers return DELETE or
  MEMORY silently), OR
- throws (NFS without lock support),

…then it falls back to `PRAGMA journal_mode = DELETE`. A one-shot stderr
warning fires per `label` so the user knows their performance profile is
the compatibility-first mode.

The helper runs BEFORE schema statements so the journal mode is in effect
for the entire session. `MemoryDb` interface now exposes `pragma()` so the
helper can call it without an unsafe cast.

## Rationale

- WAL gives concurrent readers + one writer + better crash recovery.
- NFS/SMB users are a minority but are NOT a niche on shared dev machines
  and HPC clusters. Crashing on `PRAGMA journal_mode=WAL` is a sharp,
  cryptic failure mode (`SQLITE_IOERR` with no hint about the cause).
- Hermes shipped exactly this pattern in `hermes_state.py:128-183` after
  multiple production reports of NFS HOME failures.

## Consequences

- All SQLite connections in the SDK route through `applyWalWithFallback`.
  `index-schema.ts` PRAGMA_STATEMENTS no longer includes `journal_mode=WAL`
  (moved into the helper); only `synchronous=NORMAL` and `foreign_keys=ON`
  remain.
- The warn-once-per-label registry leaks across tests if not reset; tests
  use the `_resetWalWarnings()` helper exposed for that purpose.
- DELETE-mode performance is slightly slower on concurrent access; we
  accept that for the affected users.
