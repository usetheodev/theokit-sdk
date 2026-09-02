/**
 * LangSmith adapter (T10.2, ADR D449). Detects `langsmith` and
 * configures its tracing client for span export.
 *
 * @internal
 */

import { safeRequire, type TelemetryAdapter, type TelemetryWiring } from "../safe-require.js";

/**
 * What this adapter needs from the vendor module: nothing at all.
 *
 * It used to declare a `Client` with `createRun`, neither of which was ever
 * constructed or called — a type describing an integration that does not exist.
 * LangSmith instruments itself from `LANGCHAIN_TRACING_V2`; loading the module
 * so its auto-hooks fire is the whole job, and `safeRequire` answers the only
 * question asked here — is the package present.
 */
type LangSmithModule = Record<string, never>;

let registeredHere = false;

export const langsmithAdapter: TelemetryAdapter = {
  moduleName: "langsmith",
  displayName: "LangSmith",
  detect: () => safeRequire<LangSmithModule>("langsmith") !== undefined,
  register: (): TelemetryWiring => {
    if (registeredHere) return "vendor-auto-instruments";
    const mod = safeRequire<LangSmithModule>("langsmith");
    if (mod === undefined) return "not-wired";
    // LangSmith auto-instruments from LANGCHAIN_TRACING_V2; there is no processor for us
    // to install. Loading the module is the whole contribution, and the return
    // value says so rather than letting the registry call it instrumentation.
    registeredHere = true;
    return "vendor-auto-instruments";
  },
};
