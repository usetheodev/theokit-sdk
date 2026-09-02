import { safeRequire, type TelemetryAdapter, type TelemetryWiring } from "../safe-require.js";

/**
 * Datadog dd-trace adapter (T10.2, ADR D449). Detects `dd-trace` and
 * registers its OTel-compatible tracer on the active provider.
 *
 * @internal
 */

interface DdTraceModule {
  init: (opts?: Record<string, unknown>) => unknown;
  tracer: { use: (name: string, opts?: Record<string, unknown>) => void };
}

let registeredHere = false;

export const datadogAdapter: TelemetryAdapter = {
  moduleName: "dd-trace",
  displayName: "Datadog",
  detect: () => safeRequire<DdTraceModule>("dd-trace") !== undefined,
  register: (): TelemetryWiring => {
    if (registeredHere) return "instrumented";
    const dd = safeRequire<DdTraceModule>("dd-trace");
    if (dd === undefined) return "not-wired";
    dd.init({ logInjection: true });
    registeredHere = true;
    return "instrumented";
  },
};
