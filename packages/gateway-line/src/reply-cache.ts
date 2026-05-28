/**
 * Reply-token LRU cache (D407).
 *
 * `put(userId, token)` — store with 60s TTL.
 * `take(userId)` — atomic one-shot consume; second call returns undefined.
 * `evictExpired()` — periodic GC; called internally before each take.
 *
 * Capacity 1000; oldest dropped when full.
 */

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_CAPACITY = 1000;

interface Entry {
  token: string;
  expiresAt: number;
}

export class ReplyTokenCache {
  private readonly cache = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly capacity: number;

  constructor(opts?: { ttlMs?: number; capacity?: number }) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.capacity = opts?.capacity ?? DEFAULT_CAPACITY;
  }

  put(userId: string, token: string): void {
    if (this.cache.size >= this.capacity) this.evictOldest();
    this.cache.set(userId, { token, expiresAt: Date.now() + this.ttlMs });
  }

  take(userId: string): string | undefined {
    const entry = this.cache.get(userId);
    if (entry === undefined) return undefined;
    this.cache.delete(userId);
    if (Date.now() >= entry.expiresAt) return undefined;
    return entry.token;
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  private evictOldest(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) this.cache.delete(firstKey);
  }
}
