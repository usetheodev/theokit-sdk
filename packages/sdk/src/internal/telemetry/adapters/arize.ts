import { safeRequire, type TelemetryAdapter, type TelemetryWiring } from "../safe-require.js";

/**
 * Arize Phoenix OTel adapter (T10.2, ADR D449). Detects `arize-phoenix-otel`
 * and registers its span processor on the active OTel provider.
 *
 * @internal
 */

interface ArizeModule {
  PhoenixSpanProcessor: new (opts?: Record<string, unknown>) => unknown;
}

interface OTelTraceApi {
  getTracerProvider(): {
    addSpanProcessor?: (processor: unknown) => void;
  };
}

let registeredHere = false;

export const arizeAdapter: TelemetryAdapter = {
  moduleName: "arize-phoenix-otel",
  displayName: "Arize Phoenix",
  detect: () => safeRequire<ArizeModule>("arize-phoenix-otel") !== undefined,
  register: (): TelemetryWiring => {
    if (registeredHere) return "instrumented";
    const arize = safeRequire<ArizeModule>("arize-phoenix-otel");
    const otel = safeRequire<{ trace: OTelTraceApi }>("@opentelemetry/api");
    if (arize === undefined || otel === undefined) return "not-wired";
    const provider = otel.trace.getTracerProvider();
    if (provider.addSpanProcessor === undefined) return "not-wired";
    const processor = new arize.PhoenixSpanProcessor();
    provider.addSpanProcessor(processor);
    registeredHere = true;
    return "instrumented";
  },
};
