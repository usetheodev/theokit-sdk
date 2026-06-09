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
