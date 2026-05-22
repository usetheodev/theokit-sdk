/**
 * D206 — minimal OTel piggyback for `Eval.run`. Lazy-loads `@opentelemetry/api`
 * and emits a parent `eval.run` span when available. Child `agent.send`
 * spans (existing per D34) nest correctly when OTel context is active.
 *
 * No-op when OTel is not installed OR consumer didn't enable telemetry —
 * Eval continues to return a full result regardless.
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
    getTracer(
      name: string,
      version?: string,
    ): {
      startSpan(
        name: string,
        opts?: { attributes?: Record<string, string | number | boolean> },
      ): OTelSpan;
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

export interface EvalTelemetryHandle {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

const NOOP_HANDLE: EvalTelemetryHandle = {
  setAttribute: () => undefined,
  end: () => undefined,
};

/**
 * Start an `eval.run` span. Returns a handle whose `end()` MUST be called
 * in `finally`. When OTel is unavailable, returns a no-op — Eval result
 * is unaffected.
 */
export function startEvalRunSpan(attrs: {
  name: string;
  id: string;
  rows: number;
  concurrency: number;
}): EvalTelemetryHandle {
  const otel = loadOtel();
  if (otel === null) return NOOP_HANDLE;
  const tracer = safe(() => otel.trace.getTracer("theokit-sdk-eval", "1.0.0"), undefined);
  if (tracer === undefined) return NOOP_HANDLE;
  const span = safe(
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

/** Test-only — clears the OTel cache so a re-load happens. */
export function __resetEvalOtelCacheForTests(): void {
  cachedOtel = undefined;
}
