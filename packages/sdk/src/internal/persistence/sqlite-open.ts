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
import { diag } from "../diagnostics.js";
import { applyWalWithFallback } from "./sqlite-wal.js";

/** Minimal SQLite handle surface every driver (`better-sqlite3`) exposes. */
export interface ResilientSqliteDb {
  /** SQLite `pragma()` access (used by `applyWalWithFallback`). */
  pragma(statement: string, options?: { simple?: boolean }): unknown;
  exec(sql: string): void;
  close(): void;
}

/**
 * Input to {@link openSqliteResilient}.
 *
 * The trap is `recoverCorrupt`, whose default is ON. When the driver reports a corrupt or encrypted
 * database, the file is renamed aside and a FRESH one is opened — so the call SUCCEEDS and hands
 * back an EMPTY database. The old bytes survive on disk under the renamed path, but a caller that
 * treats a resolved promise as "my data is here" is wrong exactly when it matters. Pass
 * `recoverCorrupt: false` to get the corruption error thrown instead.
 *
 * Semver-exempt: reachable via the '@theokit/sdk/internal/persistence' sub-path, which the package
 * declares in 'exports' but does NOT cover with its semver contract.
 *
 * @typeParam T - the concrete DB handle the driver returns; defaults to {@link ResilientSqliteDb}
 */
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

/** Injectable driver loaders (tests simulate a consumer env without better-sqlite3). */
interface DriverLoaders {
  betterSqlite3?: () => Promise<unknown>;
  nodeSqlite?: () => Promise<unknown>;
}
let driverLoaderOverrides: DriverLoaders | undefined;

/** Test-only. @internal */
export function _setDriverLoadersForTests(overrides: DriverLoaders | undefined): void {
  driverLoaderOverrides = overrides;
}

/**
 * Adapt `node:sqlite`'s `DatabaseSync` to the better-sqlite3 surface this module's callers use
 * (`prepare/get/all/run`, `exec`, `close`, `pragma`, `loadExtension`). The error message below has
 * ALWAYS promised this fallback ("or run on Node 22.5+ for built-in node:sqlite") — before the
 * flicker-bug fix the promise was fabricated: only better-sqlite3 was ever tried, so every consumer
 * without the optional native dep lost memory tools AND got a per-turn stderr WARN.
 */
function adaptNodeSqlite(db: {
  prepare(sql: string): unknown;
  exec(sql: string): void;
  close(): void;
  loadExtension?: (path: string) => void;
}): ResilientSqliteDb {
  const pragma = (statement: string, options?: { simple?: boolean }): unknown => {
    const stmt = db.prepare(`PRAGMA ${statement}`) as {
      get(): Record<string, unknown> | undefined;
    };
    const row = stmt.get();
    if (options?.simple === true) {
      return row === undefined ? undefined : Object.values(row)[0];
    }
    return row === undefined ? [] : [row];
  };
  return new Proxy(db as unknown as ResilientSqliteDb, {
    get(target, prop, receiver) {
      if (prop === "pragma") return pragma;
      // Reached by `sqlite-vec`'s own `load()`, not by anything in this package — see the member's
      // docblock on `MemoryDb`. `loadSqliteVecExtension` catches this and re-throws it as a
      // ConfigurationError with code `sqlite_vec_unavailable`, so a bare Error never escapes.
      if (prop === "loadExtension" && typeof db.loadExtension !== "function") {
        return () => {
          throw new Error(
            "SQLite extension loading is unavailable on the node:sqlite fallback — install better-sqlite3 for sqlite-vec",
          );
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

// PRE-EXISTING debt, exposed when M75 fixed the Biome config that used to abort before
// sweeping these files (a nested root under refactor/). It is not new code and was not touched
// by M75; refactoring SDK internals without review would trade a visible problem for a diff
// risky. Tracked in usetheodev/theokit-sdk#151.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: see the reason just above
async function loadDriver<T extends ResilientSqliteDb>(filePath: string): Promise<T> {
  let betterSqliteCause: unknown;
  try {
    const mod = (await (driverLoaderOverrides?.betterSqlite3?.() ?? import("better-sqlite3"))) as {
      default?: unknown;
    };
    const Ctor = mod.default ?? mod;
    if (typeof Ctor !== "function") {
      throw new Error(`better-sqlite3 export is not a constructor (got ${typeof Ctor})`);
    }
    return new (Ctor as new (path: string) => unknown)(filePath) as T;
  } catch (cause) {
    betterSqliteCause = cause;
  }
  // Fallback: the Node 22.5+ built-in driver (the path the error message documents).
  // `process.getBuiltinModule` (Node 22.3+) instead of `import("node:sqlite")` — bundlers that
  // predate the sqlite builtin rewrite the import specifier to a bare "sqlite" package (proven in
  // the published dist: "Cannot find package 'sqlite'"), while getBuiltinModule is opaque to them.
  try {
    const mod = (await (driverLoaderOverrides?.nodeSqlite?.() ??
      Promise.resolve(
        (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.(
          "node:sqlite",
        ) ??
          (() => {
            throw new Error("node:sqlite built-in unavailable (Node < 22.3)");
          })(),
      ))) as {
      DatabaseSync: new (
        path: string,
      ) => {
        prepare(sql: string): unknown;
        exec(sql: string): void;
        close(): void;
      };
    };
    return adaptNodeSqlite(new mod.DatabaseSync(filePath)) as T;
  } catch (nodeSqliteCause) {
    const b =
      betterSqliteCause instanceof Error ? betterSqliteCause.message : String(betterSqliteCause);
    const n = nodeSqliteCause instanceof Error ? nodeSqliteCause.message : String(nodeSqliteCause);
    throw new ConfigurationError(
      `Failed to load SQLite driver. Install \`better-sqlite3\` or run on Node 22.5+ for built-in \`node:sqlite\`. better-sqlite3: ${b}; node:sqlite: ${n}`,
      { code: "sqlite_driver_unavailable", cause: nodeSqliteCause },
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
  diag(
    `[theokit-sdk] ${label} database corrupt; renamed aside to ${asidePath} and rebuilt schema\n`,
  );
}
