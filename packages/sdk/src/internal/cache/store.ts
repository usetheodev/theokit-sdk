/**
 * Cache store interface + in-memory implementation (ADRs D252, D259, D261).
 *
 * INVARIANT (EC-9, EC-13): KV map and vector view are the SAME Map.
 * `semanticSearch` iterates `Map.values()`. No parallel list. `set` replaces
 * by key (Map semantics) — no duplicate-on-race possible.
 *
 * EC-2: `semanticSearch` filters by `embedderId === currentEmbedderId &&
 * vector.length === currentDim` before cosine compare. Protects against
 * dim mismatch when disk-loaded entries used a different embedder.
 *
 * @internal
 */

import type { CacheEntry, CacheStats } from "../../types/cache.js";
import { cosineDistance } from "./cosine.js";

export interface CacheStore {
  kvGet(key: string, now: number): CacheEntry | undefined;
  semanticSearch(
    vector: ReadonlyArray<number>,
    threshold: number,
    embedderId: string,
    namespace: string,
    now: number,
  ): { entry: CacheEntry; distance: number } | undefined;
  set(entry: CacheEntry): void;
  delete(key: string): void;
  clear(): Promise<void>;
  stats(): CacheStats;
  evictExpired(now: number): number;
  /** For persistence backends — bulk import. */
  loadAll?(entries: ReadonlyArray<CacheEntry>): void;
  /** For persistence backends — snapshot for serialization. */
  dump?(): ReadonlyArray<CacheEntry>;
}

interface StoreCounters {
  kvHits: number;
  semanticHits: number;
  misses: number;
  excluded: number;
  evicted: number;
  embedderFailures: number;
}

export class InMemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, CacheEntry>();
  private readonly counters: StoreCounters = {
    kvHits: 0,
    semanticHits: 0,
    misses: 0,
    excluded: 0,
    evicted: 0,
    embedderFailures: 0,
  };

  constructor(private readonly maxEntries: number) {}

  kvGet(key: string, now: number): CacheEntry | undefined {
    const e = this.map.get(key);
    if (e === undefined) return undefined;
    if (e.expiresAt <= now) {
      this.map.delete(key);
      this.counters.evicted += 1;
      return undefined;
    }
    // Touch for LRU recency.
    this.map.delete(key);
    this.map.set(key, { ...e, accessedAt: now, accessCount: e.accessCount + 1 });
    return this.map.get(key);
  }

  private isEligibleForSearch(
    e: CacheEntry,
    embedderId: string,
    namespace: string,
    dim: number,
    now: number,
  ): boolean {
    if (e.embedderId !== embedderId) return false;
    if (e.namespace !== namespace) return false;
    if (e.vector.length !== dim) return false;
    if (e.expiresAt <= now) return false;
    return true;
  }

  semanticSearch(
    vector: ReadonlyArray<number>,
    threshold: number,
    embedderId: string,
    namespace: string,
    now: number,
  ): { entry: CacheEntry; distance: number } | undefined {
    let best: { entry: CacheEntry; distance: number } | undefined;
    for (const e of this.map.values()) {
      if (!this.isEligibleForSearch(e, embedderId, namespace, vector.length, now)) continue;
      const d = cosineDistance(e.vector, vector);
      if (d <= threshold && (best === undefined || d < best.distance)) {
        best = { entry: e, distance: d };
      }
    }
    if (best !== undefined) {
      this.map.delete(best.entry.key);
      this.map.set(best.entry.key, {
        ...best.entry,
        accessedAt: now,
        accessCount: best.entry.accessCount + 1,
      });
    }
    return best;
  }

  set(entry: CacheEntry): void {
    // EC-13: Map.set replaces by key — no parallel list.
    if (this.map.has(entry.key)) {
      this.map.delete(entry.key);
    }
    this.map.set(entry.key, entry);
    // Evict LRU when over capacity.
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
      this.counters.evicted += 1;
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  stats(): CacheStats {
    return {
      entries: this.map.size,
      kvHits: this.counters.kvHits,
      semanticHits: this.counters.semanticHits,
      misses: this.counters.misses,
      excluded: this.counters.excluded,
      evicted: this.counters.evicted,
      embedderFailures: this.counters.embedderFailures,
    };
  }

  evictExpired(now: number): number {
    let count = 0;
    for (const [k, e] of this.map.entries()) {
      if (e.expiresAt <= now) {
        this.map.delete(k);
        count += 1;
      }
    }
    this.counters.evicted += count;
    return count;
  }

  loadAll(entries: ReadonlyArray<CacheEntry>): void {
    for (const e of entries) this.map.set(e.key, e);
  }

  dump(): ReadonlyArray<CacheEntry> {
    return [...this.map.values()];
  }

  /** Internal helpers for counters (used by lookup/store handlers). */
  incrementKvHits(): void {
    this.counters.kvHits += 1;
  }
  incrementSemanticHits(): void {
    this.counters.semanticHits += 1;
  }
  incrementMisses(): void {
    this.counters.misses += 1;
  }
  incrementExcluded(): void {
    this.counters.excluded += 1;
  }
  incrementEmbedderFailures(): void {
    this.counters.embedderFailures += 1;
  }
}
