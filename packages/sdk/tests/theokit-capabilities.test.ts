import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../src/internal/providers/builtin/index.js";
import { _resetProvidersForTests } from "../src/internal/providers/registry.js";
import { Theokit } from "../src/theokit.js";

describe("Theokit.models.capabilities", () => {
  beforeEach(() => {
    _resetProvidersForTests();
    _resetBuiltinsRegistered();
    registerBuiltins();
  });

  it("returns capabilities for a known provider", () => {
    const caps = Theokit.models.capabilities("openai");
    expect(caps).toBeDefined();
    expect(caps!.supportsToolUse).toBe(true);
    expect(caps!.supportsVision).toBe(true);
    expect(caps!.supportsStreaming).toBe(true);
  });

  it("returns capabilities for anthropic", () => {
    const caps = Theokit.models.capabilities("anthropic");
    expect(caps).toBeDefined();
    expect(caps!.supportsCacheControl).toBe(true);
  });

  it("returns capabilities for groq (catalog-only provider)", () => {
    const caps = Theokit.models.capabilities("groq");
    expect(caps).toBeDefined();
    expect(caps!.supportsToolUse).toBe(true);
  });

  it("returns undefined for unknown provider", () => {
    const caps = Theokit.models.capabilities("nonexistent-provider-xyz");
    expect(caps).toBeUndefined();
  });

  it("extracts provider from model ID with slash", () => {
    const caps = Theokit.models.capabilities("openai/gpt-4o-mini");
    expect(caps).toBeDefined();
    expect(caps!.supportsStructuredOutput).toBe(true);
  });
});
