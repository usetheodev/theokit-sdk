import { createHash } from "node:crypto";

import type { ActiveMemoryResult } from "./active-memory.js";

/**
 * TTL-bounded cache for `runActiveMemory` results. Keyed by
 * `sha256(userText + queryMode)` so two identical sends within `cacheTtlMs`
 * (default 15s, matching OpenClaw's `DEFAULT_CACHE_TTL_MS`) share a single
 * search.
 *
 * Bounded size; oldest entries evicted first when capacity is exceeded.
 *
 * @internal
 */

export interface ActiveMemoryCacheOptions {
  ttlMs?: number;
  capacity?: number;
  now?: () => number;
}

interface CacheEntry {
  expiresAtMs: number;
  result: ActiveMemoryResult;
}

const DEFAULT_TTL_MS = 15_000;
const DEFAULT_CAPACITY = 1000;

export class ActiveMemoryCache {
  private readonly map = new Map<string, CacheEntry>();

  constructor(private readonly opts: ActiveMemoryCacheOptions = {}) {}

  get(userText: string, queryMode: string): ActiveMemoryResult | undefined {
    const key = cacheKey(userText, queryMode);
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    if (this.now() >= entry.expiresAtMs) {
      this.map.delete(key);
      return undefined;
    }
    // LRU bump
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.result;
  }

  set(userText: string, queryMode: string, result: ActiveMemoryResult): void {
    const key = cacheKey(userText, queryMode);
    if (this.map.size >= (this.opts.capacity ?? DEFAULT_CAPACITY)) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, {
      expiresAtMs: this.now() + (this.opts.ttlMs ?? DEFAULT_TTL_MS),
      result,
    });
  }

  size(): number {
    return this.map.size;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }
}

function cacheKey(userText: string, queryMode: string): string {
  return createHash("sha256").update(`${queryMode}\x00${userText}`).digest("hex");
}
