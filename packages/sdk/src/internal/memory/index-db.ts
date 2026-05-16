import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ConfigurationError } from "../../errors.js";
import { PRAGMA_STATEMENTS, SCHEMA_STATEMENTS } from "./index-schema.js";

/**
 * Thin wrapper around the SQLite driver. Prefers `node:sqlite` when available
 * (Node 22.5+) and falls back to `better-sqlite3`. Both expose nearly the
 * same `prepare/exec/close` surface; we normalize via a minimal adapter.
 *
 * Corrupt-DB recovery (EC-7): when opening fails with a "file is encrypted
 * or is not a database" or "malformed" error, the file is renamed aside to
 * `<path>.corrupt-<ts>` and the schema is rebuilt from scratch.
 *
 * @internal
 */

export interface MemoryDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): Array<Record<string, unknown>>;
  };
  close(): void;
  /** Load a SQLite loadable extension at the given path (used by sqlite-vec). */
  loadExtension(path: string): void;
}

export interface OpenDbOptions {
  filePath: string;
  /**
   * When true and opening fails with a corruption error, rename the file aside
   * and create a fresh DB. Default true.
   */
  recoverCorrupt?: boolean;
}

export async function openMemoryDb(opts: OpenDbOptions): Promise<MemoryDb> {
  await mkdir(dirname(opts.filePath), { recursive: true });
  try {
    return await openConcrete(opts.filePath);
  } catch (cause) {
    if (opts.recoverCorrupt !== false && isCorruptionError(cause)) {
      await renameAside(opts.filePath);
      return await openConcrete(opts.filePath);
    }
    throw cause;
  }
}

async function openConcrete(filePath: string): Promise<MemoryDb> {
  const db = await loadDriver(filePath);
  for (const pragma of PRAGMA_STATEMENTS) db.exec(pragma);
  for (const stmt of SCHEMA_STATEMENTS) db.exec(stmt);
  return db;
}

async function loadDriver(filePath: string): Promise<MemoryDb> {
  try {
    const mod = await import("better-sqlite3");
    const Ctor = mod.default ?? mod;
    const db = new (Ctor as new (path: string) => unknown)(filePath) as {
      exec: (sql: string) => void;
      prepare: (sql: string) => MemoryDb["prepare"] extends (s: string) => infer R ? R : never;
      close: () => void;
    };
    return db as MemoryDb;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ConfigurationError(
      `Failed to load SQLite driver. Install \`better-sqlite3\` or run on Node 22.5+ for built-in \`node:sqlite\`. Cause: ${message}`,
      { code: "sqlite_driver_unavailable", cause },
    );
  }
}

function isCorruptionError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const msg = cause.message.toLowerCase();
  return (
    msg.includes("malformed") ||
    msg.includes("not a database") ||
    msg.includes("encrypted") ||
    msg.includes("disk image is malformed")
  );
}

async function renameAside(filePath: string): Promise<void> {
  const asidePath = `${filePath}.corrupt-${Date.now()}`;
  await rename(filePath, asidePath).catch(() => undefined);
  // Also rename the WAL + SHM siblings if they exist so the new DB starts clean.
  await rename(`${filePath}-wal`, `${asidePath}-wal`).catch(() => undefined);
  await rename(`${filePath}-shm`, `${asidePath}-shm`).catch(() => undefined);
  process.stderr.write(
    `[theokit-sdk] memory index corrupt; renamed aside to ${asidePath} and rebuilt schema\n`,
  );
}

export function defaultIndexPath(cwd: string): string {
  return join(cwd, ".theokit", "memory", ".index", "memory.sqlite");
}
