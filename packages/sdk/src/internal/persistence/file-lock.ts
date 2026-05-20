/**
 * Cross-process file lock helper (ADR D61).
 *
 * Uses `proper-lockfile` (optional peer dep) for cross-process locks. When
 * the peer dep is absent, falls back to `withCwdMutex` (in-process only)
 * with a one-shot stderr warning.
 *
 * EC-1 fix: uses a companion `<path>.lock` file with `realpath: false` so
 * `withFileLock` works even when the target `path` does not exist yet.
 * Without this, fresh installs that lock-then-create would crash with ENOENT.
 *
 * @internal
 */

import { withCwdMutex } from "./cwd-mutex.js";

interface ProperLockfileModule {
  lock: (file: string, options: ProperLockfileOptions) => Promise<() => Promise<void>>;
}

interface ProperLockfileOptions {
  lockfilePath?: string;
  realpath?: boolean;
  stale?: number;
  retries?: {
    retries: number;
    factor?: number;
    minTimeout?: number;
    maxTimeout?: number;
  };
}

let cached: ProperLockfileModule | null | undefined;
let warnedMissing = false;

async function getProperLockfile(): Promise<ProperLockfileModule | null> {
  if (cached !== undefined) return cached;
  try {
    cached = (await import("proper-lockfile")) as ProperLockfileModule;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Options for `withFileLock`.
 *
 * @internal
 */
export interface FileLockOptions {
  /** Stale lock timeout in ms. Default 30_000 (30s). */
  stale?: number;
  /** Max retries on busy lock. Default 5. */
  retries?: number;
  /** Backoff factor between retries. Default 1.5. */
  retryFactor?: number;
}

/**
 * Run `fn` while holding an OS-level cross-process lock on `path`.
 *
 * If `proper-lockfile` is installed, uses it with a companion `<path>.lock`
 * file (`realpath: false`, so target file does NOT need to exist yet).
 * Otherwise falls back to in-process `withCwdMutex` and prints a one-shot
 * stderr warning telling the user to install `proper-lockfile` for
 * cross-process safety.
 *
 * The lock is released even when `fn` throws.
 *
 * @internal
 */
export async function withFileLock<T>(
  path: string,
  fn: () => Promise<T>,
  options?: FileLockOptions,
): Promise<T> {
  const lib = await getProperLockfile();

  if (lib === null) {
    if (!warnedMissing) {
      warnedMissing = true;
      process.stderr.write(
        "[theokit-sdk] proper-lockfile not installed; " +
          "cross-process file lock unavailable. " +
          "Install with: pnpm add proper-lockfile\n",
      );
    }
    return withCwdMutex(`file-lock:${path}`, fn);
  }

  // proper-lockfile errors immediately on same-process concurrent acquire
  // ("Lock file is already being held"). Wrap with cwd-mutex first so
  // in-process callers queue and only ONE thread at a time enters the
  // cross-process acquire path. Combined: full in-process + cross-process
  // serialization.
  return withCwdMutex(`file-lock:${path}`, async () => {
    const release = await lib.lock(path, {
      // EC-1: companion lockfile, target path may not exist yet.
      lockfilePath: `${path}.lock`,
      realpath: false,
      stale: options?.stale ?? 30_000,
      retries: {
        retries: options?.retries ?? 5,
        factor: options?.retryFactor ?? 1.5,
        minTimeout: 100,
        maxTimeout: 5_000,
      },
    });

    try {
      return await fn();
    } finally {
      await release();
    }
  });
}

/**
 * Test helper — resets the cached proper-lockfile module + warning flag.
 * Allows tests to simulate "module absent" by clearing cache then
 * monkey-patching the dynamic import resolution.
 *
 * @internal
 */
export function _resetFileLockCacheForTesting(): void {
  cached = undefined;
  warnedMissing = false;
}
