import { safeRequire, type TelemetryAdapter } from "../safe-require.js";

/**
 * Sentry OTel adapter (ADR D42). Detects `@sentry/node` and attaches an
 * event-processor that enriches captured events with OTel trace context.
 *
 * Preferred path is `@sentry/opentelemetry` but that package is volatile
 * across Sentry v8; we use `@sentry/node` directly for stability. Documented
 * as a known limitation.
 *
 * @internal
 */

interface SentryModule {
  addEventProcessor?: (fn: (event: unknown) => unknown) => void;
  getActiveSpan?: () => unknown;
  isInitialized?: () => boolean;
}

let registeredHere = false;

export const sentryAdapter: TelemetryAdapter = {
  moduleName: "@sentry/node",
  displayName: "Sentry",
  detect: () => safeRequire<SentryModule>("@sentry/node") !== undefined,
  register: () => {
    if (registeredHere) return;
    const sentry = safeRequire<SentryModule>("@sentry/node");
    if (sentry === undefined) return;
    // Some Sentry versions only expose addEventProcessor after Sentry.init().
    if (typeof sentry.addEventProcessor !== "function") {
      return;
    }
    // EC-12: only register once.
    sentry.addEventProcessor((event: unknown) => {
      // Best-effort enrichment: attach traceId/spanId from OTel active span.
      const otel = safeRequire<{
        trace: {
          getActiveSpan(): { spanContext(): { traceId: string; spanId: string } } | undefined;
        };
      }>("@opentelemetry/api");
      if (otel === undefined) return event;
      const span = otel.trace.getActiveSpan();
      if (span === undefined) return event;
      const ctx = span.spanContext();
      if (typeof event === "object" && event !== null) {
        const contexts = (event as { contexts?: Record<string, unknown> }).contexts ?? {};
        contexts.trace = { trace_id: ctx.traceId, span_id: ctx.spanId };
        (event as { contexts?: Record<string, unknown> }).contexts = contexts;
      }
      return event;
    });
    registeredHere = true;
  },
};
