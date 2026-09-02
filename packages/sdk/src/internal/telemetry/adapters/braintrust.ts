import { safeRequire, type TelemetryAdapter, type TelemetryWiring } from "../safe-require.js";

/**
 * Braintrust adapter (T10.2, ADR D449). Detects `braintrust` and
 * configures its eval tracing.
 *
 * @internal
 */

/**
 * What this adapter needs from the vendor module: nothing at all.
 *
 * It used to declare `init` and `wrapTraced`, neither of which was ever called
 * — a type describing an integration that does not exist, which is how a reader
 * concluded the SDK drives Braintrust. It does not: Braintrust instruments
 * itself from `BRAINTRUST_API_KEY`, and loading the module is the whole job.
 * The empty shape is the honest one, and `safeRequire` still answers the only
 * question asked here — is the package present.
 */
type BraintrustModule = Record<string, never>;

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
