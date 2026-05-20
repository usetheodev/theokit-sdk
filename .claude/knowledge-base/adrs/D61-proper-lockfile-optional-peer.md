# ADR D61 — Cross-process file lock via `proper-lockfile` optional peer dep

Date: 2026-05-18
Status: Accepted
Plan: [persistence-state-hardening](../plans/persistence-state-hardening-plan.md)

## Decision

`packages/sdk/src/internal/persistence/file-lock.ts` exports
`withFileLock(path, fn, options?)` which:

1. Lazy-imports `proper-lockfile` via dynamic `import()`. If present, takes a
   cross-process OS-level lock using a **companion lockfile** at `<path>.lock`
   with `realpath: false`. The companion-file approach allows locking on
   paths that do not exist yet (lock-then-create pattern) — EC-1 fix from the
   edge-case-plan review.
2. Wraps the cross-process acquire inside `withCwdMutex` so multiple
   in-process callers queue rather than colliding with proper-lockfile's
   "Lock file is already being held" same-process error.
3. If `proper-lockfile` is missing (peer dep not installed), falls back to
   `withCwdMutex` only (in-process serialization). Logs a one-shot stderr
   warning.

`proper-lockfile` is declared in `packages/sdk/package.json` as an OPTIONAL
peer dependency with `peerDependenciesMeta.proper-lockfile.optional: true`.

## Rationale

- `proper-lockfile` is the de-facto Node lock helper (4M+ downloads/week,
  maintained by moxystudio). It abstracts `fcntl`/`msvcrt` and handles
  stale-lock detection.
- Some target environments (Vercel Edge, Cloudflare Workers) cannot install
  the peer dep. Graceful in-process fallback keeps the SDK usable there.
- Hermes uses the same companion-lockfile pattern (`~/.hermes/cron/.tick.lock`,
  `~/.hermes/skills/.usage.json.lock`).

## Alternatives considered

- **Require proper-lockfile as a hard dep**: rejected — forces every SDK
  consumer to install it even when they have a single-process deployment.
- **Roll our own fcntl wrapper**: rejected — proper-lockfile handles the
  stale-lock and platform-detection edge cases we'd have to re-discover.
- **Lock the data file directly (no companion)**: rejected — fails with
  `ENOENT` when the target file doesn't exist yet, which is the common
  "lock then create" pattern (registry.json on fresh install).

## Consequences

- Consumers who need cross-process safety run `pnpm add proper-lockfile`.
- Consumers in edge sandboxes get a soft warning and reduced semantics; this
  is intentional and documented.
- The companion lockfile `<path>.lock` is owned by `proper-lockfile`. Tests
  must clean their tmpdirs.
- In-process callers queue via `withCwdMutex` even when proper-lockfile is
  present (combined serialization) — required to avoid proper-lockfile's
  same-process re-entry error.
