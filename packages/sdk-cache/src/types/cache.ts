/**
 * Public type contract for `Cache.semantic / .asPlugin / .stats / .clear`
 * (Adoption Roadmap #6; ADRs D249-D266).
 *
 * @public
 */

/* ─── TTL config (D255) ─── */

/**
 * How long entries live, and which prompts never become entries at all.
 *
 * @public
 */
export interface CacheTTLConfig {
  /**
   * Lifetime applied to every entry written, evaluated at write time.
   *
   * A NUMBER is SECONDS (`3600` is an hour). A STRING needs a unit suffix — `s`, `m`, `h`, `d`, `w`
   * (`"30m"`, `"1h"`, `"7d"`). A bare numeric string is not a duration: `"3600"` throws
   * {@link CacheInvalidTtlError}, and so do a negative number and an unknown unit. `0` / `"0s"`
   * parses fine and writes entries that are already expired, which disables the cache without
   * disabling the embedding calls.
   *
   * The throw happens on the WRITE, not at `Cache.semantic(...)` — a bad value survives
   * construction and surfaces on the first `remember()` or the first cached assistant reply.
   */
  readonly default: string | number;
  /**
   * Prompts matching this regex are never cached — e.g. `/weather|today|now/i` for anything whose
   * answer goes stale.
   *
   * Applies to BOTH directions: a matching prompt is not looked up (it counts as
   * {@link CacheStats.excluded}, not a miss) and not stored. Test it against your real prompts —
   * a regex broad enough to match every question disables the cache while every counter still
   * looks healthy.
   *
   * Bring your own regex object; a `/g` flag is a hazard here because `RegExp.test` is stateful
   * with it and would match every other call.
   */
  readonly exclude?: RegExp;
}

/* ─── Persistence (D265) ─── */

/**
 * Where cached entries live between process restarts.
 *
 * `"memory"` (the default when {@link CacheSemanticOptions.persistence} is omitted) keeps everything
 * in the process and loses it on exit — right for a request-scoped worker, wrong for a CLI that runs
 * once per invocation and would never see a hit.
 *
 * `"json"` writes the whole entry set, VECTORS INCLUDED, to a file under `dir`. That file grows with
 * `maxEntries` × the embedder's dimension, so a 1000-entry cache over a 1536-dimension embedder is
 * on the order of megabytes, and it is plaintext: every prompt and response is readable. Do not point
 * `dir` at a directory that gets committed.
 */
export interface CachePersistenceOptions {
  /** `"memory"` for process-local, `"json"` for a file under {@link CachePersistenceOptions.dir}. */
  readonly backend: "memory" | "json";
  /**
   * Directory holding `<namespace>.json`. REQUIRED when `backend` is `"json"` — omitting it makes
   * `Cache.semantic(...)` throw `ZodError`, it is not silently downgraded to memory.
   *
   * Created recursively on the first write. Writes are atomic but DEBOUNCED by 200 ms, and loading
   * is fire-and-forget, so the file is eventually-consistent with memory in both directions. A
   * corrupt or wrong-schema file is logged and treated as an empty cache — it never blocks startup.
   */
  readonly dir?: string;
}

/* ─── Embedder option ─── */

/**
 * Embedder runtime shape — minimal subset of `EmbeddingRuntime` (D11) the
 * Cache actually uses. Lets tests inject fake embedders without pulling
 * the full memory subsystem.
 *
 * `@theokit/sdk-cache` ships one implementation, `createLexicalEmbedder()`; anything with these
 * four members works, including a wrapper around a provider's embedding endpoint.
 *
 * @public
 */
export interface CacheEmbedderRuntime {
  /**
   * Stable identity of this embedding SPACE, not of the object.
   *
   * It is part of the exact-match key and of the semantic eligibility filter, so changing it
   * invalidates every existing entry — which is the point: vectors from two different embedders
   * are not comparable, and a shared id would let one embedder's vectors be matched against
   * another's. Version it whenever the model, its parameters or the dimension change.
   */
  readonly id: string;
  /** Human-facing model name. Recorded for diagnostics; the cache never keys on it. */
  readonly model: string;
  /**
   * Length of the vectors `embed` returns.
   *
   * Entries whose stored vector has a different length are skipped during the semantic scan rather
   * than compared, so a dimension change silently costs you the whole warm cache instead of
   * throwing.
   */
  readonly dimension: number;
  /**
   * Embed a batch; the cache always passes exactly one text and reads `result[0]`.
   *
   * A rejection is NOT propagated to the caller: the cache logs it, counts it in
   * {@link CacheStats.embedderFailures} and treats the operation as a miss / skipped write. Return
   * a zero vector only if you want it treated as a non-match, since cosine distance against it is
   * defined as 1.0.
   */
  embed(texts: ReadonlyArray<string>): Promise<number[][]>;
}

/* ─── Options ─── */

/**
 * Configuration for `Cache.semantic(...)`.
 *
 * Only `embedder` is required, and deliberately so: autoselecting one would make an agent start
 * calling an embedding API because a cache was enabled, which is a surprise bill rather than a
 * default. Everything else has a working default.
 *
 * The lookup runs in two stages — an exact key match first, then a vector search — so an identical
 * prompt never pays for an embedding call. Only the second stage consults `threshold`.
 */
