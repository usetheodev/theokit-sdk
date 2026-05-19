/**
 * Tests for provider registry (T3.2, ADR D107).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetProvidersForTests,
  getProviderProfile,
  listProviders,
  registerProvider,
} from "../../../src/internal/providers/registry.js";
import type { ProviderProfile } from "../../../src/internal/providers/types.js";

function profile(name: string, aliases: string[] = []): ProviderProfile {
  return {
    name,
    apiMode: "chat_completions",
    aliases,
    envVars: [`${name.toUpperCase()}_API_KEY`],
    authType: "api_key",
    baseUrl: `https://api.${name}.com`,
    fallbackModels: [`${name}-model`],
  };
}

const stderrSpy = vi.spyOn(process.stderr, "write");

beforeEach(() => {
  _resetProvidersForTests();
  stderrSpy.mockClear();
});
afterEach(() => {
  _resetProvidersForTests();
});

describe("provider registry (T3.2)", () => {
  it("register then get", () => {
    registerProvider(profile("foo"));
    expect(getProviderProfile("foo")?.name).toBe("foo");
  });

  it("alias resolves to canonical", () => {
    registerProvider(profile("openrouter", ["or"]));
    expect(getProviderProfile("or")?.name).toBe("openrouter");
  });

  it("override logs warn", () => {
    registerProvider(profile("dup"));
    registerProvider(profile("dup"));
    const calls = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(calls).toContain("overridden by user plugin");
  });

  it("list includes all registered", () => {
    registerProvider(profile("a"));
    registerProvider(profile("b"));
    expect(
      listProviders()
        .map((p) => p.name)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("unknown name returns undefined", () => {
    expect(getProviderProfile("missing")).toBeUndefined();
  });

  it("reset clears all", () => {
    registerProvider(profile("foo"));
    _resetProvidersForTests();
    expect(listProviders()).toHaveLength(0);
  });

  it("EC-5: alias collision logs warn", () => {
    registerProvider(profile("first", ["x"]));
    registerProvider(profile("second", ["x"]));
    const calls = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(calls).toContain('Alias "x" collision');
    expect(calls).toContain("first");
    expect(calls).toContain("second");
  });
});
