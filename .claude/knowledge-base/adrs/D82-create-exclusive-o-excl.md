# D82 — `createExclusive` uses O_EXCL with default mode 0o600

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D61, plan `security-block-completion-plan.md`

## Decision

`packages/sdk/src/internal/persistence/exclusive-create.ts` exports
`createExclusive(path, data, { mode })`:

- Opens the path with flag `"wx"` (O_CREAT | O_EXCL | O_WRONLY).
- Default `mode` is `0o600` (owner-only). Callers writing non-sensitive
  files pass `{ mode: 0o644 }` explicitly.
- Returns `true` if the file was created, `false` if it already existed
  (EEXIST swallowed). All other errors propagate.

## Rationale

- O_EXCL is the canonical atomic create-if-absent primitive on POSIX.
  Replaces error-prone `existsSync(path) → writeFile(path)` patterns
  (Hermes v0.4 #2406 #1908 PID file race).
- Default 0o600 prevents the typical UNIX gotcha: 0o666 masked by
  default umask 022 → world-readable 0o644. Token files / lockfiles /
  PID files must NOT be world-readable on multi-user systems
  (EC-2 edge-case review).

NFS / SMB / FUSE filesystems may not honor O_EXCL — same posture as
D61 (`proper-lockfile` + companion lockfile). SDK targets ext4 / APFS /
NTFS for state.

## Consequences

- **Enables:** race-free single-writer creation for PID files,
  lockfiles, schema initializers.
- **Constrains:** caller responsible for parent directory existence
  (helper does not `mkdir -p`).
