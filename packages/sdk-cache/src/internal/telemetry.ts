/**
 * OTel telemetry for semantic cache (ADR D262).
 *
 * Spans:
 *   - `cache.lookup` — per `pre_user_send`. Attributes: namespace, embedder.id,
 *     hit (kv|semantic|miss), distance, ttl_remaining_s, bypass_reason.
 *   - `cache.store` — per `post_assistant_reply`. Attributes: bypass_reason, stored.
 *
 * Emitted ONLY when `@opentelemetry/api` resolves from THIS package's directory.
 * It is an optional peer dependency: not installed for you, and under an isolated
 * node_modules layout a copy installed for some other package is not visible here.
 * When the require fails, `getTracer` caches `null` and every span becomes the
 * no-op below — silently, with no warning, unlike `@theokit/sdk`'s own tracer,
 * which prints one when `telemetry.enabled = true` and OTel is absent. So "no
 * cache spans in the trace" means the module is missing far more often than it
 * means the cache was never consulted.
 *
 * @internal
 */

// SDK 2.0 split: observability primitives live in @theokit/sdk.
// The sub-path barrel was avoided due to a rollup-plugin-dts edge case
// that emitted an empty index.d.ts for newly-added internal barrels;
// re-exporting locally produces the same runtime behavior with stable types.
import { createRequire } from "node:module";

interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): SpanLike;
  end(): void;
}

const noopSpan: SpanLike = {
  setAttribute: () => noopSpan,
  end: () => undefined,
};

interface TracerLike {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean> },
  ): SpanLike;
}

interface CacheEntry {
  tracer: TracerLike | null;
}
const tracerCache = new Map<string, CacheEntry>();

function getTracer(name: string, version = "1.0.0"): TracerLike | undefined {
  const cached = tracerCache.get(name);
  if (cached !== undefined) return cached.tracer ?? undefined;
  try {
    const r = createRequire(import.meta.url);
    const otel = r("@opentelemetry/api") as {
      trace?: { getTracer: (n: string, v?: string) => TracerLike };
    };
    if (otel.trace?.getTracer === undefined) {
      tracerCache.set(name, { tracer: null });
      return undefined;
    }
    const tracer = otel.trace.getTracer(name, version);
    tracerCache.set(name, { tracer });
    return tracer;
  } catch {
    tracerCache.set(name, { tracer: null });
    return undefined;
  }
}

const TRACER_NAME = "@theokit/sdk/cache";

export function startCacheLookupSpan(info: { namespace: string; embedderId: string }): SpanLike {
  const tracer = getTracer(TRACER_NAME);
  if (tracer === undefined) return noopSpan;
  return tracer.startSpan("cache.lookup", {
    attributes: {
      "cache.namespace": info.namespace,
      "cache.embedder_id": info.embedderId,
    },
  });
}

export function startCacheStoreSpan(info: { namespace: string; embedderId: string }): SpanLike {
  const tracer = getTracer(TRACER_NAME);
  if (tracer === undefined) return noopSpan;
  return tracer.startSpan("cache.store", {
    attributes: {
      "cache.namespace": info.namespace,
      "cache.embedder_id": info.embedderId,
    },
  });
}
