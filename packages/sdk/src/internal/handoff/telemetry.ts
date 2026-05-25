/**
 * D220 — Lazy-loaded OTel `handoff.transfer` span emitter.
 *
 * @internal
 */

import {
  getTracer,
  resetTracerCacheForTests,
  type SpanLike,
} from "../observability/tracer-loader.js";

const TRACER_NAME = "theokit-sdk-handoff";

export interface HandoffSpanHandle {
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

/** Test-only — reset cached OTel handle. */
export function __resetHandoffOtelCacheForTests(): void {
  resetTracerCacheForTests();
}
