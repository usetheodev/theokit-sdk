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
// SE43 DoD#2 — shared kernel primitives consumed by published satellites
// (sdk-cache / sdk-memory / sdk-tools), promoted from the `internal`-named export
// to this sanctioned public barrel (final_report.md § MEDIUM — internal/persistence).
export { withCwdMutex } from "./internal/persistence/cwd-mutex.js";
// Cross-process advisory file lock.
export type { FileLockOptions } from "./internal/persistence/file-lock.js";
export { withFileLock } from "./internal/persistence/file-lock.js";
export { sanitizeFts5Query } from "./internal/persistence/fts5-sanitize.js";
// JSONL persist / resume (durable, crash-safe batch runners).
export {
  appendJsonl,
  JsonlParseError,
  loadJsonl,
  readJsonlIds,
} from "./internal/persistence/jsonl.js";
export { PersistenceSchema } from "./internal/persistence/persistence-schema.js";
// SE40 — native session transcript (Claude-shaped `.jsonl`, theokit-native). The
// on-disk session format IS this shape. `encodeProjectDir` + `transcriptPath` are
// the path helpers a consumer reuses to locate a session file under
// `<baseDir>/projects/<encoded-cwd>/<sessionId>.jsonl`. Supersedes the SE39
// read-only `ClaudeCodeTranscriptWriter` (removed in v4.0).
export {
  encodeProjectDir,
  transcriptPath,
  // M94 — a raiz do estado de transcript. Exportada porque o consumidor a duplicava em
  // TRÊS arquivos, e as três cópias ignoravam `THEOKIT_HOME` junto com esta.
  transcriptRoot,
} from "./internal/persistence/session-transcript.js";
export {
  acquireSessionWriter,
  SessionBusyError,
  type SessionWriterLease,
} from "./internal/persistence/session-writer.js";
// Resilient SQLite bootstrap (corruption recovery) + WAL/FK setup.
export type {
  OpenSqliteResilientOptions,
  ResilientSqliteDb,
} from "./internal/persistence/sqlite-open.js";
export { isCorruptionError, openSqliteResilient } from "./internal/persistence/sqlite-open.js";
export type { WalApplyResult } from "./internal/persistence/sqlite-wal.js";
export { applyWalWithFallback } from "./internal/persistence/sqlite-wal.js";
// M81 — operações de transcript que o consumidor fazia à mão DENTRO deste store.
//
// `agent-builder` escrevia com `writeFileSync` cru no store de sessões (243 LoC reimplementando
// parse, corte e escrita de um formato que é nosso), porque nada aqui era alcançável. Junto com as
// operações viaja a regra que as protege: `forkTranscript` recusa escrever sobre uma sessão viva —
// mover a operação sem a regra entregaria uma API capaz de apagar o que a regra existe para proteger.
export {
  type ForkTranscriptOptions,
  forkTranscript,
  LiveSessionError,
  type ReadJsonlTailOptions,
  readJsonlTail,
} from "./internal/persistence/transcript-ops.js";
