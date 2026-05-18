/**
 * Barrel for persistence primitives shared across subsystems
 * (memory, runtime, cron, mcp).
 *
 * @internal
 */

export type { AtomicWriteJsonOptions } from "./atomic-write.js";
export { atomicWriteJson, replaceFileAtomic } from "./atomic-write.js";
export { withCwdMutex } from "./cwd-mutex.js";
export type { FileLockOptions } from "./file-lock.js";
export { withFileLock } from "./file-lock.js";
export { containsCjk, sanitizeFts5Query } from "./fts5-sanitize.js";
export { displayTheokitHome, getProfilesRoot, getTheokitHome } from "./paths.js";
export type {
  MigrateSchemaOptions,
  MigrateSchemaResult,
  Migration,
  ReadVersionedJsonOptions,
  SqliteLike,
  VersionedJsonFile,
  VersionedJsonMigrate,
} from "./schema-version.js";
export {
  migrateSchema,
  readVersionedJson,
  writeVersionedJson,
} from "./schema-version.js";
export type { WalApplyResult } from "./sqlite-wal.js";
export { applyWalWithFallback } from "./sqlite-wal.js";
