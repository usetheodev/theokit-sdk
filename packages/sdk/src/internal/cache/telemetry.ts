/**
 * OTel telemetry for semantic cache (ADR D262).
 *
 * Lazy load via `createRequire` — zero cost when `@opentelemetry/api` is
 * not installed (pattern from D34/D206/D220/D241).
 *
 * Spans:
 *   - `cache.lookup` — per `pre_user_send`. Attributes: namespace, embedder.id,
 *     hit (kv|semantic|miss), distance, ttl_remaining_s, bypass_reason.
 *   - `cache.store` — per `post_assistant_reply`. Attributes: bypass_reason, stored.
 *
 * @internal
 */

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

let cachedTracer: TracerLike | undefined | null = undefined;

function getTracer(): TracerLike | undefined {
  if (cachedTracer === null) return undefined;
  if (cachedTracer !== undefined) return cachedTracer;
  try {
    const r = createRequire(import.meta.url);
    const otel = r("@opentelemetry/api") as {
      trace?: { getTracer: (name: string, version?: string) => TracerLike };
    };
    if (otel.trace?.getTracer === undefined) {
      cachedTracer = null;
      return undefined;
    }
    cachedTracer = otel.trace.getTracer("@usetheo/sdk/cache", "1.0.0");
    return cachedTracer;
  } catch {
    cachedTracer = null;
    return undefined;
  }
}

export function startCacheLookupSpan(info: {
  namespace: string;
  embedderId: string;
}): SpanLike {
  const tracer = getTracer();
  if (tracer === undefined) return noopSpan;
  return tracer.startSpan("cache.lookup", {
    attributes: {
      "cache.namespace": info.namespace,
      "cache.embedder_id": info.embedderId,
    },
  });
}

export function startCacheStoreSpan(info: {
  namespace: string;
  embedderId: string;
}): SpanLike {
  const tracer = getTracer();
  if (tracer === undefined) return noopSpan;
  return tracer.startSpan("cache.store", {
    attributes: {
      "cache.namespace": info.namespace,
      "cache.embedder_id": info.embedderId,
    },
  });
}

/** Test seam — reset tracer cache so a fresh require attempt happens. */
export function __resetCacheTelemetryForTests(): void {
  cachedTracer = undefined;
}
