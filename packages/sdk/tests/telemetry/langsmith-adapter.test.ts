import { describe, expect, it } from "vitest";
import { langsmithAdapter } from "../../src/internal/telemetry/adapters/langsmith.js";

describe("langsmith adapter", () => {
  it("has correct moduleName and displayName", () => {
    expect(langsmithAdapter.moduleName).toEqual("langsmith");
    expect(langsmithAdapter.displayName).toEqual("LangSmith");
  });

  it("detect returns boolean (true if langsmith resolvable, false otherwise)", () => {
    const result = langsmithAdapter.detect();
    expect(typeof result).toEqual("boolean");
  });

  it("register does not throw regardless of langsmith presence", () => {
    expect(() => langsmithAdapter.register()).not.toThrow();
  });
});
