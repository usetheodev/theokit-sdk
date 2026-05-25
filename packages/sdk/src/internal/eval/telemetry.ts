/**
 * D206 — minimal OTel piggyback for `Eval.run`. Emits a parent `eval.run`
 * span when available; child `agent.send` spans (existing per D34) nest
 * correctly when OTel context is active.
 *
 * @internal
 */

import {
  getTracer,
  resetTracerCacheForTests,
  type SpanLike,
} from "../observability/tracer-loader.js";

const TRACER_NAME = "theokit-sdk-eval";

export interface EvalTelemetryHandle {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

const NOOP_HANDLE: EvalTelemetryHandle = {
  setAttribute: () => undefined,
  end: () => undefined,
};

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Start an `eval.run` span. Returns a handle whose `end()` MUST be called
 * in `finally`. When OTel is unavailable, returns a no-op.
 */
export function startEvalRunSpan(attrs: {
  name: string;
  id: string;
  rows: number;
  concurrency: number;
}): EvalTelemetryHandle {
  const tracer = getTracer(TRACER_NAME);
  if (tracer === undefined) return NOOP_HANDLE;
  const span: SpanLike | undefined = safe(
    () =>
      tracer.startSpan("eval.run", {
        attributes: {
          "eval.name": attrs.name,
          "eval.id": attrs.id,
          "eval.rows.total": attrs.rows,
          "eval.concurrency": attrs.concurrency,
        },
      }),
    undefined,
  );
  if (span === undefined) return NOOP_HANDLE;
  return {
    setAttribute: (key, value) => safe(() => span.setAttribute(key, value), undefined),
    end: () => safe(() => span.end(), undefined),
  };
}

/** Test-only — clears the tracer cache so a re-load happens. */
export function __resetEvalOtelCacheForTests(): void {
  resetTracerCacheForTests();
}
