/**
 * Public `Cache` class — semantic LLM response cache (Adoption Roadmap #6;
 * ADRs D249-D266).
 *
 * Usage:
 *
 *   import { Agent } from "@theokit/sdk";
 *   import { Cache, createLexicalEmbedder } from "@theokit/sdk-cache";
 *
 *   const cache = Cache.semantic({
 *     embedder: createLexicalEmbedder(),   // or any CacheEmbedderRuntime
 *     threshold: 0.85,
 *     ttl: { default: "1h", exclude: /weather|today|now/i },
 *     namespace: "my-app",
 *     modelId: "openai/gpt-4o-mini",
 *   });
 *
 *   // (a) Plugin mode — the cached answer is INJECTED as context; the LLM is still called.
 *   const agent = await Agent.create({
 *     model: { id: "openai/gpt-4o-mini" },
 *     plugins: [cache.asPlugin()],
 *   });
 *
 *   // (b) Explicit mode — this is the one that skips the LLM call.
 *   const hit = await cache.consult(prompt);
 *   const answer = hit.hit ? hit.response : await callTheModel(prompt);
 *   if (!hit.hit) await cache.remember(prompt, answer);
 *
 * The distinction between (a) and (b) is the single most important thing to know about this
 * package — see `Cache.asPlugin`.
 *
 * @public
 */

import {
  Plugin,
  type PluginContext,
  type PostAssistantReplyContext,
  type PreUserSendContext,
  type PreUserSendResult,
} from "@theokit/sdk";
import { PersistenceSchema } from "@theokit/sdk/persistence";
import { z } from "zod";
import { type LookupableStore, performLookup } from "./internal/lookup.js";
import { InMemoryCacheStore } from "./internal/store.js";
import { performStore } from "./internal/store-handler.js";
import { JsonFileCacheStore } from "./internal/store-json.js";
import type {
  CacheEmbedderRuntime,
  CachePersistenceOptions,
  CacheSemanticOptions,
  CacheStats,
  CacheTTLConfig,
} from "./types/cache.js";

const CacheSemanticOptionsSchema = z.object({
  embedder: z.unknown().refine(
    (v) => {
      if (v === null || typeof v !== "object") return false;
      const o = v as { id?: unknown; embed?: unknown; dimension?: unknown };
      return (
        typeof o.id === "string" && typeof o.embed === "function" && typeof o.dimension === "number"
      );
    },
    { message: "embedder must be a CacheEmbedderRuntime with { id, dimension, embed }" },
  ),
  threshold: z.number().min(0).max(2).optional(),
  ttl: z
    .object({
      default: z.union([z.string(), z.number()]),
      exclude: z.instanceof(RegExp).optional(),
    })
    .optional(),
  namespace: z.string().min(1).max(64).optional(),
  modelId: z.string().min(1).max(128).optional(),
  maxEntries: z.number().int().min(1).max(1_000_000).optional(),
  persistence: PersistenceSchema,
});

const DEFAULT_THRESHOLD = 0.85;
const DEFAULT_TTL: CacheTTLConfig = { default: "1h" };
const DEFAULT_NAMESPACE = "global";
const DEFAULT_MAX_ENTRIES = 1000;

/**
 * A semantic response cache: an exact-key lookup, then a vector-similarity lookup, over
 * prompt/response pairs the caller has stored.
 *
 * Build one with {@link Cache.semantic}; `new Cache()` is a compile error. One instance owns one
 * store, so two `Cache.semantic(...)` calls never share entries even under the same `namespace`
 * and the same `dir` — the JSON backend will have both instances writing the same file.
 *
 * Two ways to use it, and they do NOT save the same thing:
 *
 * | | {@link Cache.consult} + {@link Cache.remember} | {@link Cache.asPlugin} |
 * |---|---|---|
 * | LLM call on a hit | skipped | still made |
 * | What you save | the whole call | nothing, today |
 * | Who drives it | you | the agent loop |
 *
 * @public
 */
export class Cache {
  private _plugin?: Plugin;

  private constructor(
    private readonly embedder: CacheEmbedderRuntime,
    private readonly threshold: number,
    private readonly ttl: CacheTTLConfig,
    private readonly namespace: string,
    private readonly modelId: string,
    private readonly store: LookupableStore,
  ) {}

