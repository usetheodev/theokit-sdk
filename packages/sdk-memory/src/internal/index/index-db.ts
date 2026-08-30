import { join } from "node:path";

import { openSqliteResilient } from "@theokit/sdk/persistence";
import type { MemoryRoot } from "../store/markdown-store.js";
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
 * - `@theokit/sdk/persistence` for `applyWalWithFallback`
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

/** Options for {@link openMemoryDb}. */
export interface OpenDbOptions {
  filePath: string;
  /**
   * When true and opening fails with a corruption error, rename the file aside
   * and create a fresh DB. Default true.
   */
  recoverCorrupt?: boolean;
}

/**
 * Open (or create) the SQLite memory index at `filePath`, applying the pragmas
 * and creating the schema before returning. Parent directories are created as
 * needed, so pointing this at a fresh workspace works.
 *
 * The driver is chosen at runtime: `node:sqlite` where the running Node exposes
 * it, and `better-sqlite3` otherwise. `better-sqlite3` is an optional peer
 * dependency of this package — on a Node build without `node:sqlite` and
 * without it installed, opening fails.
 *
 * A file that is corrupt, truncated or encrypted is renamed aside to
 * `<path>.corrupt-<timestamp>` and rebuilt empty, unless `recoverCorrupt` is
 * `false`. Recovery loses every indexed chunk; the markdown corpus is the source
 * of truth and the next `sync()` rebuilds from it.
 *
 * Loading the sqlite-vec extension is a separate step — this returns an index
 * that can do text search only.
 */
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
 * `<index root>/.index/memory.sqlite`. Pure path computation. The file sits under a memory root but
 * outside the markdown corpus, so it is never indexed as content.
 *
 * Takes a resolved root rather than a `cwd`: this spelled the default layout out again as a string
 * literal — an answer to "where does memory live?" that no search for the shared helper would have
 * found (#463).
 *
 * **The root it is given is the PROJECT store, even when the facts move.** With `memory.directory`
 * set, memories are written where the Claude Code CLI reads them — the index is not, because that
 * CLI has no index format, and a binary artefact it does not understand does not belong in a
 * directory it manages. The facts are what a user would lose; the index is derived and rebuildable
 * from them. See `packages/sdk/docs/memory-decisions.md` § 1 before relocating this.
 */
export function defaultIndexPath(root: MemoryRoot): string {
  return join(root, ".index", "memory.sqlite");
}
