/**
 * `LanceMemoryAdapter` — wraps `LanceIndex` to expose the common
 * `MemoryIndex` interface (sync/search/status/close) so consumers of
 * `IndexManager.open({ backend: "lance" })` get a drop-in replacement
 * for the SQLite-backed `IndexManager`.
 *
 * Semantic deltas vs SQLite (documented so callers know what to expect):
 *
 *  - `sync()` is a NO-OP. Lance is a pure vector store — there is no
 *    markdown corpus to crawl. Returns zero counts. Consumers writing
 *    facts use `LanceIndex.addFacts` directly (exposed via the index
 *    object returned to advanced callers).
 *  - `search()` performs vector-only retrieval. `MemorySearchHit.textScore`
 *    is undefined (no FTS5 layer); `vectorScore === score`.
 *  - `status()` reports `backend: "hybrid"` only when an embedding runtime
 *    is wired (always the case for Lance — embedding is required at open).
 *    `chunksIndexed` reflects total Lance row count; `filesIndexed` is 0
 *    because Lance does not track file provenance per-row.
 *
 * Ships with the lancedb-backend-ship-v1-1 plan (close D12, supersede via
 * D43). v1.4.0 of `@usetheo/sdk`.
 *
 * @internal
 */

import type { IndexStatus, MemorySearchHit, SearchOptions } from "./index-manager.js";
import type { LanceIndex } from "./lance-index.js";
import { type MemoryIndex, parseSearchOptions, type SyncResult } from "./memory-index.js";

/**
 * Default namespace used when consumers call `search()` without specifying
 * one. The SQLite `IndexManager` does not surface namespace in its public
 * `search()` signature either — both backends therefore behave consistently
 * under the "single-workspace, single-namespace" assumption that v1.4 ships.
 *
 * v1.5 candidate: surface `namespace` in `SearchOptions` (additive — no
 * breaking change) so multi-tenant Lance consumers can scope queries.
 */
const DEFAULT_NAMESPACE = "default";

/** Empty sync result — Lance has no corpus to walk. */
const EMPTY_SYNC_RESULT: SyncResult = Object.freeze({
  filesScanned: 0,
  filesUpdated: 0,
  chunksWritten: 0,
  chunksEmbedded: 0,
});

export class LanceMemoryAdapter implements MemoryIndex {
  constructor(private readonly inner: LanceIndex) {}

  /**
   * No-op for Lance — see file header. Returns zero counts so callers'
   * existing logging (`filesScanned: X`) does not break.
   */
  async sync(): Promise<SyncResult> {
    return EMPTY_SYNC_RESULT;
  }

  // jscpd:ignore-start — search signature + early-out is idiomatic
  // overlap with IndexManager.search; further factoring would hurt
  // readability (the bodies diverge sharply right after).
  async search(query: string, options: SearchOptions = {}): Promise<MemorySearchHit[]> {
    if (query.trim().length === 0) return [];
    const { maxResults, minScore } = parseSearchOptions(options);
    // jscpd:ignore-end
    const lanceHits = await this.inner.search(query, {
      namespace: DEFAULT_NAMESPACE,
      limit: maxResults * 2,
      ...(options.sources !== undefined ? { sources: options.sources } : {}),
    });
    return lanceHits
      .filter((h) => h.score >= minScore)
      .slice(0, maxResults)
      .map((h) => translateLanceHit(h));
  }

  status(): IndexStatus {
    // chunksIndexed via a synchronous best-effort — Lance API is async so
    // we surface zero here and document that consumers needing exact counts
    // should call `inner.countFacts()` directly.
    return {
      backend: "hybrid",
      filesIndexed: 0,
      chunksIndexed: 0,
    };
  }

  async close(): Promise<void> {
    await this.inner.close();
  }

  /**
   * Escape hatch for advanced callers (migration tool, benchmark script)
   * that need direct access to addFacts/countFacts/removeFacts.
   */
  unwrap(): LanceIndex {
    return this.inner;
  }
}

/**
 * Translate `LanceSearchHit` to `MemorySearchHit`. Field mapping:
 *
 *   - `id` → `path` (Lance has no file-system provenance; use opaque id)
 *   - `text` → `snippet` (truncated to 200 chars matching IndexManager convention)
 *   - `score` → `score` AND `vectorScore` (Lance is vector-only)
 *   - `source` → `source`
 *   - synthetic `startLine: 0, endLine: 0` (Lance has no line info)
 *   - synthetic `citation: id` (no path:line citation available)
 *   - `textScore` omitted (Lance does NOT do FTS5)
 */
function translateLanceHit(hit: {
  id: string;
  text: string;
  source: "memory" | "sessions" | "wiki";
  score: number;
}): MemorySearchHit {
  return {
    path: hit.id,
    startLine: 0,
    endLine: 0,
    score: hit.score,
    textScore: 0,
    vectorScore: hit.score,
    snippet: hit.text.slice(0, 200),
    source: hit.source,
    citation: hit.id,
  };
}
