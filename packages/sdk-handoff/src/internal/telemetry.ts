/**
 * D220 — Lazy-loaded OTel `handoff.transfer` span emitter.
 *
 * Emitted ONLY when `@opentelemetry/api` resolves from THIS package's directory.
 * It is an optional peer dependency: not installed for you, and under an isolated
 * node_modules layout a copy installed for some other package is not visible here.
 * When the require fails, `getTracer` caches `null` and every span becomes a no-op
 * — silently, with no warning, unlike `@theokit/sdk`'s own tracer, which prints one
 * when `telemetry.enabled = true` and OTel is absent.
 *
 * @internal
 */

// Inline tracer-loader (same workaround as @theokit/sdk-cache/internal/telemetry.ts):
// rollup-plugin-dts emits incomplete index.d.ts for newly-modified internal/ barrels
// in @theokit/sdk. Runtime via the sub-path works; TypeScript users hit TS2305.
// Inlining keeps sdk-handoff self-contained for the (small) observability hook.
import { createRequire } from "node:module";

interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): SpanLike;
  end(): void;
}

const _NOOP_SPAN: SpanLike = {
  setAttribute: () => _NOOP_SPAN,
  end: () => undefined,
};

interface TracerLike {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean> },
  ): SpanLike;
}

interface TracerCacheEntry {
  tracer: TracerLike | null;
}
const tracerCache = new Map<string, TracerCacheEntry>();

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

const TRACER_NAME = "theokit-sdk-handoff";

interface HandoffSpanHandle {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

const NOOP: HandoffSpanHandle = { setAttribute: () => undefined, end: () => undefined };

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function startHandoffSpan(attrs: {
  from: string;
  to: string;
  reason: string;
  depth: number;
  toolName: string;
}): HandoffSpanHandle {
  const tracer = getTracer(TRACER_NAME);
  if (tracer === undefined) return NOOP;
  const span: SpanLike | undefined = safe(
    () =>
      tracer.startSpan("handoff.transfer", {
        attributes: {
          "handoff.from": attrs.from,
          "handoff.to": attrs.to,
          "handoff.reason": attrs.reason,
          "handoff.depth": attrs.depth,
          "handoff.tool_name": attrs.toolName,
        },
      }),
    undefined,
  );
  if (span === undefined) return NOOP;
  return {
    setAttribute: (k, v) => safe(() => span.setAttribute(k, v), undefined),
    end: () => safe(() => span.end(), undefined),
  };
}
