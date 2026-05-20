import { createRequire } from "node:module";

/**
 * Lazy-loaded OpenTelemetry tracer for the SDK. Consumers opt in via
 * `AgentOptions.telemetry`. When `enabled: false` (default) or when
 * `@opentelemetry/api` is not installed, every API on this module is a
 * no-op. See ADR D34. Auto-instrumentation of Langfuse/Sentry/PostHog is
 * wired here (ADR D42).
 *
 * @internal
 */

import type { TelemetrySettings } from "../../types/agent.js";
import { redactSecrets } from "../security/index.js";
import { tryAutoRegisterAdapters } from "./adapter-registry.js";

/** Minimal shape of `@opentelemetry/api` consumed by this wrapper. */
interface OTelApi {
  trace: {
    getTracer(name: string, version?: string): OTelTracer;
  };
  context: {
    active(): OTelContext;
    with<T>(ctx: OTelContext, fn: () => T): T;
  };
  trace_setSpan?: (ctx: OTelContext, span: OTelSpan) => OTelContext;
  SpanStatusCode: { OK: number; ERROR: number };
}

export interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attrs: Record<string, string | number | boolean | undefined>): void;
  addEvent(name: string, attrs?: Record<string, string | number | boolean>): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(err: unknown): void;
  end(endTime?: number): void;
  spanContext(): { traceId: string; spanId: string };
  isRecording(): boolean;
}

interface OTelContext {
  // opaque
  readonly [marker: symbol]: unknown;
}

interface OTelTracer {
  startSpan(name: string, options?: { attributes?: Record<string, unknown> }): OTelSpan;
  startActiveSpan<T>(
    name: string,
    options: { attributes?: Record<string, unknown> } | undefined,
    fn: (span: OTelSpan) => T,
  ): T;
}

/**
 * Telemetry handle returned by {@link createTelemetry}. Callers use this to
 * start spans, add events, etc. When telemetry is disabled OR OTel is not
 * installed, every method is a safe no-op.
 *
 * @internal
 */
export interface TelemetryHandle {
  readonly enabled: boolean;
  readonly includeContent: boolean;
  /** Start a span. Returns a no-op span if telemetry is disabled. */
  startSpan(name: string, attrs?: Record<string, string | number | boolean>): OTelSpan;
  /** Start a child span inheriting the current active context. */
  startChildSpan(
    parent: OTelSpan,
    name: string,
    attrs?: Record<string, string | number | boolean>,
  ): OTelSpan;
  /** End all open spans on this handle (best-effort, used by Agent.dispose). */
  endAll(): void;
}

let cachedOtel: OTelApi | undefined | null;

/** Lazy-load `@opentelemetry/api` via createRequire. Caches null on failure. */
function loadOtel(): OTelApi | null {
  if (cachedOtel === undefined) {
    try {
      const r = createRequire(import.meta.url);
      const mod = r("@opentelemetry/api") as OTelApi;
      cachedOtel = mod;
    } catch {
      cachedOtel = null;
    }
  }
  return cachedOtel ?? null;
}

const NOOP_SPAN: OTelSpan = {
  setAttribute: () => {},
  setAttributes: () => {},
  addEvent: () => {},
  setStatus: () => {},
  recordException: () => {},
  end: () => {},
  spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16) }),
  isRecording: () => false,
};

const NOOP_HANDLE: TelemetryHandle = {
  enabled: false,
  includeContent: false,
  startSpan: () => NOOP_SPAN,
  startChildSpan: () => NOOP_SPAN,
  endAll: () => {},
};

/**
 * Wrap a callable with try/catch so OTel side-effects can never propagate
 * into the agent loop. Logs once to stderr on the first failure (EC-1).
 *
 * @internal
 */
let warnedOnce = false;
function safe<T>(op: () => T, fallback: T): T {
  try {
    return op();
  } catch (cause) {
    if (!warnedOnce) {
      warnedOnce = true;
      const message = cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(
        `[theokit-sdk] telemetry exporter error (suppressed; agent.send continues): ${message}\n`,
      );
    }
    return fallback;
  }
}

/**
 * Create a telemetry handle from the per-agent settings. Loads OTel lazily
 * and produces a no-op handle when telemetry is disabled or OTel is not
 * installed.
 *
 * @internal
 */
