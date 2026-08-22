import type { EmbeddingCache } from "./embedding-adapter.js";

/**
 * Bounded in-memory LRU cache for embeddings, keyed by `sha256(text)` (or any
 * stable key the caller chooses).
 *
 * Recency is tracked by Map insertion order: `get` re-inserts the hit so it becomes the newest,
 * and `set` evicts the oldest key once `capacity` (default 5000) is reached. Nothing here bounds
 * the size of a single VALUE, so capacity is a count of vectors, not a memory budget.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/memory-adapters` sub-path, which the
 * package declares in `exports` but does NOT cover with its semver contract.
 */
export class LruEmbeddingCache implements EmbeddingCache {
  private readonly map = new Map<string, number[]>();

  constructor(private readonly capacity: number = 5000) {}

  get(key: string): number[] | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Move to most-recent by re-inserting.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: number[]): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      // Evict the oldest entry — Map preserves insertion order.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  size(): number {
    return this.map.size;
  }
}

/**
 * T4.4 — Process-wide singleton embedding cache (DR4 finding #4).
 *
 * Pre-T4.4 each adapter / index-manager constructed its own
 * `LruEmbeddingCache` — a consumer with 3 Memory.openIndex calls
 * got 3 independent caches with no cross-index deduplication. The
 * same text embedded identically across indexes re-computed the
 * embedding each time.
 *
 * The singleton shares the cache process-wide so hit rate goes up
 * dramatically. The LRU eviction (default 5000 entries) bounds
 * memory usage even with the shared surface.
 *
 * Consumers who need isolation (e.g., multi-tenant with different
 * embedding models) should construct their own `LruEmbeddingCache`
 * and pass it explicitly — the singleton is the DEFAULT, not the
 * only option.
 *
 * Semver-exempt: reachable via the `@theokit/sdk/internal/memory-adapters` sub-path, which the
 * package declares in `exports` but does NOT cover with its semver contract.
 */
export const globalEmbeddingCache: EmbeddingCache = new LruEmbeddingCache();

/**
 * T4.4 — Test seam: reset the global singleton between tests.
 * NOT included in the public barrel.
 *
 * @internal
 */
export function __TESTING__resetGlobalEmbeddingCache(): void {
  const cache = globalEmbeddingCache as LruEmbeddingCache;
  // Clear all entries — the capacity stays unchanged.
  (cache as unknown as { map: Map<string, number[]> }).map.clear();
}
