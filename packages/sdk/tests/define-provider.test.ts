import { describe, expect, it } from "vitest";
import { defineProvider } from "../src/index.js";
import type { ProviderProfile } from "../src/internal/providers/types.js";
import { isCodePlugin } from "../src/internal/runtime/local-agent/local-agent-plugins.js";

const profile: ProviderProfile = {
  name: "groq",
  apiMode: "chat_completions",
  envVars: ["GROQ_API_KEY"],
  authType: "api_key",
  baseUrl: "https://api.groq.com/openai/v1",
  fallbackModels: ["groq/llama-3.1-8b-instant"],
  aliases: ["groq-cloud"],
};

describe("defineProvider", () => {
  it("returns a model-provider Plugin derived from the profile", () => {
    const plugin = defineProvider(profile);
    expect(plugin.kind).toBe("model-provider");
    expect(plugin.name).toBe("groq");
    // profile is preserved by reference (no copy/mutation)
    expect((plugin as { profile: ProviderProfile }).profile).toBe(profile);
  });

  it("defaults version to 1.0.0 and honours an override", () => {
    expect(defineProvider(profile).version).toBe("1.0.0");
    expect(defineProvider(profile, { version: "2.3.4" }).version).toBe("2.3.4");
  });

  it("produces a plugin that passes the runtime isCodePlugin type-guard", () => {
    expect(isCodePlugin(defineProvider(profile))).toBe(true);
  });
});
