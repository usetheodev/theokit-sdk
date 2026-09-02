import { describe, expect, it } from "vitest";

import { arizeAdapter } from "../../src/internal/telemetry/adapters/arize.js";
import { braintrustAdapter } from "../../src/internal/telemetry/adapters/braintrust.js";
import { datadogAdapter } from "../../src/internal/telemetry/adapters/datadog.js";
import { langsmithAdapter } from "../../src/internal/telemetry/adapters/langsmith.js";
import { safeRequire, type TelemetryAdapter } from "../../src/internal/telemetry/safe-require.js";

/**
 * One table for the four adapter files that were structurally identical and had drifted anyway:
 * langsmith asserted `typeof detect() === "boolean"` where the other three asserted `=== false`, and
 * datadog alone carried an "implements TelemetryAdapter interface" case. Four copies of three
 * assertions is how that happens.
 *
 * The finding asks to "decide once whether detect() must be false or merely boolean". Neither: both
 * are wrong. `typeof x === "boolean"` cannot fail for a function typed `() => boolean`, and
 * `=== false` asserts the DEPENDENCY GRAPH, not the adapter — measured 2026-09-02, `langsmith` is
 * present in this workspace as a transitive dependency, so its detect() is true while the other
 * three are false. A table asserting `false` for all four would have been red on arrival.
 *
 * So the table asserts the relationship, which holds for any installation state: detect answers
 * whether the module resolves. `canInstrument` is the second column and is a property of the
 * ADAPTER: Braintrust and LangSmith auto-instrument from an env var, so they install nothing and may
 * never report that they did.
 */
const ADAPTERS: ReadonlyArray<
  [
    name: string,
    adapter: TelemetryAdapter,
    moduleName: string,
    displayName: string,
    canInstrument: boolean,
  ]
> = [
  ["arize", arizeAdapter, "arize-phoenix-otel", "Arize Phoenix", true],
  ["braintrust", braintrustAdapter, "braintrust", "Braintrust", false],
  ["datadog", datadogAdapter, "dd-trace", "Datadog", true],
  ["langsmith", langsmithAdapter, "langsmith", "LangSmith", false],
];

describe("telemetry adapter contract", () => {
  it("covers every adapter in the table — a shrunken table would pass every case below", () => {
    expect(ADAPTERS).toHaveLength(4);
  });

  it.each(
    ADAPTERS,
  )("%s declares its module and display name", (_n, adapter, moduleName, displayName) => {
    expect(adapter.moduleName).toEqual(moduleName);
    expect(adapter.displayName).toEqual(displayName);
  });

  it.each(
    ADAPTERS,
  )("%s detect answers whether the module resolves, and nothing else", (_n, adapter, moduleName) => {
    expect(adapter.detect()).toBe(safeRequire(moduleName) !== undefined);
  });

  it.each(
    ADAPTERS,
  )("%s register reports an outcome from the contract's vocabulary", (_n, adapter) => {
    expect(["instrumented", "vendor-auto-instruments", "not-wired"]).toContain(adapter.register());
  });

  it.each(
    ADAPTERS.filter(([, , , , can]) => !can),
  )("%s never reports that it instrumented anything, because it installs nothing", (_n, adapter) => {
    expect(adapter.register()).not.toBe("instrumented");
  });
});
