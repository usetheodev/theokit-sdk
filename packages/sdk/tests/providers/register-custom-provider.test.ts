import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../src/internal/providers/builtin/index.js";
import {
  _resetProvidersForTests,
  getProviderProfile,
  registerProvider,
} from "../../src/internal/providers/registry.js";
import type { ProviderProfile } from "../../src/internal/providers/types.js";

const customProvider: ProviderProfile = {
  name: "custom-llm",
  apiMode: "chat_completions",
  envVars: ["CUSTOM_LLM_API_KEY"],
  authType: "api_key",
  baseUrl: "https://api.custom-llm.com/v1",
  fallbackModels: ["custom-llm/default"],
};

describe("Theokit.registerProvider", () => {
  beforeEach(() => {
    _resetProvidersForTests();
    _resetBuiltinsRegistered();
    registerBuiltins();
  });

  it("adds a custom provider visible to getProviderProfile", () => {
    registerProvider(customProvider);
    const p = getProviderProfile("custom-llm");
    expect(p).toBeDefined();
    expect(p!.name).toBe("custom-llm");
    expect(p!.baseUrl).toBe("https://api.custom-llm.com/v1");
  });

  it("existing builtins still work after custom registration", () => {
    registerProvider(customProvider);
    const anthropic = getProviderProfile("anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic!.name).toBe("anthropic");
  });

  it("EC-4: duplicate registerProvider with same ID emits WARN", () => {
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk.toString());
      return true;
    }) as typeof process.stderr.write;

    try {
      registerProvider(customProvider);
      registerProvider({ ...customProvider }); // second registration
      expect(stderrChunks.some((c) => c.includes("overridden"))).toBe(true);
    } finally {
      process.stderr.write = origWrite;
    }
  });
});
