import type { EmbeddingRuntime } from "../embedding/embedding-adapter.js";

/**
 * Memory index manager contract — leaf types shared by `index-manager.ts`
 * (orchestrator), `index-manager-dispatch.ts` (backend dispatch), `lance-memory-adapter.ts`
 * (Lance backend), and `memory-index.ts` (common search-options parsing).
 *
 * **T2.1 / Cycles #11 + #12 + #13 of plan `arch-review-fixes-2026-06-06`
 * (ADR D433):** the previous layout had `index-manager.ts` defining the
 * contract types AND importing runtime from `index-manager-dispatch.ts`;
 * `index-manager-dispatch.ts` importing the types back from `index-manager.ts`;
 * `lance-memory-adapter.ts` and `memory-index.ts` both importing types from
 * `index-manager.ts`. The result was three HIGH-severity cycles
 * (Phase 5 cartographer):
 *
 *   #11: index-manager.ts ↔ index-manager-dispatch.ts (2-node)
 *   #12: index-manager.ts → index-manager-dispatch.ts → lance-memory-adapter.ts → index-manager.ts (3-node)
 *   #13: index-manager.ts → index-manager-dispatch.ts → lance-memory-adapter.ts → memory-index.ts → index-manager.ts (4-node)
 *
 * Single ~60 LOC extraction breaks all three: every cluster member now
 * imports types from this contract; only the orchestrator imports runtime
 * functions from dispatch (one direction, no cycle).
 *
 * **Contract scope:** types only. No runtime code. The single non-cycle
 * import (`EmbeddingRuntime` from `embedding-adapter.ts`) is itself a leaf
 * dependency outside the cluster — does not re-introduce a cycle.
 *
 * @internal — NOT part of the `@theokit/sdk` public API.
 */

export interface MemorySearchHit {
  /** Path relative to the memory root. */
  path: string;
  startLine: number;
  endLine: number;
  /** Combined score (hybrid when vector backend active, else just textScore). */
  score: number;
  /** FTS5 BM25 score normalized to 0..1 (higher = better). */
  textScore: number;
  /** sqlite-vec distance normalized to 0..1 (higher = better). Omitted when vector backend disabled. */
  vectorScore?: number;
  snippet: string;
  source: "memory" | "sessions" | "wiki";
  /** path:startLine-endLine for citations. */
  citation: string;
}

/**
 * A snapshot of index health. `backend` is `hybrid` when a vector index is live
 * and `fts-only` when the index can do text search only, which is what an index
 * opened without an embedding runtime reports.
 *
 * `lastSyncMs` is present only after a `sync()` in this process; it is not
 * persisted, so a freshly opened index omits it however recently it was synced.
 */
export interface IndexStatus {
  backend: "fts-only" | "hybrid";
  filesIndexed: number;
  chunksIndexed: number;
  lastSyncMs?: number;
}

/**
 * Search tuning. `maxResults` defaults to 10 and is floored at 1. `minScore`
 * defaults to 0 and is compared against the combined score, not the text or
 * vector score alone. `sources` filters by corpus; omitting it searches all
 * three.
 *
 * The two weights only matter on a hybrid index — with no vector index every
 * vector score is 0, so raising `vectorWeight` only scales the text score down.
 * They are normalised by their sum, so `{vectorWeight: 6, textWeight: 4}`
 * behaves the same as the defaults.
 */
export interface SearchOptions {
  maxResults?: number;
  minScore?: number;
  sources?: ReadonlyArray<"memory" | "sessions" | "wiki">;
  /** 0..1 — vector vs text weight in hybrid scoring (D4). Default 0.6. */
  vectorWeight?: number;
  /** 0..1 — text weight in hybrid scoring. Default 0.4. */
  textWeight?: number;
}

/** Vector backend selector. SQLite default; Lance opt-in (ADR D43). */
export type MemoryBackend = "sqlite-vec" | "lance";

/**
 * Options for `IndexManager.open`.
 *
 * Passing `embedding` is what turns on vector search; without it the index is
 * text-only. The Lance backend requires it and refuses to open without one.
 *
 * `filePath` means different things per backend: on `sqlite-vec` it is the
 * database file, on `lance` it is the storage directory.
 */
export interface OpenIndexOptions {
  cwd: string;
  filePath?: string;
  /** When provided, vector index is enabled in hybrid mode. */
  embedding?: EmbeddingRuntime;
  /** Vector backend. Default and only value today: `"sqlite-vec"`. */
  backend?: MemoryBackend;
}
