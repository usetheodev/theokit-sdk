import { diag } from "../../diagnostics.js";
import { safeRequire, type TelemetryAdapter, type TelemetryWiring } from "../safe-require.js";

/**
 * Langfuse OTel adapter (ADR D42). Detects `@langfuse/node` and registers
 * `LangfuseSpanProcessor` on the active OTel provider.
 *
 * EC-12: if a Langfuse processor is already attached, skips silently.
 *
 * @internal
 */

interface LangfuseModule {
  Langfuse: new (opts?: Record<string, unknown>) => unknown;
  LangfuseSpanProcessor?: new (opts: { langfuse: unknown }) => unknown;
}

interface OTelTraceApi {
  getTracerProvider(): {
    addSpanProcessor?: (processor: unknown) => void;
    getActiveSpanProcessor?: () => unknown;
  };
}

let registeredHere = false;

export const langfuseAdapter: TelemetryAdapter = {
  moduleName: "@langfuse/node",
  displayName: "Langfuse",
  detect: () => safeRequire<LangfuseModule>("@langfuse/node") !== undefined,
  register: (): TelemetryWiring => {
    if (registeredHere) return "instrumented";
    const lf = safeRequire<LangfuseModule>("@langfuse/node");
    const otel = safeRequire<{ trace: OTelTraceApi }>("@opentelemetry/api");
    if (lf === undefined || otel === undefined) return "not-wired";
    const provider = otel.trace.getTracerProvider();
    if (provider.addSpanProcessor === undefined) {
      // Provider is a no-op proxy — user hasn't configured a real one.
      // Skip; their app likely doesn't use OTel pipelines yet.
      return "not-wired";
    }
    // EC-12: detect existing Langfuse processor on the provider.
    const existing = provider.getActiveSpanProcessor?.();
    if (typeof existing === "object" && existing !== null) {
      const ctor = existing.constructor?.name ?? "";
      if (ctor.toLowerCase().includes("langfuse")) {
        // Already wired — skip.
        registeredHere = true;
        return "instrumented";
      }
    }
    if (lf.LangfuseSpanProcessor === undefined) {
      // Langfuse v2: no OTel span processor. Skip with a one-time hint.
      diag(
        "[theokit-sdk] @langfuse/node detected but LangfuseSpanProcessor not found (v2?). Use Langfuse v3+ for auto-instrumentation.\n",
      );
      return "not-wired";
    }
    const client = new lf.Langfuse();
    const processor = new lf.LangfuseSpanProcessor({ langfuse: client });
    provider.addSpanProcessor(processor);
    registeredHere = true;
    return "instrumented";
  },
};
