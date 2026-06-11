import { safeRequire, type TelemetryAdapter } from "../safe-require.js";

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
  register: () => {
    if (registeredHere) return;
    const ls = safeRequire<LangSmithModule>("langsmith");
    if (ls === undefined) return;
    // LangSmith auto-instruments via LANGCHAIN_TRACING_V2 env var.
    // Registration ensures the module is loaded so its auto-hooks fire.
    registeredHere = true;
  },
};
