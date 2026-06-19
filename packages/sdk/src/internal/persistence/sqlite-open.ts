/**
 * Resilient SQLite open (plan m0-foundation-expose-primitives, M0-5).
 *
 * Generalizes the driver-load + WAL-apply + corruption-recovery logic that was
 * duplicated (byte-identical) across `sdk/internal/memory/index-db.ts` and
 * `sdk-memory/internal/index/index-db.ts`. Schema-agnostic: the caller applies
 * its own PRAGMA/SCHEMA via the `onOpen` callback.
 *
 * Corruption recovery (EC-7): when opening fails with a "malformed" / "not a
 * database" / "encrypted" error and `recoverCorrupt` is not false, the file is
 * renamed aside to `<path>.corrupt-<ts>` (plus its WAL/SHM siblings) and a fresh
 * DB is opened. The corrupt file is renamed, NOT backed up — the timestamped
 * `.corrupt-*` file is kept for manual recovery.
 *
 * @internal — public via `@theokit/sdk/internal/persistence` (semver-exempt)
 */

import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

import { ConfigurationError } from "../../errors.js";
import { applyWalWithFallback } from "./sqlite-wal.js";

/** Minimal SQLite handle surface every driver (`better-sqlite3`) exposes. */
export interface ResilientSqliteDb {
  /** SQLite `pragma()` access (used by `applyWalWithFallback`). */
  pragma(statement: string, options?: { simple?: boolean }): unknown;
  exec(sql: string): void;
  close(): void;
}

export interface OpenSqliteResilientOptions<T extends ResilientSqliteDb> {
  /** Absolute path to the SQLite file. Parent directories are created. */
  filePath: string;
  /**
   * Called after the driver is open and WAL is applied, before the handle is
   * returned. Apply PRAGMA/SCHEMA statements here. Errors propagate.
   */
  onOpen?: (db: T) => void | Promise<void>;
  /** Label used in the WAL-fallback warning and corruption-recovery log. Default "sqlite". */
  label?: string;
  /** When true (default) a corruption error renames the file aside and rebuilds. */
  recoverCorrupt?: boolean;
}

/**
 * Open a SQLite file with WAL (+ DELETE fallback) and corruption recovery.
 *
 * @typeParam T - the concrete DB handle type the driver returns (defaults to the
 *   minimal {@link ResilientSqliteDb} surface)
 */
export async function openSqliteResilient<T extends ResilientSqliteDb = ResilientSqliteDb>(
  options: OpenSqliteResilientOptions<T>,
): Promise<T> {
  await mkdir(dirname(options.filePath), { recursive: true });
  try {
    return await openConcrete(options);
  } catch (cause) {
    if (options.recoverCorrupt !== false && isCorruptionError(cause)) {
      await renameAside(options.filePath, options.label ?? "sqlite");
      return await openConcrete(options);
    }
    throw cause;
  }
}

async function openConcrete<T extends ResilientSqliteDb>(
  options: OpenSqliteResilientOptions<T>,
): Promise<T> {
  const db = await loadDriver<T>(options.filePath);
  // Apply WAL with NFS/SMB/FUSE fallback BEFORE schema so the journal mode is
  // set for the whole session.
  applyWalWithFallback(db, options.label ?? "sqlite");
  await options.onOpen?.(db);
  return db;
}

async function loadDriver<T extends ResilientSqliteDb>(filePath: string): Promise<T> {
  try {
    const mod = await import("better-sqlite3");
    const Ctor = mod.default ?? mod;
    return new (Ctor as new (path: string) => unknown)(filePath) as T;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ConfigurationError(
      `Failed to load SQLite driver. Install \`better-sqlite3\` or run on Node 22.5+ for built-in \`node:sqlite\`. Cause: ${message}`,
      { code: "sqlite_driver_unavailable", cause },
    );
  }
}

/** True when an open error indicates an unreadable / corrupt database file. */
export function isCorruptionError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const msg = cause.message.toLowerCase();
  return (
    msg.includes("malformed") ||
    msg.includes("not a database") ||
    msg.includes("encrypted") ||
    msg.includes("disk image is malformed")
  );
}

async function renameAside(filePath: string, label: string): Promise<void> {
  const asidePath = `${filePath}.corrupt-${Date.now()}`;
  await rename(filePath, asidePath).catch(() => undefined);
  await rename(`${filePath}-wal`, `${asidePath}-wal`).catch(() => undefined);
  await rename(`${filePath}-shm`, `${asidePath}-shm`).catch(() => undefined);
  process.stderr.write(
    `[theokit-sdk] ${label} database corrupt; renamed aside to ${asidePath} and rebuilt schema\n`,
  );
}
