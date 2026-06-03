/**
 * Tests for `Theokit.inspect.*` public API (ADR D201).
 *
 * Critical: this API exists BECAUSE `@theokit/cli`'s `inspect` command
 * needs to enumerate builtin providers + embedding adapters from a
 * PUBLISHED install — internal/* paths are not in `package.json#exports`
 * (EC-E from cli-theokit edge-case review 2026-05-22).
 */

import { describe, expect, it } from "vitest";

import { Theokit } from "../src/index.js";

describe("Theokit.inspect (D201)", () => {
  it("builtinProviders returns the 7 known providers", () => {
    const providers = Theokit.inspect.builtinProviders();
    const names = providers.map((p) => p.name).sort();
    // Anthropic, OpenAI, OpenRouter, Gemini, Ollama, LM Studio, llama.cpp.
    expect(names).toEqual(
      expect.arrayContaining([
        "anthropic",
        "openai",
        "openrouter",
        "gemini",
        "ollama",
        "lmstudio",
        "llamacpp",
      ]),
    );
  });

  it("builtinProviders entries have the documented shape", () => {
    const providers = Theokit.inspect.builtinProviders();
    expect(providers.length).toBeGreaterThan(0);
    const sample = providers[0];
    expect(sample).toMatchObject({
      name: expect.any(String),
      apiMode: expect.any(String),
      authType: expect.any(String),
      baseUrl: expect.any(String),
      envVars: expect.any(Array),
    });
  });

  it("embeddingAdapters returns the catalog entries", () => {
    const adapters = Theokit.inspect.embeddingAdapters();
    const ids = adapters.map((a) => a.id).sort();
    expect(ids).toEqual(
      expect.arrayContaining(["openai", "mistral", "openrouter", "voyage", "deepinfra", "ollama"]),
    );
  });

  it("embeddingAdapters entries declare transport (local|remote)", () => {
    const adapters = Theokit.inspect.embeddingAdapters();
    for (const a of adapters) {
      expect(["local", "remote"]).toContain(a.transport);
    }
  });

  it("ollama provider has authType: none (D182)", () => {
    const providers = Theokit.inspect.builtinProviders();
    const ollama = providers.find((p) => p.name === "ollama");
    expect(ollama).toBeDefined();
    expect(ollama?.authType).toBe("none");
  });

  it("ollama embedding adapter has transport: local (D183)", () => {
    const adapters = Theokit.inspect.embeddingAdapters();
    const ollama = adapters.find((a) => a.id === "ollama");
    expect(ollama).toBeDefined();
    expect(ollama?.transport).toBe("local");
  });
});
