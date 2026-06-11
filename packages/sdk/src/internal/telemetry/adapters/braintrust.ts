import { safeRequire, type TelemetryAdapter } from "../safe-require.js";

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
  register: () => {
    if (registeredHere) return;
    const bt = safeRequire<BraintrustModule>("braintrust");
    if (bt === undefined) return;
    // Braintrust auto-instruments via BRAINTRUST_API_KEY env var.
    // Registration ensures the module is loaded.
    registeredHere = true;
  },
};
