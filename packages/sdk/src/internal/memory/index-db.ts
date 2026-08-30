import { join } from "node:path";

import { openSqliteResilient } from "../persistence/sqlite-open.js";
import { PRAGMA_STATEMENTS, SCHEMA_STATEMENTS } from "./index-schema.js";
import type { MemoryRoot } from "./storage/memory-root.js";

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

/**
 * `<index root>/.index/memory.sqlite`. Pure path computation.
 *
 * Takes a resolved root rather than a `cwd`: this function used to spell the default layout out
 * again as a string literal — an answer to "where does memory live?" that no search for the shared
 * helper would have found (#463).
 *
 * **The root it is given is the PROJECT store, even when the facts move.** `memory.directory` may
 * point at the directory the Claude Code CLI manages, and that CLI has no index format — putting a
 * binary artefact it does not understand inside a directory it owns is a different decision from
 * putting the facts there, and it was made deliberately. The facts are what a user would lose; the
 * index is derived and rebuildable from them. See `docs/memory-decisions.md` § 1 before relocating
 * this, and `IndexManager.openSqliteInternal` for the caller that keeps the two apart.
 */
export function defaultIndexPath(root: MemoryRoot): string {
  return join(root, ".index", "memory.sqlite");
}
