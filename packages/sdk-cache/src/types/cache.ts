/**
 * Public type contract for `Cache.semantic / .asPlugin / .stats / .clear`
 * (Adoption Roadmap #6; ADRs D249-D266).
 *
 * @public
 */

/* ─── TTL config (D255) ─── */

export interface CacheTTLConfig {
  /** Default TTL applied to all entries. Format: `"1h" | "30m" | 86400 (seconds)`. */
  readonly default: string | number;
  /** Regex marking queries that must NEVER be cached (e.g. /weather|today|now/i). */
  readonly exclude?: RegExp;
}

/* ─── Persistence (D265) ─── */

export interface CachePersistenceOptions {
  readonly backend: "memory" | "json";
  /** Required when backend = "json". */
  readonly dir?: string;
}

/* ─── Embedder option ─── */

/**
 * Embedder runtime shape — minimal subset of `EmbeddingRuntime` (D11) the
 * Cache actually uses. Lets tests inject fake embedders without pulling
 * the full memory subsystem.
 */
export interface CacheEmbedderRuntime {
  readonly id: string;
  readonly model: string;
  readonly dimension: number;
  embed(texts: ReadonlyArray<string>): Promise<number[][]>;
}

/* ─── Options ─── */

export interface CacheSemanticOptions {
  /** Embedder instance. REQUIRED in v1 — no autoselect (avoids surprise API calls). */
  readonly embedder: CacheEmbedderRuntime;
  /** Cosine distance threshold (0..2). Default 0.85; lower = stricter. */
  readonly threshold?: number;
  /** TTL config. Default `{ default: "1h" }`. */
  readonly ttl?: CacheTTLConfig;
  /** Multi-tenant namespace. Default `"global"`. */
  readonly namespace?: string;
  /** Default modelId attached to entries when caller doesn't override. */
  readonly modelId?: string;
  /** Max entries (LRU eviction). Default 1000. */
  readonly maxEntries?: number;
  /** Persistence backend. Default in-memory. */
  readonly persistence?: CachePersistenceOptions;
}

/* ─── Entry + stats ─── */

export interface CacheEntry {
  readonly key: string;
  readonly namespace: string;
  readonly embedderId: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly response: string;
  readonly vector: ReadonlyArray<number>;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly accessedAt: number;
  readonly accessCount: number;
}

export interface CacheStats {
  readonly entries: number;
  readonly kvHits: number;
  readonly semanticHits: number;
  readonly misses: number;
  readonly excluded: number;
  readonly evicted: number;
  readonly embedderFailures: number;
}

/* ─── Error classes ─── */

export class CacheEmbedderError extends Error {
  override readonly name = "CacheEmbedderError";
  override readonly cause?: Error;
  constructor(message: string, cause?: Error) {
    super(`Cache embedder failed: ${message}`);
    if (cause !== undefined) this.cause = cause;
  }
}

export class CacheInvalidTtlError extends Error {
  override readonly name = "CacheInvalidTtlError";
  constructor(public readonly input: string | number) {
    super(
      `Invalid TTL value: "${String(input)}". Expected number (seconds) or string like "1h" / "30m" / "7d".`,
    );
  }
}
