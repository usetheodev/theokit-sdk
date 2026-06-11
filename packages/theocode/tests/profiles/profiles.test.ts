import { describe, expect, it } from "vitest";
import { anthropicProfile } from "../../src/profiles/anthropic.js";
import { BASE_INSTRUCTIONS } from "../../src/profiles/base.js";
import { defaultProfile } from "../../src/profiles/default.js";
import { geminiProfile } from "../../src/profiles/gemini.js";
import { openaiProfile } from "../../src/profiles/openai.js";
import { resolveProfile } from "../../src/profiles/selector.js";

describe("Prompt Profiles", () => {
  it("default profile has a system prompt", () => {
    expect(defaultProfile.systemPrompt).toBeTruthy();
    expect(defaultProfile.name).toBe("default");
  });

  it("anthropic profile mentions XML", () => {
    expect(anthropicProfile.systemPrompt.toLowerCase()).toContain("xml");
    expect(anthropicProfile.name).toBe("anthropic");
  });

  it("openai profile mentions JSON", () => {
    expect(openaiProfile.systemPrompt.toLowerCase()).toContain("json");
    expect(openaiProfile.name).toBe("openai");
  });

  it("gemini profile exists and has system prompt", () => {
    expect(geminiProfile.systemPrompt).toBeTruthy();
    expect(geminiProfile.name).toBe("gemini");
  });

  it("all profiles extend base instructions", () => {
    const profiles = [defaultProfile, anthropicProfile, openaiProfile, geminiProfile];
    for (const profile of profiles) {
      expect(profile.systemPrompt).toContain(BASE_INSTRUCTIONS);
    }
  });
});

describe("resolveProfile", () => {
  it("resolves anthropic from prefixed model ID", () => {
    const profile = resolveProfile("anthropic/claude-sonnet-4-20250514");
    expect(profile.name).toBe("anthropic");
  });

  it("resolves openai from prefixed model ID", () => {
    const profile = resolveProfile("openai/gpt-4o");
    expect(profile.name).toBe("openai");
  });

  it("resolves gemini from prefixed model ID", () => {
    const profile = resolveProfile("google/gemini-2.5-pro");
    expect(profile.name).toBe("gemini");
  });

  it("falls back to default for unknown model", () => {
    const profile = resolveProfile("some-unknown-provider/mystery-model");
    expect(profile.name).toBe("default");
  });

  it("handles openrouter prefix", () => {
    const profile = resolveProfile("openrouter/anthropic/claude-sonnet-4");
    expect(profile.name).toBe("anthropic");
  });

  it("EC-2: resolves bare model ID without prefix", () => {
    expect(resolveProfile("claude-sonnet-4").name).toBe("anthropic");
    expect(resolveProfile("gpt-4o").name).toBe("openai");
    expect(resolveProfile("gemini-2.5-pro").name).toBe("gemini");
  });
});
