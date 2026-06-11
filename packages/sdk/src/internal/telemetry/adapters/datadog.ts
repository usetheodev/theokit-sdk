import { safeRequire, type TelemetryAdapter } from "../safe-require.js";

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
  register: () => {
    if (registeredHere) return;
    const dd = safeRequire<DdTraceModule>("dd-trace");
    if (dd === undefined) return;
    dd.init({ logInjection: true });
    registeredHere = true;
  },
};
