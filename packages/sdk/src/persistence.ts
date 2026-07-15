/**
 * Public persistence primitives (V2-3 — Theo Harness Capability Map, Tema G).
 *
 * Promotes the consumer-grade persistence helpers from `internal/persistence`
 * to a STABLE, semver-protected public sub-path so consumers (e.g. a code
 * assistant's eval harness or config store) adopt durable JSONL persist/resume,
 * audited atomic-write, and resilient-SQLite bootstrap WITHOUT coupling to the
 * semver-exempt `@theokit/sdk/internal/persistence` path.
 *
 * Several of these were extracted FROM a real consumer (theocode's SWE-bench
 * harness — see the `referencia:` comments in `internal/persistence/jsonl.ts`);
 * this sub-path lets that consumer adopt its own contributed pattern back from a
 * stable home. DTS is generated via tsc (this barrel reaches `internal/`, like
 * `retry`/`compaction` — see `tsconfig.tools-dts.json`).
 */

// Atomic file write (fsync + 0o600 + crypto-random temp + rename; never a torn write).
export type { AtomicWriteJsonOptions } from "./internal/persistence/atomic-write.js";
export {
  atomicWriteJson,
  atomicWriteText,
  replaceFileAtomic,
} from "./internal/persistence/atomic-write.js";
// SE39 — Claude Code transcript writer (best-effort, read-only ecosystem interop).
export type {
  ClaudeCodeRecord,
  ClaudeCodeTranscriptOptions,
} from "./internal/persistence/claude-code-transcript.js";
export {
  ClaudeCodeTranscriptWriter,
  claudeCodeRecords,
  encodeProjectDir,
} from "./internal/persistence/claude-code-transcript.js";
// Cross-process advisory file lock.
export type { FileLockOptions } from "./internal/persistence/file-lock.js";
export { withFileLock } from "./internal/persistence/file-lock.js";
// JSONL persist / resume (durable, crash-safe batch runners).
export {
  appendJsonl,
  JsonlParseError,
  loadJsonl,
  readJsonlIds,
} from "./internal/persistence/jsonl.js";

// Resilient SQLite bootstrap (corruption recovery) + WAL/FK setup.
export type {
  OpenSqliteResilientOptions,
  ResilientSqliteDb,
} from "./internal/persistence/sqlite-open.js";
export { isCorruptionError, openSqliteResilient } from "./internal/persistence/sqlite-open.js";
export type { WalApplyResult } from "./internal/persistence/sqlite-wal.js";
export { applyWalWithFallback } from "./internal/persistence/sqlite-wal.js";
