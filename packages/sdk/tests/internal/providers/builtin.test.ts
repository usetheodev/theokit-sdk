/**
 * Tests for builtin provider profiles (T3.3).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../../src/internal/providers/builtin/index.js";
import {
  _resetProvidersForTests,
  getProviderProfile,
  listProviders,
} from "../../../src/internal/providers/registry.js";

beforeEach(() => {
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
  registerBuiltins();
});
afterEach(() => {
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
});

describe("builtin providers (T3.3)", () => {
  it("anthropic profile registered", () => {
    const p = getProviderProfile("anthropic");
    expect(p?.apiMode).toBe("anthropic_messages");
    expect(p?.fallbackModels).toContain("claude-opus-4-7");
  });

  it("openai profile registered", () => {
    expect(getProviderProfile("openai")?.apiMode).toBe("chat_completions");
  });

  it("openrouter alias 'or' resolves", () => {
    expect(getProviderProfile("or")?.name).toBe("openrouter");
  });

  it("gemini profile registered", () => {
    expect(getProviderProfile("gemini")?.fallbackModels).toContain("google/gemini-2.0-flash-001");
  });

  it("all builtins have valid apiMode", () => {
    const validModes = ["chat_completions", "anthropic_messages", "responses_api", "bedrock"];
    for (const p of listProviders()) {
      expect(validModes).toContain(p.apiMode);
    }
  });

  it("registerBuiltins idempotent", () => {
    registerBuiltins();
    registerBuiltins();
    expect(listProviders()).toHaveLength(4);
  });
});
