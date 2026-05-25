/**
 * OTel telemetry for semantic cache (ADR D262).
 *
 * Spans:
 *   - `cache.lookup` — per `pre_user_send`. Attributes: namespace, embedder.id,
 *     hit (kv|semantic|miss), distance, ttl_remaining_s, bypass_reason.
 *   - `cache.store` — per `post_assistant_reply`. Attributes: bypass_reason, stored.
 *
 * @internal
 */

import {
  getTracer,
  noopSpan,
  resetTracerCacheForTests,
  type SpanLike,
} from "../observability/tracer-loader.js";

const TRACER_NAME = "@usetheo/sdk/cache";

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

/** Test seam — reset tracer cache so a fresh require attempt happens. */
export function __resetCacheTelemetryForTests(): void {
  resetTracerCacheForTests();
}
