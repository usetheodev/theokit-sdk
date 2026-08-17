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

import { diag } from "../diagnostics.js";
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
let warnedStructural = false;
/** Why the import failed, kept so the warning can report the observation instead of a guess (#174). */
let loadFailure: unknown;

/** Node reports a missing module as `ERR_MODULE_NOT_FOUND` (ESM loader) or `MODULE_NOT_FOUND` (CJS). */
function isModuleAbsent(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/**
 * #174 — build the fallback warning from what actually happened.
 *
 * This used to always read "proper-lockfile not installed", because the import was wrapped in a
 * bare `catch` that discarded the error (Unbreakable Rule 8: a swallowed error is the dangerous
 * kind). A consumer whose package WAS installed, declared and resolvable spent a debugging session
 * re-verifying the install, because the message named a cause the code had never checked.
 *
 * Absence is now the only case that claims absence. Every other failure — a broken install, an
 * interop problem, a bundler that rewrote the specifier — reports its own code and message, which
 * is what points at the real cause.
 *
 * @internal
 */
function describeLockLoadFailure(err: unknown): string {
  const consequence =
    "cross-process file lock unavailable — concurrent processes over the same file are NOT serialized.";
  if (isModuleAbsent(err)) {
    return `[theokit-sdk] proper-lockfile not installed; ${consequence} Install with: pnpm add proper-lockfile\n`;
  }
  const code = (err as { code?: unknown } | null | undefined)?.code;
  const detail = err instanceof Error ? err.message : String(err);
  return (
    `[theokit-sdk] proper-lockfile could not be loaded${code !== undefined ? ` (${String(code)})` : ""}: ` +
    `${detail}. ${consequence} The package resolves for the SDK but failed to load — check bundling ` +
    "and module-format interop before re-checking the install.\n"
  );
}

/** Test seam for the message builder — NOT in the public barrel. @internal */
export function __TESTING__describeLockLoadFailure(err: unknown): string {
  return describeLockLoadFailure(err);
}

async function getProperLockfile(): Promise<ProperLockfileModule | null> {
  if (cached !== undefined) return cached;
  try {
    const mod = await import("proper-lockfile");
    // T5.9 — supply-chain hardening: validate the imported module
    // exposes the API surface we depend on BEFORE caching it. A
    // tampered or incompatible version that lacks `lock`/`unlock`
    // functions gets treated as "not installed" with an advisory
    // warning — never silently used.
    if (!validateLockModule(mod)) {
      if (!warnedStructural) {
        warnedStructural = true;
        diag(
          "[theokit-sdk] proper-lockfile: imported module does NOT expose " +
            "the expected `lock`/`unlock` API surface. This may indicate a " +
            "supply-chain compromise or an incompatible major version. " +
            "Falling back to in-process mutex (no cross-process safety). " +
            "Reinstall with: pnpm add proper-lockfile@^11\n",
        );
      }
      cached = null;
      return cached;
    }
    cached = mod as ProperLockfileModule;
  } catch (err) {
    // #174 — keep WHY. Discarding it here is what made the fallback warning assert a cause it had
    // never observed, and sent a consumer to re-check an install that was already correct.
    loadFailure = err;
    cached = null;
  }
  return cached;
}

/**
 * T5.9 — Structural validation of the dynamically-imported
 * `proper-lockfile` module. Verifies the API surface we depend on
 * (`lock` and `unlock` as functions) is present. Pure function —
 * never throws, never mutates, never performs I/O.
 *
 * Exported via `__TESTING__validateLockModule` seam so unit tests
 * can drive the check without spinning up the dynamic import.
 *
 * @internal
 */
function validateLockModule(mod: unknown): boolean {
  if (mod === null || mod === undefined || typeof mod !== "object") return false;
  const m = mod as Record<string, unknown>;
  return typeof m.lock === "function" && typeof m.unlock === "function";
}

/**
 * T5.9 — Test seam: expose the structural validator for unit tests.
 * NOT included in the public barrel.
 *
 * @internal
 */
export function __TESTING__validateLockModule(mod: unknown): boolean {
  return validateLockModule(mod);
}

/**
 * T5.9 — Test seam: reset the module cache + warning flags between
 * tests so each test starts fresh. NOT included in the public barrel.
 *
 * @internal
 */
export function __TESTING__resetFileLockCache(): void {
  cached = undefined;
  warnedMissing = false;
  warnedStructural = false;
  loadFailure = undefined;
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
 */
export async function withFileLock<T>(
  path: string,
  fn: () => Promise<T>,
  options?: FileLockOptions,
): Promise<T> {
  const lib = await getProperLockfile();

  if (lib === null) {
    // #174 — stay silent when the structural check already explained itself. Emitting "not
    // installed" on top of "does not expose lock/unlock" would be two contradictory diagnoses of
    // one failure, and the reader has no way to tell which is true.
    if (!warnedMissing && !warnedStructural) {
      warnedMissing = true;
      diag(describeLockLoadFailure(loadFailure));
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
