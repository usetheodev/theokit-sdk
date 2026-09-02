import { describe, expect, it } from "vitest";
import { _getAllAdapters } from "../../src/internal/telemetry/adapter-registry.js";

describe("observability adapters", () => {
  it("registry contains 7 adapters", () => {
    const adapters = _getAllAdapters();
    expect(adapters.length).toEqual(7);
  });

  it("all adapters have detect and register functions", () => {
    const adapters = _getAllAdapters();
    for (const adapter of adapters) {
      expect(typeof adapter.detect).toEqual("function");
      expect(typeof adapter.register).toEqual("function");
      expect(typeof adapter.moduleName).toEqual("string");
      expect(typeof adapter.displayName).toEqual("string");
    }
  });
});
