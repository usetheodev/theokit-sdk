/**
 * Tests for parseModelId — provider/name split (T1.2 follow-up, ADR D182).
 *
 * Aligned with peer-project `OLLAMA_PROVIDER_ID = "ollama"` and Hermes
 * `normalize_provider` + ALIASES table behavior.
 */

import { describe, expect, it } from "vitest";

import { parseModelId } from "../../../src/internal/llm/model-identifier.js";

describe("parseModelId (D182 follow-up)", () => {
  it("ollama prefix → provider + stripped tag-preserving name", () => {
    expect(parseModelId("ollama/llama3.2:3b")).toEqual({
      provider: "ollama",
      name: "llama3.2:3b",
    });
  });

  it("anthropic prefix → provider + name", () => {
    expect(parseModelId("anthropic/claude-3-5-sonnet")).toEqual({
      provider: "anthropic",
      name: "claude-3-5-sonnet",
    });
  });

  it("openrouter with embedded slash → keeps remainder intact", () => {
    expect(parseModelId("openrouter/meta-llama/llama-3.2")).toEqual({
      provider: "openrouter",
      name: "meta-llama/llama-3.2",
    });
  });

  it("no slash → provider undefined, name = raw id", () => {
    expect(parseModelId("claude-sonnet-4-6")).toEqual({
      provider: undefined,
      name: "claude-sonnet-4-6",
    });
  });

  it("empty string → empty result", () => {
    expect(parseModelId("")).toEqual({ provider: undefined, name: "" });
  });

  it("undefined → empty result", () => {
    expect(parseModelId(undefined)).toEqual({ provider: undefined, name: "" });
  });

  it("trailing slash → no prefix detected", () => {
    expect(parseModelId("ollama/")).toEqual({ provider: undefined, name: "ollama/" });
  });

  it("leading slash → no prefix detected", () => {
    expect(parseModelId("/llama3.2")).toEqual({ provider: undefined, name: "/llama3.2" });
  });

  it("uppercase provider is canonicalized to lowercase", () => {
    expect(parseModelId("Ollama/llama3.2")).toEqual({
      provider: "ollama",
      name: "llama3.2",
    });
  });

  it("alias 'llama-cpp' canonicalizes to 'llamacpp'", () => {
    expect(parseModelId("llama-cpp/qwen2.5")).toEqual({
      provider: "llamacpp",
      name: "qwen2.5",
    });
  });

  it("alias 'lm-studio' canonicalizes to 'lmstudio'", () => {
    expect(parseModelId("lm-studio/qwen2.5")).toEqual({
      provider: "lmstudio",
      name: "qwen2.5",
    });
  });
});
