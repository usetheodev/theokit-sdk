/**
 * Cache store handler — wired to `post_assistant_reply` hook (ADRs D260, D266).
 *
 * EC-1: embedder failure during store is silent (LLM call already succeeded;
 * no cache entry written).
 * EC-3: empty prompt bypass.
 * EC-10 / D266: skip storage when the run invoked tools (replay loses
 * side-effects).
 *
 * @internal
 */

import type {
  CacheEmbedderRuntime,
  CacheTTLConfig,
} from "../../types/cache.js";
import { computeCacheKey } from "./key.js";
import type { LookupableStore } from "./lookup.js";
import { parseTtlMs } from "./ttl.js";
import { startCacheStoreSpan } from "./telemetry.js";

export interface StoreParams {
  prompt: string;
  response: string;
  /** D266: skip cache when tools were used. */
  usedTools?: boolean;
  store: LookupableStore;
  embedder: CacheEmbedderRuntime;
  ttl: CacheTTLConfig;
  namespace: string;
  modelId: string;
}

export async function performStore(p: StoreParams): Promise<void> {
  const span = startCacheStoreSpan({
    namespace: p.namespace,
    embedderId: p.embedder.id,
  });
  try {
    // EC-3: empty prompt bypass.
    if (p.prompt.trim().length === 0) {
      span.setAttribute("cache.bypass_reason", "empty_prompt");
      return;
    }
    // EC-3 + safety: empty response is not a useful cache entry.
    if (p.response.length === 0) {
      span.setAttribute("cache.bypass_reason", "empty_response");
      return;
    }
    // D266 / EC-10: tool-use runs are not cached (replay loses side-effects).
    if (p.usedTools === true) {
      span.setAttribute("cache.bypass_reason", "used_tools");
      return;
    }
    // D255 exclude regex.
    if (p.ttl.exclude !== undefined && p.ttl.exclude.test(p.prompt)) {
      span.setAttribute("cache.bypass_reason", "exclude_regex");
      return;
    }

    const key = computeCacheKey({
      namespace: p.namespace,
      embedderId: p.embedder.id,
      modelId: p.modelId,
      prompt: p.prompt,
    });

    // EC-1: embedder failure during store is silent.
    let vec: number[];
    try {
      const result = await p.embedder.embed([p.prompt]);
      vec = result[0]!;
    } catch (err) {
      p.store.incrementEmbedderFailures();
      console.warn(
        `[cache] embedder failed during store, skipping cache write:`,
        err instanceof Error ? err.message : err,
      );
      span.setAttribute("cache.bypass_reason", "embedder_failure");
      return;
    }

    const now = Date.now();
    const ttlMs = parseTtlMs(p.ttl.default);
    p.store.set({
      key,
      namespace: p.namespace,
      embedderId: p.embedder.id,
      modelId: p.modelId,
      prompt: p.prompt,
      response: p.response,
      vector: vec,
      createdAt: now,
      expiresAt: now + ttlMs,
      accessedAt: now,
      accessCount: 0,
    });
    span.setAttribute("cache.stored", true);
  } finally {
    span.end();
  }
}
