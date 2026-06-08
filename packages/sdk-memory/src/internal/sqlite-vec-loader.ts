import { ConfigurationError } from "@theokit/sdk/errors";

/**
 * **Iter 66 rollup-plugin-dts workaround** (mirrors iter 48/53/55 pattern).
 * The canonical sdk-core copy imports `MemoryDb` from `./index-db.js`
 * (sibling). In sdk-memory the same interface lives in sibling
 * `./index-db.js` (moved iter 65) but rollup-plugin-dts treeshakes
 * it out of the bundled .d.ts emit because no PUBLIC type reaches it
 * transitively yet — sqlite-vec-loader's signatures would be the
 * first consumer BUT rollup-dts resolves the import BEFORE the
 * loader's exports are bundled into the public emit. Result:
 * "MemoryDb is not exported by src/internal/index-db.ts" build error.
 *
 * Fix: inline a structural mirror of the minimal MemoryDb shape that
 * sqlite-vec-loader actually needs (just `prepare` for the version
 * probe; everything else delegated via the loader's untyped
 * dynamic-import call to sqlite-vec's native `load`). Mirror is
 * narrower than the canonical contract on purpose — this file's
 * runtime never touches exec/close/pragma/loadExtension directly.
 * When a future move turns MemoryDb into a publicly-reachable type
 * through a different path (e.g. vec-index.ts surfacing the interface
 * from its own typed signatures), this mirror MUST be deleted +
 * the canonical import restored.
 *
 * @internal
 */
interface MemoryDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): Array<Record<string, unknown>>;
  };
  pragma(statement: string, options?: { simple?: boolean }): unknown;
  close(): void;
  loadExtension(path: string): void;
}

/**
 * Load the `sqlite-vec` extension into an opened SQLite connection.
 *
 * Wraps the native `load(db)` call from the `sqlite-vec` npm package with a
 * typed error path (EC-8 of the edge-case review) so callers see a
 * `sqlite_vec_unavailable` ConfigurationError instead of a raw native error.
 *
 * Iter 66 (Stage 3 source-move #23): hybrid copy from sdk-core's
 * `internal/memory/sqlite-vec-loader.ts`. sdk-core retains its copy
 * for v1.x sqlite-vec back-compat; sdk-memory ships the canonical
 * copy that future `vec-index.ts` move will compose with as a
 * sibling. Dependency chain (all resolved):
 * - `@theokit/sdk/errors` for `ConfigurationError` (public)
 * - sibling `./index-db.js` for `MemoryDb` (moved iter 65)
 *
 * @internal
 */
export async function loadSqliteVecExtension(db: MemoryDb): Promise<void> {
  try {
    const mod = await import("sqlite-vec");
    const loadFn = (mod as { load?: (db: unknown) => void }).load;
    if (typeof loadFn !== "function") {
      throw new Error("sqlite-vec module exposes no `load` export");
    }
    loadFn(db);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ConfigurationError(
      `sqlite-vec extension unavailable. Install \`sqlite-vec\` and ensure the native binary matches your Node + OS. Cause: ${message}`,
      { code: "sqlite_vec_unavailable", cause },
    );
  }
}

/** Check whether sqlite-vec is loaded by running a tiny version query. */
export function isSqliteVecLoaded(db: MemoryDb): boolean {
  try {
    const row = db.prepare("SELECT vec_version() as v").get();
    return row !== undefined && row.v !== undefined;
  } catch {
    return false;
  }
}
