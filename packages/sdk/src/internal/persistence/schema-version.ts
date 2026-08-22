/**
 * Schema versioning helpers (ADR D62).
 *
 * Two parallel APIs:
 *   - `migrateSchema` — SQLite via `PRAGMA user_version` + ordered forward-only migrations.
 *   - `readVersionedJson` / `writeVersionedJson` — JSON files with `_schemaVersion` field.
 *
 * Forward-only: never deletes data, never downgrades. Migration callbacks
 * own the transformation; this module owns the bookkeeping.
 *
 * @internal
 */

import { readFile, rename } from "node:fs/promises";
import { diag } from "../diagnostics.js";
import { atomicWriteJson } from "./atomic-write.js";

// ────────────────────── SQLite migrations ──────────────────────

/**
 * The three `better-sqlite3` methods this module actually uses, declared structurally so nothing
 * here imports the driver.
 *
 * A real `better-sqlite3` `Database` satisfies it. `pragma` is called both to read
 * (`pragma("user_version", { simple: true })`, which must return the number itself rather than a
 * row array) and to write (`pragma("user_version = N")`). `transaction` must return a function
 * that, when called, runs the wrapped body inside a real SQLite transaction and rolls it back if
 * the body throws — a stub that merely calls through gives `migrateSchema` no atomicity, and a
 * half-applied migration is exactly what it exists to prevent.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export interface SqliteLike {
  pragma: (statement: string, options?: { simple?: boolean }) => unknown;
  exec: (sql: string) => void;
  transaction: <Args extends unknown[], R>(fn: (...args: Args) => R) => (...args: Args) => R;
}

/**
 * One forward migration step.
 *
 * `up` runs inside the shared transaction and must be self-contained: it may not commit, and any
 * error it throws aborts the whole run and rolls back every step in it, including the ones that
 * already succeeded. `user_version` is set to `toVersion` immediately after `up` returns, inside
 * the same transaction, so version and schema move together or not at all.
 *
 * `toVersion` is the version the database reaches, not the one it starts from. Steps are ordered
 * by it, gaps are allowed, and two steps sharing a `toVersion` both run — nothing deduplicates
 * them.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export interface Migration {
  toVersion: number;
  up: (db: SqliteLike) => void;
}

/**
 * Arguments to `migrateSchema`.
 *
 * `currentVersion` is the version the code expects, and it is the ceiling: a migration whose
 * `toVersion` exceeds it is left unapplied for a later release. `migrations` may be given in any
 * order and may contain steps already applied — both are filtered and sorted here. `label` only
 * ever appears in the downgrade error message.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export interface MigrateSchemaOptions {
  db: SqliteLike;
  currentVersion: number;
  migrations: ReadonlyArray<Migration>;
  /** For log/error context (e.g., "memory-index", "registry"). */
  label?: string;
}

