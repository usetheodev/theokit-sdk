/**
 * Barrel for persistence primitives shared across subsystems
 * (memory, runtime, cron, mcp).
 *
 * @deprecated SE43 DoD#2 — the `@theokit/sdk/internal/persistence` public export
 * is deprecated. Import the shared kernel primitives from the sanctioned public
 * barrel `@theokit/sdk/persistence` instead. This alias re-exports the FULL current
 * surface UNCHANGED for one release (external back-compat, EC-1); it is scheduled
 * for removal in a future major. See `final_report.md § MEDIUM — internal/persistence`.
 *
 * Semver-exempt: everything reachable through this sub-path is an internal primitive and is NOT
 * covered by the package's semver contract. It is nonetheless declared in `package.json` `exports`,
 * so it MUST be emitted into the published declarations — a tag that erased it here would break
 * every consumer the back-compat alias exists to serve.
 */

export type { AtomicWriteJsonOptions } from "./atomic-write.js";
export { atomicWriteJson, atomicWriteText, replaceFileAtomic } from "./atomic-write.js";
export { withCwdMutex } from "./cwd-mutex.js";
export type { CreateExclusiveOptions } from "./exclusive-create.js";
export { createExclusive } from "./exclusive-create.js";
export type { FileLockOptions } from "./file-lock.js";
export { withFileLock } from "./file-lock.js";
export { containsCjk, sanitizeFts5Query } from "./fts5-sanitize.js";
export { appendJsonl, JsonlParseError, loadJsonl, readJsonlIds } from "./jsonl.js";
export { displayTheokitHome, getProfilesRoot, getTheokitHome } from "./paths.js";
export { PersistenceSchema } from "./persistence-schema.js";
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
export { casUpdate } from "./sqlite-cas.js";
export type { OpenSqliteResilientOptions, ResilientSqliteDb } from "./sqlite-open.js";
export { isCorruptionError, openSqliteResilient } from "./sqlite-open.js";
export type { WalApplyResult } from "./sqlite-wal.js";
export { applyWalWithFallback } from "./sqlite-wal.js";
