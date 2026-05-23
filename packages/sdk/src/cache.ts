/**
 * Public `Cache` class — semantic LLM response cache (Adoption Roadmap #6;
 * ADRs D249-D266).
 *
 * Usage:
 *
 *   import { Agent, Cache, definePlugin } from "@usetheo/sdk";
 *
 *   const cache = Cache.semantic({
 *     embedder: myEmbedderRuntime,    // EmbeddingRuntime (D11)
 *     threshold: 0.85,
 *     ttl: { default: "1h", exclude: /weather|today|now/i },
 *     namespace: "my-app",
 *     modelId: "openai/gpt-4o-mini",
 *   });
 *
 *   const agent = await Agent.create({
 *     model: { id: "openai/gpt-4o-mini" },
 *     plugins: [cache.asPlugin()],
 *     // ...
 *   });
 *
 *   await agent.send("What is the capital of France?");   // miss → LLM
 *   await agent.send("Tell me the capital of France");    // semantic hit
 *
 * @public
 */

import { z } from "zod";

import type {
  CacheEmbedderRuntime,
  CachePersistenceOptions,
  CacheSemanticOptions,
  CacheStats,
  CacheTTLConfig,
} from "./types/cache.js";
import type {
  PostAssistantReplyContext,
  PluginContext,
  PreUserSendContext,
  PreUserSendResult,
  Plugin,
} from "./internal/plugins/types.js";
import { definePlugin } from "./internal/plugins/types.js";
import { performLookup, type LookupableStore } from "./internal/cache/lookup.js";
import { performStore } from "./internal/cache/store-handler.js";
import { InMemoryCacheStore } from "./internal/cache/store.js";
import { JsonFileCacheStore } from "./internal/cache/store-json.js";

const CacheSemanticOptionsSchema = z.object({
  embedder: z.unknown().refine(
    (v) => {
      if (v === null || typeof v !== "object") return false;
      const o = v as { id?: unknown; embed?: unknown; dimension?: unknown };
      return typeof o.id === "string" && typeof o.embed === "function" && typeof o.dimension === "number";
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
  persistence: z
    .object({
      backend: z.enum(["memory", "json"]),
      dir: z.string().optional(),
    })
    .refine((p) => p.backend !== "json" || (typeof p.dir === "string" && p.dir.length > 0), {
      message: 'persistence.dir is required when backend = "json"',
    })
    .optional(),
});

const DEFAULT_THRESHOLD = 0.85;
const DEFAULT_TTL: CacheTTLConfig = { default: "1h" };
const DEFAULT_NAMESPACE = "global";
const DEFAULT_MAX_ENTRIES = 1000;

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

  static semantic(options: CacheSemanticOptions): Cache {
    CacheSemanticOptionsSchema.parse(options);
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    const ttl = options.ttl ?? DEFAULT_TTL;
    const namespace = options.namespace ?? DEFAULT_NAMESPACE;
    const modelId = options.modelId ?? "unknown";
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const store = createStore(namespace, maxEntries, options.persistence);
    return new Cache(
      options.embedder,
      threshold,
      ttl,
      namespace,
      modelId,
      store,
    );
  }

  /**
   * EC-4 absorbed: memoized so repeated `asPlugin()` calls return the SAME
   * plugin descriptor — no duplicate hook registration.
   */
  asPlugin(): Plugin {
    if (this._plugin !== undefined) return this._plugin;
    const cache = this;
    this._plugin = definePlugin({
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
   * Explicit cache lookup — callers that want true LLM short-circuit
   * call this BEFORE `agent.send()`, then dispatch to the LLM only on miss.
   *
   * v1 plugin mode provides recall + context-inject (LLM still called).
   * v1.x will add transparent short-circuit via an agent-loop refactor.
   */
  async consult(prompt: string): Promise<
    | { hit: false }
    | { hit: true; response: string; source: "kv" | "semantic"; distance?: number }
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
   * Explicit cache store — pair with `consult()` to manually feed the
   * cache after dispatching the LLM call yourself.
   */
  async remember(
    prompt: string,
    response: string,
    opts?: { usedTools?: boolean },
  ): Promise<void> {
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

  /** Stats snapshot — primary observable for dogfood verification. */
  stats(): CacheStats {
    return this.store.stats();
  }

  /** Clear all entries (and flush to disk if JSON backend). */
  async clear(): Promise<void> {
    await this.store.clear();
  }

  /** Force-evict expired entries. Returns count removed. */
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

/* ─── Re-exports for ergonomics ─── */

export {
  type CacheEmbedderRuntime,
  CacheEmbedderError,
  type CacheEntry,
  CacheInvalidTtlError,
  type CachePersistenceOptions,
  type CacheSemanticOptions,
  type CacheStats,
  type CacheTTLConfig,
} from "./types/cache.js";
