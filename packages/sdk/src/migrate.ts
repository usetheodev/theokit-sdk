// Public API for memory migration (ADR D44).
//
// This file is the public re-export wrapper for the internal implementation.
// Declaring types here (rather than re-exporting from internal/) avoids a
// known rollup-dts resolution quirk with internal/ paths.
//
// Iter 78 (SDK 2.0 Phase 4 Stage 4 #3): routes through
// `@theokit/sdk-memory` when the peer is installed. Falls back to
// the legacy `internal/memory/migrate-sqlite-to-lance.js` when the
// peer is absent. Both paths share byte-equivalent runtime behavior
// because sdk-memory's copy is the iter 71 source-move (atomic
// rename commit, NFC sample compare, D70 redaction logger wrap).

import { migrateSqliteToLance as _migrateSqliteToLance } from "./internal/memory/migrate-sqlite-to-lance.js";
import { tryLoadSdkMemoryPeer } from "./internal/memory/sdk-memory-peer-loader.js";

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
export async function migrateSqliteToLance(options: MigrateOptions): Promise<MigrateResult> {
  // SDK 2.0 Phase 4 Stage 4 (iter 78): peer routing.
  const peer = await tryLoadSdkMemoryPeer();
  if (peer !== null) {
    return peer.migrateSqliteToLance(options);
  }
  return _migrateSqliteToLance(options);
}
