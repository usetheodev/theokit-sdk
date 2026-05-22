/**
 * D220 — Lazy-loaded OTel `handoff.transfer` span emitter. Mirrors
 * `internal/eval/telemetry.ts`. No-op when @opentelemetry/api absent.
 *
 * @internal
 */

import { createRequire } from "node:module";

interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

interface MinimalOTelApi {
  trace: {
    getTracer(name: string, version?: string): {
      startSpan(name: string, opts?: { attributes?: Record<string, string | number | boolean> }): OTelSpan;
    };
  };
}

let cachedOtel: MinimalOTelApi | null | undefined;

function loadOtel(): MinimalOTelApi | null {
  if (cachedOtel !== undefined) return cachedOtel;
  try {
    const r = createRequire(import.meta.url);
    cachedOtel = r("@opentelemetry/api") as MinimalOTelApi;
  } catch {
    cachedOtel = null;
  }
  return cachedOtel;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export interface HandoffSpanHandle {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

const NOOP: HandoffSpanHandle = { setAttribute: () => undefined, end: () => undefined };

export function startHandoffSpan(attrs: {
  from: string;
  to: string;
  reason: string;
  depth: number;
  toolName: string;
}): HandoffSpanHandle {
  const otel = loadOtel();
  if (otel === null) return NOOP;
  const tracer = safe(() => otel.trace.getTracer("theokit-sdk-handoff", "1.0.0"), undefined);
  if (tracer === undefined) return NOOP;
  const span = safe(
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

/** Test-only — reset cached OTel handle. */
export function __resetHandoffOtelCacheForTests(): void {
  cachedOtel = undefined;
}
