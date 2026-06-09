import { describe, expect, it } from "vitest";
import { datadogAdapter } from "../../src/internal/telemetry/adapters/datadog.js";

describe("datadog adapter", () => {
  it("has correct moduleName and displayName", () => {
    expect(datadogAdapter.moduleName).toEqual("dd-trace");
    expect(datadogAdapter.displayName).toEqual("Datadog");
  });

  it("detect returns false when dd-trace is not installed", () => {
    expect(datadogAdapter.detect()).toBe(false);
  });

  it("register does not throw when dd-trace is absent", () => {
    expect(() => datadogAdapter.register()).not.toThrow();
  });

  it("implements TelemetryAdapter interface", () => {
    expect(typeof datadogAdapter.detect).toEqual("function");
    expect(typeof datadogAdapter.register).toEqual("function");
  });
});