export interface CacheSemanticOptions {
  /** Embedder instance. REQUIRED in v1 — no autoselect (avoids surprise API calls). */
  readonly embedder: CacheEmbedderRuntime;
  /**
   * Maximum cosine DISTANCE (`1 - cosine similarity`) at which a stored entry counts as a match.
   * Default 0.85. Lower is stricter; 0 requires an identical direction, 1 accepts orthogonal
   * vectors, and the accepted range is 0..2.
   *
   * It is a distance and not a similarity, so raising it LOOSENS matching — 0.85 is already
   * permissive for normalized embeddings and will return semantically unrelated answers if your
   * embedder spreads vectors narrowly. Only the vector stage consults it; an exact-key hit ignores
   * it entirely. Watch {@link CacheStats.semanticHits} when you tune it.
   */
  readonly threshold?: number;
  /** TTL config. Default `{ default: "1h" }`. */
  readonly ttl?: CacheTTLConfig;
  /**
   * Isolation bucket, 1..64 chars. Default `"global"`. Entries never match across namespaces.
   *
   * It is also the plugin name (`cache-semantic-<namespace>`) and, under `"json"` persistence, the
   * FILE name — so two caches sharing a namespace and a `dir` write over each other's snapshot,
   * last flush winning.
   */
  readonly namespace?: string;
  /**
   * Model id stamped on every entry, and part of both the exact key and the semantic eligibility
   * filter — a response cached for one model is never returned for another.
   *
   * Defaults to the literal string `"unknown"`, which is an ORDINARY value rather than a wildcard:
   * entries written by a cache that defaulted it are visible only to another cache that also
   * defaults it. Set it to the same id you pass to `Agent.create({ model })`.
   */
  readonly modelId?: string;
  /**
   * Ceiling on stored entries. Default 1000. Exceeding it evicts the least recently used entry and
   * increments {@link CacheStats.evicted}.
   *
   * Sizes the JSON snapshot too: the file holds every entry's full embedding, so this multiplied by
   * the embedder dimension is the file's order of magnitude.
   */
  readonly maxEntries?: number;
  /** Persistence backend. Default in-memory. */
  readonly persistence?: CachePersistenceOptions;
}

/* ─── Entry + stats ─── */

/**
 * One cached prompt/response pair, as `Cache` stores it.
 *
 * Read-only from the outside: entries are produced by the cache, and reach a caller only through a
 * `"json"` persistence dump. `vector` is the embedding of `prompt`, which is what makes the file
 * large; `accessedAt` / `accessCount` are what LRU eviction reads when `maxEntries` is reached.
 *
 * `key` is the exact-match key (a hash of namespace, embedder, model and prompt), so two entries with
 * the same prompt under different models are different entries — a cached answer never crosses a
 * model boundary.
 */
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

/**
 * Counters returned by `Cache.stats()`. All monotonic within a process; a `"json"` backend does not
 * restore them, so they count THIS process's traffic, not the file's history.
 *
 * The three miss-shaped counters are distinct on purpose, and the distinction is the point of
 * reading stats at all:
 *
 * - `misses` — looked up, nothing matched. The cache is working and cold. An empty or
 *   whitespace-only prompt also lands here, having never been looked up at all.
 * - `excluded` — {@link CacheTTLConfig.exclude} matched the prompt, so no lookup happened. High and
 *   unexpected means the regex is too broad.
 * - `embedderFailures` — the embedder threw. The lookup DEGRADES to a miss rather than failing the
 *   call, so a broken embedder shows up here as a rising number and nowhere else. A cache that
 *   suddenly stops hitting, with this climbing, is an embedder outage — not a cold cache.
 *
 * `kvHits` counts exact-key matches (no embedding call); `semanticHits` counts vector matches.
 * A `semanticHits` of zero with healthy `kvHits` means `threshold` is too strict.
 */
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

/**
 * The embedder rejected or failed a call.
 *
 * NOTHING IN THIS PACKAGE THROWS IT TODAY, and a `catch` written for it will never fire. Every
 * embedder failure on every path — `consult`, `remember`, and both plugin hooks — degrades to a
 * cache miss / skipped write, logs a warning on stderr and increments
 * {@link CacheStats.embedderFailures}, because a cache is an optimisation and must not take the
 * request down with it. That counter, not this class, is how you detect a broken embedder.
 *
 * It is exported so a custom {@link CacheEmbedderRuntime} can throw a typed error from its own
 * `embed()`; the cache will still swallow it into a miss.
 *
 * `cause` carries the underlying error when there was one.
 */
export class CacheEmbedderError extends Error {
  override readonly name = "CacheEmbedderError";
  override readonly cause?: Error;
  constructor(message: string, cause?: Error) {
    super(`Cache embedder failed: ${message}`);
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * A TTL value that could not be parsed, thrown at configuration time rather than on first use.
 *
 * Accepts a number of SECONDS, or a string with a unit suffix `s` / `m` / `h` / `d` / `w`
 * (`"30m"`, `"1h"`, `"7d"`). A bare numeric string is not a duration — `"3600"` is rejected,
 * `3600` is an hour. Also rejected: a negative or non-finite number, and any unit outside that
 * set. `input` carries what was passed, so the message names the offending value rather than the
 * field.
 *
 * "Configuration time" means the first WRITE that applies the TTL, not `Cache.semantic(...)` —
 * `CacheSemanticOptions` is validated for shape, never for TTL parseability.
 */
export class CacheInvalidTtlError extends Error {
  override readonly name = "CacheInvalidTtlError";
  constructor(public readonly input: string | number) {
    super(
      `Invalid TTL value: "${String(input)}". Expected number (seconds) or string like "1h" / "30m" / "7d".`,
    );
  }
}
