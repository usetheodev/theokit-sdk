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
 * NFS sem honor de O_EXCL é documentado (D61 — mesma postura do
 * `withFileLock`); SDK target é ext4/APFS/NTFS.
 *
 * @internal
 */

import { open } from "node:fs/promises";

export interface CreateExclusiveOptions {
  /** Unix mode for the new file (default 0o600 — owner-only). */
  mode?: number;
}

/**
 * Atomically create `path` with `data`. Returns true iff this call
 * created the file (race-free under POSIX-compliant filesystems).
 *
 * @internal
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
