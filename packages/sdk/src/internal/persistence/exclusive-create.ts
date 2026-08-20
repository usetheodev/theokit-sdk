/**
 * O_EXCL exclusive file creation (ADR D82).
 *
 * `createExclusive(path, data, { mode })` creates a file in a single
 * syscall (`open(path, "wx", mode)`). Returns `true` if created, `false`
 * if it already existed (EEXIST swallowed — caller decides). All other
 * errors propagate.
 *
 * Default mode is 0o600 (owner-only) — EC-2 fix from edge-case review:
 * token files, lockfiles, and PID files MUST NOT default to world-
 * readable 0o644 under typical umask 022. Callers writing non-sensitive
 * files can pass `mode: 0o644` explicitly.
 *
 * NFS not honoring O_EXCL is documented (D61 — same stance as
 * `withFileLock`); the SDK target is ext4/APFS/NTFS.
 *
 * @internal
 */

import { open } from "node:fs/promises";

export interface CreateExclusiveOptions {
  /** Unix mode for the new file (default 0o600 — owner-only). */
  mode?: number;
}

/**
 * Create `path` holding `data`, but only if it does not exist yet. Returns `true` when this call
 * created it, `false` when it was already there.
 *
 * The check and the create are one `open(path, "wx")` syscall, so of N processes racing to create
 * the same path exactly one gets `true` — no window between testing and writing. The content is
 * written after the create, so the `false` branch tells you the file exists, not that another
 * writer has finished filling it.
 *
 * Only `EEXIST` becomes `false`. Every other error propagates: a missing parent directory is
 * `ENOENT`, an unwritable one `EACCES`. This never creates directories.
 *
 * The file is created with mode 0600 unless `options.mode` says otherwise, and the mode is
 * subject to the process umask. That default is deliberate — the callers are token files,
 * lockfiles and PID files, and 0644 under a typical umask would make them world-readable.
 *
 * **Choosing between this and the locks.** `createExclusive` claims a NAME once and is the right
 * tool for first-writer-wins: seeding a config, electing a single owner, writing a credential
 * exactly once. It cannot guard repeated updates, because a file that already exists always loses.
 * For read-modify-write on a path several writers touch, take a lock instead —
 * {@link withFileLock} across processes, `withCwdMutex` when the writers are all in this one. For
 * an in-place update guarded by a version column in SQLite, `casUpdate` is the equivalent
 * primitive.
 *
 * Atomicity is the filesystem's `O_EXCL`, which NFS does not reliably honor; the SDK targets
 * ext4, APFS and NTFS.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export async function createExclusive(
  path: string,
  data: string | Uint8Array,
  options?: CreateExclusiveOptions,
): Promise<boolean> {
  const mode = options?.mode ?? 0o600;
  try {
    const handle = await open(path, "wx", mode);
    try {
      await handle.writeFile(data);
      return true;
    } finally {
      await handle.close();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw err;
  }
}