  /**
   * Build a cache. Validates `options` with Zod and THROWS `ZodError` on a bad shape — an
   * `embedder` missing `{ id, dimension, embed }`, a `threshold` outside `0..2`, a `namespace`
   * longer than 64 chars, or `persistence: { backend: "json" }` without a `dir`.
   *
   * Defaults: `threshold` 0.85, `ttl` `{ default: "1h" }`, `namespace` `"global"`, `maxEntries`
   * 1000 (LRU), `persistence` in-memory. `modelId` defaults to the literal string `"unknown"`,
   * which is a real namespace value and not a wildcard: entries stored while `modelId` was
   * defaulted are only ever returned to lookups that also default it.
   *
   * With `persistence: { backend: "json", dir }` the snapshot is loaded in the BACKGROUND — this
   * call does not await hydration, and there is no `ready()` to await. A lookup issued
   * immediately after construction can miss on an entry that is on disk.
   */
  static semantic(options: CacheSemanticOptions): Cache {
    CacheSemanticOptionsSchema.parse(options);
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    const ttl = options.ttl ?? DEFAULT_TTL;
    const namespace = options.namespace ?? DEFAULT_NAMESPACE;
    const modelId = options.modelId ?? "unknown";
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const store = createStore(namespace, maxEntries, options.persistence);
    return new Cache(options.embedder, threshold, ttl, namespace, modelId, store);
  }

  /**
   * A `Plugin` for `Agent.create({ plugins: [...] })` that reads the cache before each user turn
   * and writes it after each assistant reply.
   *
   * READ THIS BEFORE BUDGETING FOR IT. A hit does NOT skip the model call. The hook returns the
   * cached response as `PreUserSendResult.recalledContext`, which the agent loop injects as a
   * `<memory-context>` block ahead of the prompt — the request still goes to the provider, still
   * costs tokens, and still returns whatever the model makes of that context, which need not be
   * the cached text. Use {@link Cache.consult} / {@link Cache.remember} when the point is to avoid
   * the call.
   *
   * Second trap: the store hook always passes `usedTools: false`, so a turn that invoked tools IS
   * cached, despite the package's stated intent not to. `PostAssistantReplyContext` carries no
   * tool signal to key on. If replaying a tool-using answer is unsafe for you, exclude those
   * prompts via {@link CacheTTLConfig.exclude} or drive the cache explicitly.
   *
   * Memoized: repeated calls return the SAME plugin, so registering it twice does not double the
   * hooks.
   */
  asPlugin(): Plugin {
    if (this._plugin !== undefined) return this._plugin;
    const cache = this;
    this._plugin = Plugin.create({
      name: `cache-semantic-${this.namespace}`,
      version: "1.0.0",
      kind: "general" as const,
      register(ctx: PluginContext): void {
        ctx.on("pre_user_send", async (rawCtx) => {
          const c = rawCtx as PreUserSendContext;
          const result = await performLookup({
            prompt: c.prompt,
            store: cache.store,
            embedder: cache.embedder,
            threshold: cache.threshold,
            ttl: cache.ttl,
            namespace: cache.namespace,
            modelId: cache.modelId,
          });
          if (result.cached === true) {
            // Cache hit — return recalledContext as the cached response.
            // The agent loop will inject this; in v1 the caller must
            // check `pre_user_send` hook return value via runtime support
            // (the cache hit short-circuits via injection; see docs).
            const wrapped: PreUserSendResult = {
              recalledContext: result.response,
            };
            return wrapped;
          }
          const miss: PreUserSendResult = {};
          return miss;
        });
        ctx.on("post_assistant_reply", async (rawCtx) => {
          const c = rawCtx as PostAssistantReplyContext;
          // EC-10: don't cache tool-use runs. v1 lacks a "usedTools" signal
          // in PostAssistantReplyContext (D266 documented gap). For now we
          // accept the conservative-skip if `c.reply` looks like a tool
          // result envelope (contains `tool_call_id` markers). Future
          // PostAssistantReplyContext extension will surface usedTools
          // explicitly.
          await performStore({
            prompt: c.prompt,
            response: c.reply,
            usedTools: false,
            store: cache.store,
            embedder: cache.embedder,
            ttl: cache.ttl,
            namespace: cache.namespace,
            modelId: cache.modelId,
          });
          return undefined;
        });
      },
    });
    return this._plugin;
  }