export function createTelemetry(settings: TelemetrySettings | undefined): TelemetryHandle {
  if (settings === undefined || settings.enabled !== true) return NOOP_HANDLE;
  const otel = loadOtel();
  if (otel === null) {
    // Telemetry enabled but OTel not installed — warn once and degrade to no-op.
    if (!warnedOnce) {
      warnedOnce = true;
      process.stderr.write(
        "[theokit-sdk] telemetry.enabled = true but `@opentelemetry/api` is not installed; telemetry is a no-op.\n",
      );
    }
    return NOOP_HANDLE;
  }
  const tracer = safe(
    () => otel.trace.getTracer(settings.serviceName ?? "theokit-sdk", "1.2.0"),
    undefined,
  );
  if (tracer === undefined) return NOOP_HANDLE;

  // ADR D42: try to auto-register Langfuse / Sentry / PostHog when present.
  // Idempotent — multiple agents share the registry; subsequent calls skip.
  safe(() => tryAutoRegisterAdapters(settings), undefined);

  const openSpans = new Set<OTelSpan>();
  // OTel context propagation is implicit when startSpan is called inside an
  // active context. For simplicity, we always startSpan; child relationship
  // is established by callers using OTel API directly when needed. The
  // wrapper records spans in `openSpans` so dispose() can endAll().
  const startNewSpan = (name: string, attrs?: Record<string, string | number | boolean>) => {
    // T1.2 (ADR D68): redact string attrs at the boundary — values go to
    // Langfuse / Sentry / PostHog via the OTel SpanProcessor.
    const redactedAttrs = attrs === undefined ? undefined : redactAttrs(attrs);
    const span = safe(
      () => tracer.startSpan(name, redactedAttrs ? { attributes: redactedAttrs } : undefined),
      NOOP_SPAN,
    );
    if (span !== NOOP_SPAN) openSpans.add(span);
    return wrapSpan(span, openSpans);
  };
  const handle: TelemetryHandle = {
    enabled: true,
    includeContent: settings.includeContent === true,
    startSpan: startNewSpan,
    startChildSpan: (_parent, name, attrs) => startNewSpan(name, attrs),
    endAll: () => {
      for (const span of openSpans) safe(() => span.end(), undefined);
      openSpans.clear();
    },
  };
  return handle;
}

/**
 * Wrap a raw OTel span so every method goes through safe(). This is the
 * EC-1 enforcement: exporter errors thrown via setAttribute/end/etc never
 * propagate to the agent loop.
 */
function wrapSpan(span: OTelSpan, openSpans: Set<OTelSpan>): OTelSpan {
  if (span === NOOP_SPAN) return span;
  return {
    setAttribute: (k, v) => safe(() => span.setAttribute(k, redactAttrValue(v)), undefined),
    setAttributes: (attrs) => safe(() => span.setAttributes(redactAttrs(attrs)), undefined),
    addEvent: (name, attrs) =>
      safe(() => span.addEvent(name, attrs ? redactAttrs(attrs) : undefined), undefined),
    setStatus: (status) => safe(() => span.setStatus(status), undefined),
    recordException: (err) => safe(() => span.recordException(err), undefined),
    end: (endTime) => {
      safe(() => span.end(endTime), undefined);
      openSpans.delete(span);
    },
    spanContext: () =>
      safe(() => span.spanContext(), { traceId: "0".repeat(32), spanId: "0".repeat(16) }),
    isRecording: () => safe(() => span.isRecording(), false),
  };
}

/**
 * Redact a single attribute value. Strings go through `redactSecrets`;
 * numbers/booleans/undefined pass through untouched. T1.2.
 *
 * @internal — exported only so unit tests can exercise the wire without
 * a real `@opentelemetry/api` install. Production callers reach it via
 * the `wrapSpan` closure.
 */
export function _redactAttrValueForTests<T extends string | number | boolean | undefined>(
  value: T,
): T {
  return redactAttrValue(value);
}

/**
 * Redact every string value in an attributes record. T1.2.
 *
 * @internal — exported only so unit tests can exercise the wire.
 */
export function _redactAttrsForTests<
  T extends Record<string, string | number | boolean | undefined>,
>(attrs: T): T {
  return redactAttrs(attrs);
}

function redactAttrValue<T extends string | number | boolean | undefined>(value: T): T {
  if (typeof value !== "string") return value;
  return redactSecrets(value) as T;
}

function redactAttrs<T extends Record<string, string | number | boolean | undefined>>(attrs: T): T {
  const out = {} as Record<string, string | number | boolean | undefined>;
  for (const [k, v] of Object.entries(attrs)) {
    out[k] = typeof v === "string" ? redactSecrets(v) : v;
  }
  return out as T;
}

/** Exported for tests — resets the OTel cache and the warning-once latch. */
export function _resetTelemetryCacheForTests(): void {
  cachedOtel = undefined;
  warnedOnce = false;
}
