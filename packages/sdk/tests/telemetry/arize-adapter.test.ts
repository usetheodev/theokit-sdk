import { describe, expect, it } from "vitest";
import { arizeAdapter } from "../../src/internal/telemetry/adapters/arize.js";

describe("arize adapter", () => {
  it("has correct moduleName and displayName", () => {
    expect(arizeAdapter.moduleName).toEqual("arize-phoenix-otel");
    expect(arizeAdapter.displayName).toEqual("Arize Phoenix");
  });

  it("detect returns false when arize-phoenix-otel is not installed", () => {
    expect(arizeAdapter.detect()).toBe(false);
  });

  it("register does not throw when arize is absent", () => {
    expect(() => arizeAdapter.register()).not.toThrow();
  });
});
