/**
 * Shared embed-with-graceful-degradation helper — used by both `lookup.ts`
 * and `store-handler.ts`. Extracted to remove the embed-failure boilerplate
 * clone flagged by jscpd. EC-1 absorbed: embedder failure is silent (caller
 * decides what to do via the boolean return).
 *
 * @internal
 */

import type { CacheEmbedderRuntime } from "../types/cache.js";
import type { InMemoryCacheStore } from "./store.js";
import type { JsonFileCacheStore } from "./store-json.js";

interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): SpanLike;
}

export async function embedOrDegrade(
  embedder: CacheEmbedderRuntime,
  prompt: string,
  store: InMemoryCacheStore | JsonFileCacheStore,
  span: SpanLike,
  context: "lookup" | "store",
): Promise<number[] | undefined> {
  try {
    const result = await embedder.embed([prompt]);
    return result[0]!;
  } catch (err) {
    store.incrementEmbedderFailures();
    const action = context === "lookup" ? "degrading to miss" : "skipping cache write";
    console.warn(
      `[cache] embedder failed during ${context}, ${action}:`,
      err instanceof Error ? err.message : err,
    );
    span.setAttribute("cache.bypass_reason", "embedder_failure");
    return undefined;
  }
}
