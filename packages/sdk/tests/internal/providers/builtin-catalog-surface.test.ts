import { describe, expect, it } from "vitest";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../../src/internal/providers/builtin/index.js";
import {
  _resetProvidersForTests,
  getProviderProfile,
  listProviders,
} from "../../../src/internal/providers/registry.js";

describe("provider catalog", () => {
  it("builtins + catalog = 40+ providers available", () => {
    _resetProvidersForTests();
    _resetBuiltinsRegistered();
    registerBuiltins(); // registers 9 builtins + catalog
    const all = listProviders();
    expect(all.length).toBeGreaterThanOrEqual(40);
  });

  it("groq from catalog resolves after registerBuiltins", () => {
    _resetProvidersForTests();
    _resetBuiltinsRegistered();
    registerBuiltins();
    const groq = getProviderProfile("groq");
    expect(groq).toBeDefined();
    expect(groq!.name).toEqual("groq");
  });
});
