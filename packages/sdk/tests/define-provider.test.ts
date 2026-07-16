import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.js";
import { isCodePlugin } from "../src/internal/local-agent/local-agent-plugins.js";
import type { ProviderProfile } from "../src/internal/providers/types.js";

const profile: ProviderProfile = {
  name: "groq",
  apiMode: "chat_completions",
  envVars: ["GROQ_API_KEY"],
  authType: "api_key",
  baseUrl: "https://api.groq.com/openai/v1",
  fallbackModels: ["groq/llama-3.1-8b-instant"],
  aliases: ["groq-cloud"],
};

describe("Provider", () => {
  it("returns a model-provider Plugin derived from the profile", () => {
    const plugin = Provider.create(profile);
    expect(plugin.kind).toBe("model-provider");
    expect(plugin.name).toBe("groq");
    // profile is preserved by reference (no copy/mutation)
    expect((plugin as { profile: ProviderProfile }).profile).toBe(profile);
  });

  it("defaults version to 1.0.0 and honours an override", () => {
    expect(Provider.create(profile).version).toBe("1.0.0");
    expect(Provider.create(profile, { version: "2.3.4" }).version).toBe("2.3.4");
  });

  it("produces a plugin that passes the runtime isCodePlugin type-guard", () => {
    expect(isCodePlugin(Provider.create(profile))).toBe(true);
  });
});
