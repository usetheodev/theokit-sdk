// Public API for memory migration (ADR D44).
//
// This file is the public re-export wrapper for the internal implementation.
// Declaring types here (rather than re-exporting from internal/) avoids a
// known rollup-dts resolution quirk with internal/ paths.

import { migrateSqliteToLance as _migrateSqliteToLance } from "./internal/memory/migrate-sqlite-to-lance.js";

/**
 * Options for {@link migrateSqliteToLance}.
 *
 * @public
 */
export interface MigrateOptions {
  cwd: string;
  dryRun?: boolean;
  batchSize?: number;
  logger?: (msg: string) => void;
}

/**
 * Outcome of {@link migrateSqliteToLance}.
 *
 * @public
 */
export interface MigrateResult {
  countSqlite: number;
  countLance: number;
  validated: boolean;
  sampleComparisons: ReadonlyArray<{ id: string; match: boolean }>;
  lancePath: string;
  committed: boolean;
}

/**
 * Migrate the Memory index from SQLite to LanceDB. ADR D44.
 *
 * @public
 */
export function migrateSqliteToLance(options: MigrateOptions): Promise<MigrateResult> {
  return _migrateSqliteToLance(options);
}
