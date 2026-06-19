import { join } from "node:path";

import { openSqliteResilient } from "@theokit/sdk/internal/persistence";

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
 * Iter 65 (Stage 3 source-move #22): hybrid copy from sdk-core's
 * `internal/memory/index-db.ts`. sdk-core retains its copy for v1.x
 * sqlite-vec back-compat; sdk-memory ships the canonical copy that
 * future `sqlite-vec-loader`, `vec-index`, `index-manager` moves
 * will compose with. Dependency chain (all resolved):
 * - `@theokit/sdk/errors` for `ConfigurationError` (public)
 * - `@theokit/sdk/internal/persistence` for `applyWalWithFallback`
 *   (ADR D63 — NFS/SMB/FUSE-safe WAL adoption)
 * - sibling `./index-schema.js` for SCHEMA + PRAGMA statements (moved iter 49)
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
  /** SQLite `pragma()` access (used by `applyWalWithFallback`). */
  pragma(statement: string, options?: { simple?: boolean }): unknown;
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
  return openSqliteResilient<MemoryDb>({
    filePath: opts.filePath,
    label: "memory-index",
    recoverCorrupt: opts.recoverCorrupt,
    onOpen: (db) => {
      // PRAGMA + SCHEMA run after WAL is applied (handled by openSqliteResilient).
      for (const pragma of PRAGMA_STATEMENTS) db.exec(pragma);
      for (const stmt of SCHEMA_STATEMENTS) db.exec(stmt);
    },
  });
}

export function defaultIndexPath(cwd: string): string {
  return join(cwd, ".theokit", "memory", ".index", "memory.sqlite");
}
