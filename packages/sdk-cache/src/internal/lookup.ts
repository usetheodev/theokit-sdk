/**
 * Cache lookup handler — wired to `pre_user_send` hook (ADRs D259, D260).
 *
 * EC-1: embedder failure degrades to miss (cache is transparent).
 * EC-3: empty / whitespace prompt bypasses cache (avoids hash collision).
 * EC-5: telemetry span ends in finally even on early-return.
 *
 * @internal
 */

import type { CacheEmbedderRuntime, CacheTTLConfig } from "../types/cache.js";
import { embedOrDegrade } from "./embed-helper.js";
import { computeCacheKey } from "./key.js";
import type { InMemoryCacheStore } from "./store.js";
import type { JsonFileCacheStore } from "./store-json.js";
import { startCacheLookupSpan } from "./telemetry.js";

export type LookupableStore = InMemoryCacheStore | JsonFileCacheStore;

interface LookupParams {
  prompt: string;
  store: LookupableStore;
  embedder: CacheEmbedderRuntime;
  threshold: number;
  ttl: CacheTTLConfig;
  namespace: string;
  modelId: string;
}

interface LookupResult {
  cached: boolean;
  response?: string;
  source?: "kv" | "semantic";
  distance?: number;
}

export async function performLookup(p: LookupParams): Promise<LookupResult> {
  const span = startCacheLookupSpan({
    namespace: p.namespace,
    embedderId: p.embedder.id,
  });
  try {
    // EC-3: empty prompt bypass.
    if (p.prompt.trim().length === 0) {
      p.store.incrementMisses();
      span.setAttribute("cache.bypass_reason", "empty_prompt");
      return { cached: false };
    }
    // D255 exclude regex.
    if (p.ttl.exclude?.test(p.prompt)) {
      p.store.incrementExcluded();
      span.setAttribute("cache.bypass_reason", "exclude_regex");
      return { cached: false };
    }

    const key = computeCacheKey({
      namespace: p.namespace,
      embedderId: p.embedder.id,
      modelId: p.modelId,
      prompt: p.prompt,
    });
    const now = Date.now();

    // Step 1: KV exact (D259).
    const kv = p.store.kvGet(key, now);
    if (kv !== undefined) {
      p.store.incrementKvHits();
      span.setAttribute("cache.hit", "kv");
      span.setAttribute("cache.ttl_remaining_s", Math.floor((kv.expiresAt - now) / 1000));
      return { cached: true, response: kv.response, source: "kv" };
    }

    // Step 2: semantic — EC-1: embedder failure degrades to miss.
    const vec = await embedOrDegrade(p.embedder, p.prompt, p.store, span, "lookup");
    if (vec === undefined) return { cached: false };

    const match = p.store.semanticSearch(
      vec,
      p.threshold,
      p.embedder.id,
      p.namespace,
      now,
      p.modelId,
    );
    if (match !== undefined) {
      p.store.incrementSemanticHits();
      span.setAttribute("cache.hit", "semantic");
      span.setAttribute("cache.distance", match.distance);
      span.setAttribute("cache.ttl_remaining_s", Math.floor((match.entry.expiresAt - now) / 1000));
      return {
        cached: true,
        response: match.entry.response,
        source: "semantic",
        distance: match.distance,
      };
    }

    p.store.incrementMisses();
    span.setAttribute("cache.hit", "miss");
    return { cached: false };
  } finally {
    span.end();
  }
}
