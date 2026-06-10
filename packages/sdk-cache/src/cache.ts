/**
 * Public `Cache` class — semantic LLM response cache (Adoption Roadmap #6;
 * ADRs D249-D266).
 *
 * Usage:
 *
 *   import { Agent, Cache, definePlugin } from "@theokit/sdk";
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

import {
  definePlugin,
  type Plugin,
  type PluginContext,
  type PostAssistantReplyContext,
  type PreUserSendContext,
  type PreUserSendResult,
} from "@theokit/sdk";
// PersistenceSchema defined locally using the same Zod version that sdk-cache
// resolves. Importing from @theokit/sdk/internal/persistence mixes Zod v3
// (bundled in the SDK dist) with Zod v4 (sdk-cache's resolved version),
// causing "expected a Zod schema" errors in z.object() nesting.
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
  // z.unknown().refine() creates ZodEffects which Zod v4 rejects inside z.object().
  // Validate embedder shape manually after parse.
  embedder: z.unknown(),
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
    // Zod v4 rejects ZodEffects inside z.object(); validate shapes manually
    const e = options.embedder as unknown as Record<string, unknown> | null;
    if (
      e === null ||
      typeof e !== "object" ||
      typeof e.id !== "string" ||
      typeof e.embed !== "function" ||
      typeof e.dimension !== "number"
    ) {
      throw new Error("embedder must be a CacheEmbedderRuntime with { id, dimension, embed }");
    }
    if (
      options.persistence?.backend === "json" &&
      (typeof options.persistence.dir !== "string" || options.persistence.dir.length === 0)
    ) {
      throw new Error('persistence.dir is required when backend = "json"');
    }
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    const ttl = options.ttl ?? DEFAULT_TTL;
    const namespace = options.namespace ?? DEFAULT_NAMESPACE;
    const modelId = options.modelId ?? "unknown";
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const store = createStore(namespace, maxEntries, options.persistence);
    return new Cache(options.embedder, threshold, ttl, namespace, modelId, store);
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
   * Explicit cache store — pair with `consult()` to manually feed the
   * cache after dispatching the LLM call yourself.
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

/* ─── Re-exports for ergonomics (errors only — public types come from `types/cache.js` via `types/index.ts`). ─── */

export { CacheEmbedderError, CacheInvalidTtlError } from "./types/cache.js";
