import { safeRequire, type TelemetryAdapter, type TelemetryWiring } from "../safe-require.js";

/**
 * LangSmith adapter (T10.2, ADR D449). Detects `langsmith` and
 * configures its tracing client for span export.
 *
 * @internal
 */

interface LangSmithModule {
  Client: new (
    opts?: Record<string, unknown>,
  ) => {
    createRun: (params: Record<string, unknown>) => Promise<void>;
  };
}

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
