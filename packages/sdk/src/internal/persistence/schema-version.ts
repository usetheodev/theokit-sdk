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

import { readFile } from "node:fs/promises";

import { atomicWriteJson } from "./atomic-write.js";

// ────────────────────── SQLite migrations ──────────────────────

/**
 * Minimal Database interface so this file does not hard-depend on
 * `better-sqlite3` at module load time. Compatible with the runtime
 * shape exposed by `better-sqlite3`.
 *
 * @internal
 */
export interface SqliteLike {
  pragma: (statement: string, options?: { simple?: boolean }) => unknown;
  exec: (sql: string) => void;
  transaction: <Args extends unknown[], R>(fn: (...args: Args) => R) => (...args: Args) => R;
}

/**
 * One forward migration step. `up` receives the DB inside a transaction;
 * `toVersion` is the value the pragma will be set to AFTER `up` returns.
 *
 * @internal
 */
export interface Migration {
  toVersion: number;
  up: (db: SqliteLike) => void;
}

/**
 * Options for `migrateSchema`.
 *
 * @internal
 */
export interface MigrateSchemaOptions {
  db: SqliteLike;
  currentVersion: number;
  migrations: ReadonlyArray<Migration>;
  /** For log/error context (e.g., "memory-index", "registry"). */
  label?: string;
}

/**
 * Result of `migrateSchema`.
 *
 * @internal
 */
export interface MigrateSchemaResult {
  from: number;
  to: number;
  ran: number;
}

/**
 * Run pending migrations to bring the DB from its current `user_version` up
 * to `currentVersion`. Migrations are sorted ascending by `toVersion` and
 * only those `> stored && <= currentVersion` execute. Each runs inside the
 * shared transaction.
 *
 * Throws if `stored > currentVersion` (downgrade attempt — forward-only).
 *
 * @internal
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
 * Standard wrapper shape: `{ _schemaVersion: N, data: T }`. Use
 * `readVersionedJson` / `writeVersionedJson` for read/write.
 *
 * @internal
 */
export interface VersionedJsonFile<T> {
  _schemaVersion: number;
  data: T;
}

/**
 * Migration callback for `readVersionedJson`. Receives the FULL parsed
 * JSON object (not just `.data`), so legacy shapes without the
 * `_schemaVersion` / `data` wrapper can be migrated correctly (EC-2 fix).
 *
 * @internal
 */
export type VersionedJsonMigrate<T> = (parsed: unknown, fromVersion: number) => T;

/**
 * Options for `readVersionedJson`.
 *
 * @internal
 */
export interface ReadVersionedJsonOptions<T> {
  path: string;
  currentVersion: number;
  migrate: VersionedJsonMigrate<T>;
  defaultValue: () => T;
}

/**
 * Read a versioned JSON file. Returns:
 *   - file's `.data` when `_schemaVersion === currentVersion`
 *   - migrated value (via `migrate(parsed, stored)`) when stored < current
 *   - `defaultValue()` when file missing, corrupt, or stored > current
 *
 * Fail-soft: never throws. Corrupt or mismatched-newer files log a stderr
 * warning and fall back to `defaultValue()`.
 *
 * @internal
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
    process.stderr.write(`[theokit-sdk] ${path} is corrupt; using default value.\n`);
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
    process.stderr.write(
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
 * Write `data` as a versioned JSON file via atomic write.
 *
 * @internal
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
