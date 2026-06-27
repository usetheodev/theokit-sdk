/**
 * T3.10c — Model capabilities introspection (DR3 #17).
 *
 * Pre-T3.10c the SDK had no way to query a model's capability flags
 * before sending a request. Consumers who sent vision content to a
 * text-only model, or structured-output requests to a model without
 * json_schema support, got an opaque 400 from the provider — not an
 * actionable SDK-level error at the boundary.
 *
 * T3.10c adds a typed capability registry:
 *
 *   `resolveModelCapabilities(modelId: string): ModelCapabilities`
 *
 * Returns per-model flags: `supportsVision`, `supportsStructuredOutput`,
 * `supportsToolUse`, `supportsCacheControl`, `maxContextTokens`,
 * `maxOutputTokens`. Unknown models get conservative defaults (all
 * false / minimum token counts) rather than optimistic assumptions.
 *
 * Step 2 (future): `Theokit.models.capabilities(modelId)` public API.
 * Step 3 (future): Agent.create gates features via capability check.
 */

import { describe, expect, it } from "vitest";
import { resolveModelCapabilities } from "../../../src/internal/llm/model-capabilities.js";

describe("T3.10c — resolveModelCapabilities", () => {
  it("gpt-4o supports vision + structured output + tool use", () => {
    const caps = resolveModelCapabilities("openai/gpt-4o");
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsStructuredOutput).toBe(true);
    expect(caps.supportsToolUse).toBe(true);
  });

  it("gpt-4o-mini supports vision + structured output + tool use", () => {
    const caps = resolveModelCapabilities("openai/gpt-4o-mini");
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsStructuredOutput).toBe(true);
    expect(caps.supportsToolUse).toBe(true);
  });

  it("claude-3-5-sonnet supports vision + cache control + tool use, no structured output", () => {
    const caps = resolveModelCapabilities("anthropic/claude-3-5-sonnet");
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsCacheControl).toBe(true);
    expect(caps.supportsToolUse).toBe(true);
    expect(caps.supportsStructuredOutput).toBe(false);
  });

  it("claude-3-haiku supports vision + cache control + tool use", () => {
    const caps = resolveModelCapabilities("anthropic/claude-3-haiku");
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsCacheControl).toBe(true);
    expect(caps.supportsToolUse).toBe(true);
  });

  it("ollama model returns conservative defaults (all false)", () => {
    const caps = resolveModelCapabilities("ollama/qwen2.5:0.5b");
    // Ollama models have no guaranteed capability surface — conservative
    expect(caps.supportsVision).toBe(false);
    expect(caps.supportsStructuredOutput).toBe(false);
    expect(caps.supportsCacheControl).toBe(false);
    // Tool use depends on the model but conservative default is false
    expect(caps.supportsToolUse).toBe(false);
  });

  it("unknown model returns conservative defaults", () => {
    const caps = resolveModelCapabilities("some-vendor/unknown-model-2030");
    expect(caps.supportsVision).toBe(false);
    expect(caps.supportsStructuredOutput).toBe(false);
    expect(caps.supportsToolUse).toBe(false);
    expect(caps.supportsCacheControl).toBe(false);
  });

  it("returns maxContextTokens and maxOutputTokens as numbers", () => {
    const caps = resolveModelCapabilities("openai/gpt-4o");
    expect(typeof caps.maxContextTokens).toBe("number");
    expect(typeof caps.maxOutputTokens).toBe("number");
    expect(caps.maxContextTokens).toBeGreaterThan(0);
    expect(caps.maxOutputTokens).toBeGreaterThan(0);
  });

  it("openrouter-prefixed models resolve to the underlying vendor capabilities", () => {
    const caps = resolveModelCapabilities("openrouter/openai/gpt-4o");
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsStructuredOutput).toBe(true);
  });

  it("vertex-prefixed claude models get anthropic capabilities", () => {
    const caps = resolveModelCapabilities("vertex/claude-3-5-sonnet");
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsCacheControl).toBe(true);
  });
});

