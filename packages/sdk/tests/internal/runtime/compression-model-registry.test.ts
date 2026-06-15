/**
 * T2.2 step 1/N — `resolveCompressionModel` registry algorithm
 * (ADR D440 — provider-agnostic same-family-cheaper-tier).
 *
 * The SDK is provider-agnostic; hardcoding a vendor-specific default
 * for the compression aux-LLM would force a consumer running on
 * Anthropic / Ollama / Bedrock to provision a second vendor's key
 * just to use compression. This module deterministically resolves
 * a cheaper-tier model within the SAME vendor family as the agent's
 * main model:
 *
 *   - Exact registry match → cheaper-tier id.
 *   - Wildcard match (`*` suffix in registry key) → swap matched
 *     suffix (used for region-prefixed Bedrock / openrouter ids).
 *   - `authType: "none"` providers (Ollama / LM Studio / llama.cpp)
 *     → return SAME model id (local — cost N/A; latency penalty
 *     of summarizing twice is acceptable in dev/local mode).
 *   - No match → throw `CompressionModelUnresolvedError` at
 *     `Agent.create` TIME (NOT runtime) with the actionable message
 *     naming the model and the override path.
 *
 * This is step 1 of T2.2 — pure-function registry. Step 2 wires it
 * into `compression-config.ts` which the agent-loop will consult on
 * `ContextWindowExceededError`. Step 3 builds the `aux-llm-client`
 * with OTel span + cost bucket. Step 4 wires into `loop.ts` catch.
 */

import { describe, expect, it } from "vitest";
import {
  CompressionModelUnresolvedError,
  resolveCompressionModel,
} from "../../../src/internal/runtime/compression/compression-model-registry.js";

describe("T2.2 — resolveCompressionModel: same-vendor cheaper-tier registry", () => {
  it("OpenAI gpt-4o → gpt-4o-mini (exact match)", () => {
    expect(resolveCompressionModel("openai/gpt-4o")).toBe("openai/gpt-4o-mini");
  });

  it("OpenAI gpt-4-turbo → gpt-4o-mini (exact match)", () => {
    expect(resolveCompressionModel("openai/gpt-4-turbo")).toBe("openai/gpt-4o-mini");
  });

  it("Anthropic claude-sonnet-4 → claude-3-5-haiku-latest (same family, cheaper tier)", () => {
    expect(resolveCompressionModel("anthropic/claude-sonnet-4")).toBe(
      "anthropic/claude-3-5-haiku-latest",
    );
  });

  it("Anthropic claude-opus-4 → claude-3-5-haiku-latest", () => {
    expect(resolveCompressionModel("anthropic/claude-opus-4")).toBe(
      "anthropic/claude-3-5-haiku-latest",
    );
  });

  it("Anthropic claude-3-opus → claude-3-haiku", () => {
    expect(resolveCompressionModel("anthropic/claude-3-opus")).toBe("anthropic/claude-3-haiku");
  });

  it("Vertex gemini-1.5-pro → gemini-1.5-flash (same family)", () => {
    expect(resolveCompressionModel("vertex/gemini-1.5-pro")).toBe("vertex/gemini-1.5-flash");
  });

  it("Vertex claude-3-5-sonnet → claude-3-5-haiku", () => {
    expect(resolveCompressionModel("vertex/claude-3-5-sonnet")).toBe("vertex/claude-3-5-haiku");
  });

  it("OpenRouter openai/gpt-4o → openrouter/openai/gpt-4o-mini", () => {
    expect(resolveCompressionModel("openrouter/openai/gpt-4o")).toBe(
      "openrouter/openai/gpt-4o-mini",
    );
  });

  it("OpenRouter anthropic/claude-3-5-sonnet → openrouter/anthropic/claude-3-5-haiku", () => {
    expect(resolveCompressionModel("openrouter/anthropic/claude-3-5-sonnet")).toBe(
      "openrouter/anthropic/claude-3-5-haiku",
    );
  });
});

describe("T2.2 — resolveCompressionModel: authType:'none' returns same model", () => {
  it("Ollama qwen2.5:7b → qwen2.5:7b (local — same model)", () => {
    expect(resolveCompressionModel("ollama/qwen2.5:7b")).toBe("ollama/qwen2.5:7b");
  });

  it("Ollama llama3.2:3b → llama3.2:3b", () => {
    expect(resolveCompressionModel("ollama/llama3.2:3b")).toBe("ollama/llama3.2:3b");
  });

  it("LM Studio any-model → any-model (local — same model)", () => {
    expect(resolveCompressionModel("lmstudio/my-custom-model")).toBe("lmstudio/my-custom-model");
  });

  it("llama.cpp any-model → any-model", () => {
    expect(resolveCompressionModel("llamacpp/some-gguf")).toBe("llamacpp/some-gguf");
  });
});

describe("T2.2 — resolveCompressionModel: unresolved model throws typed error", () => {
  it("throws CompressionModelUnresolvedError for unknown vendor", () => {
    expect(() => resolveCompressionModel("some-vendor/unknown-model")).toThrow(
      CompressionModelUnresolvedError,
    );
  });

  it("throws CompressionModelUnresolvedError for unknown model within known vendor", () => {
    expect(() => resolveCompressionModel("openai/gpt-99-future-2030")).toThrow(
      CompressionModelUnresolvedError,
    );
  });

  it("error message names the model and points to the override surface", () => {
    expect(() => resolveCompressionModel("foo/bar")).toThrow(
      /foo\/bar.*Agent\.create.*compression.*model/,
    );
  });

  it("error message points to registry-PR remediation", () => {
    expect(() => resolveCompressionModel("foo/bar")).toThrow(/registry|add.*model/i);
  });

  it("error provider field surfaces the unresolved input", () => {
    try {
      resolveCompressionModel("foo/bar");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompressionModelUnresolvedError);
      expect((err as CompressionModelUnresolvedError).agentModel).toBe("foo/bar");
    }
  });
});
