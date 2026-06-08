import type { EmbeddingCache } from "./embedding-adapter.js";

/**
 * Bounded in-memory LRU cache for embeddings, keyed by `sha256(text)` (or any
 * stable key the caller chooses).
 *
 * @internal
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