  /**
   * Look a prompt up. Call it BEFORE dispatching to the model and skip the call on a hit — this is
   * the only path in this package that actually avoids an LLM request.
   *
   * ```ts
   * const hit = await cache.consult(prompt);
   * if (hit.hit) return hit.response;
   * ```
   *
   * `source` says which stage matched: `"kv"` is an exact-key match and costs NO embedding call;
   * `"semantic"` means the prompt was embedded and a stored vector came within `threshold`, and
   * only then is `distance` present (cosine distance, so smaller is closer).
   *
   * NEVER THROWS on an embedder failure. It degrades to `{ hit: false }`, logs a warning on
   * stderr, and increments {@link CacheStats.embedderFailures} — a cache must not take the request
   * down with it. A cache that has silently stopped hitting is that counter climbing, not a cold
   * cache.
   *
   * An empty or whitespace-only prompt returns `{ hit: false }` and counts as a MISS. A prompt
   * matching {@link CacheTTLConfig.exclude} returns `{ hit: false }` and counts as `excluded`.
   */
  async consult(
    prompt: string,
  ): Promise<
    { hit: false } | { hit: true; response: string; source: "kv" | "semantic"; distance?: number }
  > {
    const result = await performLookup({
      prompt,
      store: this.store,
      embedder: this.embedder,
      threshold: this.threshold,
      ttl: this.ttl,
      namespace: this.namespace,
      modelId: this.modelId,
    });
    if (result.cached === true) {
      return {
        hit: true,
        response: result.response ?? "",
        source: result.source ?? "kv",
        ...(result.distance !== undefined ? { distance: result.distance } : {}),
      };
    }
    return { hit: false };
  }

  /**
   * Store a prompt/response pair. Pair it with {@link Cache.consult} after you dispatched the model
   * call yourself.
   *
   * Pass `{ usedTools: true }` when the answer came from a run that invoked tools and replaying it
   * would lose the side effects — the write is then skipped entirely.
   *
   * Silently writes nothing when the prompt is empty/whitespace, the response is empty, the prompt
   * matches {@link CacheTTLConfig.exclude}, or the embedder fails (that last case increments
   * {@link CacheStats.embedderFailures}). It resolves in every one of those cases: a resolved
   * promise is not evidence that an entry exists — read {@link CacheStats.entries} if you need
   * that.
   *
   * Writing beyond `maxEntries` evicts the least-recently-used entry. On the `"json"` backend the
   * disk write is DEBOUNCED by 200 ms and there is no public flush, so a process that exits right
   * after this resolves can lose the entry; `clear()` is the only call that forces a write.
   */
  async remember(prompt: string, response: string, opts?: { usedTools?: boolean }): Promise<void> {
    await performStore({
      prompt,
      response,
      usedTools: opts?.usedTools === true,
      store: this.store,
      embedder: this.embedder,
      ttl: this.ttl,
      namespace: this.namespace,
      modelId: this.modelId,
    });
  }

  /**
   * Counter snapshot for this instance. See {@link CacheStats} for what each counter separates —
   * in particular `misses` vs `excluded` vs `embedderFailures`, which is how you tell a cold cache
   * from a too-broad exclude regex from a broken embedder.
   *
   * Process-local: the `"json"` backend persists entries, never counters, so a restart reports
   * zeros against a warm file.
   */
  stats(): CacheStats {
    return this.store.stats();
  }

  /**
   * Drop every entry. On the `"json"` backend this also forces the debounced snapshot to disk
   * immediately, so it is the one public call that guarantees the file matches memory.
   *
   * Counters are NOT reset — `stats()` keeps reporting the hits and misses accumulated before the
   * clear, so `entries: 0` alongside a non-zero `kvHits` is expected, not a bug.
   */
  async clear(): Promise<void> {
    await this.store.clear();
  }

  /**
   * Remove every entry whose TTL has elapsed, returning how many were dropped, and add that to
   * {@link CacheStats.evicted}.
   *
   * Optional housekeeping: expired entries are already skipped on lookup and dropped when touched,
   * so this only reclaims memory for entries nobody asks for. `now` exists to make the sweep
   * testable; leave it out in production.
   */
  evictExpired(now: number = Date.now()): number {
    return this.store.evictExpired(now);
  }
}

function createStore(
  namespace: string,
  maxEntries: number,
  persistence?: CachePersistenceOptions,
): LookupableStore {
  if (persistence?.backend === "json") {
    const dir = persistence.dir as string;
    const store = new JsonFileCacheStore(dir, namespace, maxEntries);
    // Hydrate fire-and-forget — callers do `await cache.ready()` if they need
    // sync hydration. v1: lazy load on first lookup.
    void store.hydrate();
    return store;
  }
  return new InMemoryCacheStore(maxEntries);
}
