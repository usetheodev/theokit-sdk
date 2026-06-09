import { describe, expect, it } from "vitest";
import { braintrustAdapter } from "../../src/internal/telemetry/adapters/braintrust.js";

describe("braintrust adapter", () => {
  it("has correct moduleName and displayName", () => {
    expect(braintrustAdapter.moduleName).toEqual("braintrust");
    expect(braintrustAdapter.displayName).toEqual("Braintrust");
  });

  it("detect returns false when braintrust is not installed", () => {
    expect(braintrustAdapter.detect()).toBe(false);
  });

  it("register does not throw when braintrust is absent", () => {
    expect(() => braintrustAdapter.register()).not.toThrow();
  });
});
