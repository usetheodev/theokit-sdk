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
 * D43). v1.4.0 of `@theokit/sdk`.
 *
 * @internal
 */

import type { IndexStatus, MemorySearchHit, SearchOptions } from "./index-manager-contract.js";
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

/**
 * Lance has no corpus to walk, and the result now SAYS so.
 *
 * The counts stay zero — inventing numbers would trade one false claim for another. What changed is
 * `supported: false`: an all-zeros result was previously indistinguishable from a real sync that
 * found nothing to reindex, and the comment above this constant used to present that as the goal
 * ("so callers' existing logging does not break"). A caller can now tell "nothing to do" from
 * "this backend does not do this".
 */
const UNSUPPORTED_SYNC_RESULT: SyncResult = Object.freeze({
  filesScanned: 0,
  filesUpdated: 0,
  chunksWritten: 0,
  chunksEmbedded: 0,
  supported: false,
});

export class LanceMemoryAdapter implements MemoryIndex {
  constructor(private readonly inner: LanceIndex) {}

  /**
   * Not applicable to Lance — see file header. Returns zero counts with `supported: false` so a
   * caller can distinguish this from a real sync that found nothing.
   */
  async sync(): Promise<SyncResult> {
    return UNSUPPORTED_SYNC_RESULT;
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
      .map((h) => translateLanceHit(h, query));
  }

  status(): IndexStatus {
    // The Lance API is async and `status()` is not, so no count can be taken here. The zeros are
    // placeholders and `countsExact: false` says so — previously they were indistinguishable from a
    // measured empty index, so a caller testing `chunksIndexed > 0` got a false negative on every
    // run regardless of how many rows the table held. A consumer needing the real number calls
    // `unwrap().countFacts()`.
    return {
      backend: "hybrid",
      filesIndexed: 0,
      chunksIndexed: 0,
      countsExact: false,
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
 *   - `score` → combined (0.7 × vectorScore + 0.3 × textScore)
 *   - `vectorScore` → from Lance's distance metric
 *   - `textScore` → T4.5 client-side term-overlap ratio (removes ADR D43 vector-only caveat)
 *   - `source` → `source`
 *   - synthetic `startLine: 0, endLine: 0` (Lance has no line info)
 *   - synthetic `citation: id` (no path:line citation available)
 */
function translateLanceHit(
  hit: { id: string; text: string; source: "memory" | "sessions" | "wiki"; score: number },
  query?: string,
): MemorySearchHit {
  const textScore = query !== undefined ? computeTermOverlapScore(query, hit.text) : 0;
  const vectorScore = hit.score;
  // Hybrid combination: 70% vector (semantic) + 30% text (lexical).
  const combined = 0.7 * vectorScore + 0.3 * textScore;
  return {
    path: hit.id,
    startLine: 0,
    endLine: 0,
    score: combined,
    textScore,
    vectorScore,
    snippet: hit.text.slice(0, 200),
    source: hit.source,
    citation: hit.id,
  };
}

/**
 * T4.5 — Client-side term-overlap score for Lance hybrid search.
 * Counts what fraction of query terms appear in the text (case-insensitive).
 * Simple but effective for re-ranking vector hits by lexical relevance.
 * Returns 0..1 where 1 = all query terms present.
 */
function computeTermOverlapScore(query: string, text: string): number {
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (queryTerms.length === 0) return 0;
  const textLower = text.toLowerCase();
  const matched = queryTerms.filter((term) => textLower.includes(term)).length;
  return matched / queryTerms.length;
}
