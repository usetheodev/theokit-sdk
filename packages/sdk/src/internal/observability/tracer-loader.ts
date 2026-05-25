/**
 * Shared OTel tracer loader (extracted to eliminate cross-module clones —
 * was previously inlined in cache/, workflow/, eval/, handoff/ telemetry
 * modules). Lazy-loads `@opentelemetry/api` via `createRequire`; users
 * without OTel installed pay zero cost.
 *
 * @internal
 */

import { createRequire } from "node:module";

export interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): SpanLike;
  end(): void;
}

export const noopSpan: SpanLike = {
  setAttribute: () => noopSpan,
  end: () => undefined,
};

export interface TracerLike {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean> },
  ): SpanLike;
}

interface CacheEntry {
  tracer: TracerLike | null;
}

const tracerCache = new Map<string, CacheEntry>();

export function getTracer(name: string, version = "1.0.0"): TracerLike | undefined {
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

export function resetTracerCacheForTests(): void {
  tracerCache.clear();
}