describe("OpenRouter variant-suffix resolution (M2-4)", () => {
  it("test_openrouter_free_suffix_resolves_real_model", () => {
    expect(resolveModelCapabilities("openrouter/openai/gpt-4o:free").maxContextTokens).toBe(
      128_000,
    );
  });

  it("test_variant_suffix_on_anthropic", () => {
    expect(
      resolveModelCapabilities("openrouter/anthropic/claude-3-5-sonnet:beta").maxContextTokens,
    ).toBeGreaterThan(4096);
  });

  it("test_bare_suffix_without_routing_prefix", () => {
    expect(resolveModelCapabilities("openai/gpt-4o:nitro").maxContextTokens).toBe(128_000);
  });

  it("test_suffix_strip_combines_with_vendor_inference", () => {
    // vertex/ strips routing; :nitro strips suffix; then vendor inference adds anthropic/
    expect(
      resolveModelCapabilities("vertex/claude-3-5-sonnet:nitro").maxContextTokens,
    ).toBeGreaterThan(4096);
  });

  it("test_no_suffix_unchanged", () => {
    expect(resolveModelCapabilities("openrouter/openai/gpt-4o").maxContextTokens).toBe(128_000);
  });

  it("test_unknown_still_conservative", () => {
    expect(resolveModelCapabilities("totally/unknown:free").maxContextTokens).toBe(4096);
  });
});

describe("RADAR #92.a — cheap OpenRouter slugs resolve real context windows", () => {
  it("qwen3-coder-30b resolves 160000 + tool use (text-only)", () => {
    const caps = resolveModelCapabilities("qwen/qwen3-coder-30b-a3b-instruct");
    expect(caps.maxContextTokens).toBe(160_000);
    expect(caps.supportsToolUse).toBe(true);
    expect(caps.supportsVision).toBe(false);
    expect(caps.supportsStructuredOutput).toBe(false);
    expect(caps.supportsCacheControl).toBe(false);
  });

  it("deepseek-v4-flash resolves 1048576", () => {
    expect(resolveModelCapabilities("deepseek/deepseek-v4-flash").maxContextTokens).toBe(1_048_576);
  });

  it("deepseek-v3.2 resolves 131072", () => {
    expect(resolveModelCapabilities("deepseek/deepseek-v3.2").maxContextTokens).toBe(131_072);
  });

  it("glm-4.7-flash resolves 202752", () => {
    expect(resolveModelCapabilities("z-ai/glm-4.7-flash").maxContextTokens).toBe(202_752);
  });

  it("gemini-2.5-flash-lite resolves 1048576 + vision + structured", () => {
    const caps = resolveModelCapabilities("google/gemini-2.5-flash-lite");
    expect(caps.maxContextTokens).toBe(1_048_576);
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsStructuredOutput).toBe(true);
    expect(caps.supportsToolUse).toBe(true);
  });

  it("gemini-2.5-pro resolves 1048576 + vision + structured", () => {
    const caps = resolveModelCapabilities("google/gemini-2.5-pro");
    expect(caps.maxContextTokens).toBe(1_048_576);
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsStructuredOutput).toBe(true);
  });

  it("gpt-4.1 resolves 1047576 (not the 4096 default)", () => {
    expect(resolveModelCapabilities("openai/gpt-4.1").maxContextTokens).toBe(1_047_576);
  });

  it("dot-form anthropic slugs theocode uses resolve real windows (not 4096)", () => {
    // theocode uses dotted OpenRouter slugs; the catalog historically had only dash forms.
    expect(resolveModelCapabilities("anthropic/claude-sonnet-4.5").maxContextTokens).toBe(200_000);
    expect(resolveModelCapabilities("anthropic/claude-opus-4.1").maxContextTokens).toBe(200_000);
    expect(resolveModelCapabilities("anthropic/claude-3.5-sonnet").maxContextTokens).toBe(200_000);
    // capability parity with their dash-form siblings (cache control on, no structured output)
    expect(resolveModelCapabilities("anthropic/claude-3.5-sonnet").supportsCacheControl).toBe(true);
    expect(resolveModelCapabilities("anthropic/claude-3.5-sonnet").supportsStructuredOutput).toBe(
      false,
    );
  });
});