/**
 * What `migrateSchema` did.
 *
 * `from` is the `user_version` found on the database, `to` is the version it holds afterwards,
 * and `ran` is how many steps executed. When nothing was pending, `to === from` and `ran === 0`.
 *
 * `to` is the `toVersion` of the last step applied, NOT `currentVersion`. A database at version 3
 * against `currentVersion: 5` with no migration in that range comes back as
 * `{ from: 3, to: 3, ran: 0 }` — the gap is reported, not closed. Comparing `to` with
 * `currentVersion` is how a caller notices that the migration list is missing a step.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export interface MigrateSchemaResult {
  from: number;
  to: number;
  ran: number;
}

/**
 * Bring a SQLite database's `user_version` up to `currentVersion` by running the steps that sit
 * between the two.
 *
 * Steps are sorted ascending by `toVersion` and filtered to `> stored && <= currentVersion`, then
 * run in that order inside ONE transaction: each `up` is followed immediately by the matching
 * `user_version` write. Either every step in the run commits or none does — a step that throws
 * aborts the transaction, propagates the error, and leaves the database at the version it started
 * from. There is no partially-migrated state and no resume point.
 *
 * Forward-only. When the stored version is greater than `currentVersion` — an older build opening
 * a database a newer one already migrated — this throws immediately, before touching anything,
 * with a message naming both versions and `label`. Nothing downgrades, and no data is deleted on
 * any path here; what a step does is the step's own business.
 *
 * A stored version equal to `currentVersion` returns without opening a transaction. A `user_version`
 * that is absent or not a number is read as 0, so a fresh database runs every step.
 *
 * Concurrency: the SQLite transaction is the only serialization. This takes no file lock, so two
 * processes migrating the same file at once are arbitrated by SQLite's own write lock — the loser
 * gets a busy or locked error from the driver, not a queued turn. Wrap the call in `withFileLock`
 * if that matters.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export function migrateSchema(opts: MigrateSchemaOptions): MigrateSchemaResult {
  const { db, currentVersion, migrations, label = "db" } = opts;
  const storedRaw = db.pragma("user_version", { simple: true });
  const stored = typeof storedRaw === "number" ? storedRaw : 0;

  if (stored > currentVersion) {
    throw new Error(
      `[${label}] schema version ${stored} > current ${currentVersion}; ` +
        "did you downgrade the SDK? Forward-only migrations only.",
    );
  }

  if (stored === currentVersion) {
    return { from: stored, to: stored, ran: 0 };
  }

  const pending = [...migrations]
    .sort((a, b) => a.toVersion - b.toVersion)
    .filter((m) => m.toVersion > stored && m.toVersion <= currentVersion);

  let ran = 0;
  let lastApplied = stored;

  db.transaction(() => {
    for (const m of pending) {
      m.up(db);
      db.pragma(`user_version = ${m.toVersion}`);
      lastApplied = m.toVersion;
      ran += 1;
    }
  })();

  return { from: stored, to: lastApplied, ran };
}

// ────────────────────── JSON versioned files ──────────────────────

/**
 * The on-disk envelope: the payload under `data`, its schema version alongside it.
 *
 * `writeVersionedJson` always produces this shape. `readVersionedJson` reads it, but tolerates a
 * file that is not in it — a legacy object with no `_schemaVersion` is treated as version 0 and
 * handed to the migrate callback whole, so this type describes what is written, not everything
 * that can be read.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export interface VersionedJsonFile<T> {
  _schemaVersion: number;
  data: T;
}

/**
 * Upgrade callback for `readVersionedJson`, invoked only when the stored version is BELOW the
 * current one.
 *
 * `parsed` is the whole parsed JSON value, not `parsed.data`. That is deliberate: a legacy file
 * predating the envelope has its fields at the top level, and a callback handed only `.data`
 * would receive `undefined` for exactly the files that need migrating. It is typed `unknown`
 * because nothing has validated it — narrow before reading.
 *
 * `fromVersion` is the `_schemaVersion` found on disk, or 0 when the field is missing or not a
 * number.
 *
 * The return value is used as-is and is NOT written back; the file on disk still holds the old
 * shape until someone calls `writeVersionedJson`. Throwing here propagates out of
 * `readVersionedJson`, which otherwise never throws — return the default value instead if an
 * unmigratable file should be survivable.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export type VersionedJsonMigrate<T> = (parsed: unknown, fromVersion: number) => T;

/**
 * Arguments to `readVersionedJson`.
 *
 * `defaultValue` is a factory rather than a value because it is called on several paths and each
 * caller must get its own object — returning a shared mutable default would let one caller's
 * edits appear in another's. It is called for a missing file, an unreadable one, a corrupt one,
 * a non-object payload, and a file written by a newer version.
 *
 * `migrate` is called only for a stored version strictly below `currentVersion`.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export interface ReadVersionedJsonOptions<T> {
  path: string;
  currentVersion: number;
  migrate: VersionedJsonMigrate<T>;
  defaultValue: () => T;
}

/**
 * Read a versioned JSON file, migrating or falling back rather than failing.
 *
 * What comes back, by case:
 *
 *   - version matches `currentVersion` — the file's `data` field, returned as `T` WITHOUT
 *     validation. A file whose envelope is right but whose payload is not gets through.
 *   - version below `currentVersion` — whatever `migrate(parsed, stored)` returns. The migrated
 *     value is not persisted; the file is untouched.
 *   - version above `currentVersion` — `defaultValue()`, plus a warning. Forward-only: a file
 *     written by a newer build is left alone rather than downgraded.
 *   - file missing, or unreadable for any other reason (permissions, a directory in its place) —
 *     `defaultValue()`, silently. Absence and denial are not distinguished.
 *   - file present but not valid JSON — `defaultValue()`, and the file is RENAMED to
 *     `<path>.corrupt.<epoch-ms>` so the next run starts clean and the bad bytes stay available.
 *     A rename that itself fails is warned about and the read still returns the default, which
 *     means the same corrupt file will be met again next time.
 *   - JSON that parses to a non-object (a number, a string, `null`) — `defaultValue()`, silently
 *     and without moving the file aside.
 *
 * The only ways this throws are through the callbacks you supply: `migrate` or `defaultValue`
 * raising. Nothing else here rejects.
 *
 * There is no locking. A concurrent `writeVersionedJson` on the same path is atomic at the rename,
 * so a reader sees either the old file or the new one, never a half-written one — but a
 * read-modify-write built from this pair is NOT atomic across the two calls, and needs
 * `withFileLock` around both.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export async function readVersionedJson<T>(opts: ReadVersionedJsonOptions<T>): Promise<T> {
  const { path, currentVersion, migrate, defaultValue } = opts;

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return defaultValue();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // T5.10 — move corrupt file aside so (a) user can investigate and
    // (b) next run starts fresh instead of hitting the same warning loop.
    const asidePath = `${path}.corrupt.${Date.now()}`;
    try {
      await rename(path, asidePath);
      diag(`[theokit-sdk] ${path} is corrupt; moved to ${asidePath}. Using default value.\n`);
    } catch {
      diag(`[theokit-sdk] ${path} is corrupt; using default value.\n`);
    }
    return defaultValue();
  }

  if (typeof parsed !== "object" || parsed === null) {
    return defaultValue();
  }

  const file = parsed as { _schemaVersion?: unknown; data?: unknown };
  const storedRaw = file._schemaVersion;
  const stored = typeof storedRaw === "number" ? storedRaw : 0;

  if (stored === currentVersion) {
    return file.data as T;
  }

  if (stored > currentVersion) {
    diag(
      `[theokit-sdk] ${path} schema version ${stored} > current ${currentVersion}; ` +
        "using default value (forward-only).\n",
    );
    return defaultValue();
  }

  // EC-2 fix: pass the FULL parsed object to migrate, not just `file.data`.
  // Legacy shapes (e.g., `{ schemaVersion: "1.0", agents: {...} }` without
  // a `data` field) need to inspect the whole thing.
  return migrate(parsed, stored);
}

/**
 * Write `data` wrapped in the version envelope, replacing the file atomically.
 *
 * The bytes go to a temp file in the same directory and are moved into place with `rename`, so a
 * crash or a concurrent reader never observes a partial file: the path holds either the previous
 * content or the complete new content. Parent directories are created as needed, and the file is
 * created with mode 0600 (subject to the process umask), formatted with two-space indentation and
 * a trailing newline.
 *
 * `currentVersion` is stamped verbatim as `_schemaVersion`; nothing checks it against what was
 * already on disk, so this will happily overwrite a newer file with an older version. Read first
 * if that matters.
 *
 * Rejects when `data` cannot be serialized — a circular reference, or a `toJSON` that throws.
 * Serialization happens before any filesystem call, so on that path no directory is created, no
 * temp file exists, and the file already on disk is untouched.
 *
 * Atomicity is the rename's, so it is as strong as the filesystem's: on NFS, SMB or FUSE the
 * underlying writer emits a one-shot warning that the guarantee is weaker there.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/persistence` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
 */
export async function writeVersionedJson<T>(
  path: string,
  data: T,
  currentVersion: number,
): Promise<void> {
  const file: VersionedJsonFile<T> = {
    _schemaVersion: currentVersion,
    data,
  };
  await atomicWriteJson(path, file);
}
