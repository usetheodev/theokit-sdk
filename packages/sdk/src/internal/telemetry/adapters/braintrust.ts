import { safeRequire, type TelemetryAdapter, type TelemetryWiring } from "../safe-require.js";

/**
 * Braintrust adapter (T10.2, ADR D449). Detects `braintrust` and
 * configures its eval tracing.
 *
 * @internal
 */

interface BraintrustModule {
  init: (opts?: Record<string, unknown>) => void;
  wrapTraced: <T>(fn: () => T) => T;
}

let registeredHere = false;

export const braintrustAdapter: TelemetryAdapter = {
  moduleName: "braintrust",
  displayName: "Braintrust",
  detect: () => safeRequire<BraintrustModule>("braintrust") !== undefined,
  register: (): TelemetryWiring => {
    if (registeredHere) return "vendor-auto-instruments";
    const mod = safeRequire<BraintrustModule>("braintrust");
    if (mod === undefined) return "not-wired";
    // Braintrust auto-instruments from BRAINTRUST_API_KEY; there is no processor for us
    // to install. Loading the module is the whole contribution, and the return
    // value says so rather than letting the registry call it instrumentation.
    registeredHere = true;
    return "vendor-auto-instruments";
  },
};
