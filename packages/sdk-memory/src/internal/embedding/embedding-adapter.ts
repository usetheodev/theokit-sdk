/**
 * Memory embedding provider adapter contract (ADR D3 of memory-system-peer-project-parity).
 *
 * Mirrors peer-project's `MemoryEmbeddingProviderAdapter` from
 * `reference/peer-project/extensions/openai/memory-embedding-adapter.ts` so
 * adding a new provider becomes one new file under `adapters/`.
 *
 * @internal
 */

export interface MemoryEmbeddingProviderAdapter {
  /** Stable provider id (matches peer-project's id catalog: "openai", "mistral", …). */
  readonly id: string;
  /** Default model the adapter uses unless the caller overrides via `options.model`. */
  readonly defaultModel: string;
  /** Transport kind. Remote = network HTTP; local = in-process / on-device. */
  readonly transport: "local" | "remote";
  /** Auth provider id used to resolve API keys (mirrors peer-project). */
  readonly authProviderId?: string;
  /**
   * Ranking hint — higher means "prefer this one" — for a provider auto-selection that is NOT
   * implemented. Nothing reads this field today: the provider is the one the caller names in
   * `embedding: { provider }`, and omitting it builds no embedding runtime at all. Kept because
   * the values are pinned by tests and mirrored in sdk-core's catalog.
   */
  readonly autoSelectPriority?: number;
  /** Factory — instantiate a per-agent runtime. */
  create(options: CreateAdapterOptions): Promise<EmbeddingRuntime>;
}

/**
 * Per-call overrides handed to {@link MemoryEmbeddingProviderAdapter.create}.
 * Every field is optional; the adapter falls back to its own defaults and to
 * the environment variables it declares.
 */
export interface CreateAdapterOptions {
  /** Override the adapter's `defaultModel`. */
  model?: string;
  /** Override the API key (else resolved from env). */
  apiKey?: string;
  /** Override the HTTP base URL (else provider default). */
  baseUrl?: string;
  /** Inject a fetch implementation (tests use this to stub HTTP). */
  fetch?: typeof fetch;
  /** Override the embedding cache. Defaults to a process-wide LRU shared by every runtime. */
  cache?: EmbeddingCache;
}

/**
 * A live embedding provider, bound to one model. `dimension` is fixed at
 * creation from the adapter's model table, which is what lets the SQLite vec0
 * table and the Lance schema be created with the right width before the first
 * vector arrives.
 *
 * `embed` resolves to one vector per input, in the same order. Whitespace-only
 * inputs come back as an all-zero vector rather than an error, and downstream
 * cosine similarity treats a zero-norm vector as similarity 0.
 */
export interface EmbeddingRuntime {
  readonly id: string;
  readonly model: string;
  readonly dimension: number;
  /** Embed N texts → N vectors of length `dimension`. Handles batching internally. */
  embed(texts: ReadonlyArray<string>): Promise<number[][]>;
  /** Observability — cache hit/miss + call counts. */
  stats(): EmbeddingRuntimeStats;
}

/**
 * Counters accumulated by a runtime since it was created. `httpCalls` counts
 * every request sent, including the ones that were retried, so `httpCalls`
 * minus `retries` is the number of distinct batches attempted.
 */
export interface EmbeddingRuntimeStats {
  cacheHits: number;
  cacheMisses: number;
  httpCalls: number;
  retries: number;
}

/**
 * The cache contract the shared runtime writes through. Keys are opaque — the
 * runtime derives them from the model id and the text — so an implementation
 * only has to behave like a bounded map.
 *
 * Pass one explicitly through {@link CreateAdapterOptions.cache} when entries
 * must not be shared: the default is a single process-wide LRU, so two runtimes
 * created in the same process see each other's entries.
 */
export interface EmbeddingCache {
  get(key: string): number[] | undefined;
  set(key: string, value: number[]): void;
  /** Total entries currently held. */
  size(): number;
}
