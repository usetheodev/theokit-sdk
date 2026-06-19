import { join } from "node:path";

import { openSqliteResilient } from "../persistence/sqlite-open.js";
import { PRAGMA_STATEMENTS, SCHEMA_STATEMENTS } from "./index-schema.js";

/**
 * Memory index DB handle + opener.
 *
 * M0-5 (plan m0-foundation-expose-primitives): the driver-load + WAL +
 * corruption-recovery (EC-7) plumbing is now the shared `openSqliteResilient`
 * primitive in `internal/persistence`; this module only declares the memory
 * schema application (PRAGMA + SCHEMA) via its `onOpen` callback.
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
