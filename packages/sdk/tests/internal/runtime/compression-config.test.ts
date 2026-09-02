/**
 * T2.2 step 2/N — compression-config.ts resolution
 * (ADR D440 — provider-agnostic aux-LLM contract).
 *
 * Bridges the compression-model-registry (step 1) with the
 * Agent.create({compression}) override surface. Resolves:
 *
 *   - Compression model (registry default OR explicit override)
 *   - API key (env → explicit → main pool fallback)
 *   - Max attempts + grace (from plan: cap 3, grace 1)
 *
 * Pure config resolution — no I/O, no LLM calls.
 */

import { afterEach, describe, expect, it } from "vitest";
import { resolveCompressionConfig } from "../../../src/internal/runtime/compression/compression-config.js";
import { useTempCwd } from "../../helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

const ANTHROPIC_AGENT = "anthropic/claude-3-5-sonnet";
const OPENAI_AGENT = "openai/gpt-4o";

describe("T2.2 step 2 — resolveCompressionConfig model resolution", () => {
  it("resolves compression model from registry when no override", () => {
    const resolved = resolveCompressionConfig(ANTHROPIC_AGENT, {});
    expect(resolved.model).toBe("anthropic/claude-3-5-haiku-latest");
  });

  it("uses explicit model override when provided", () => {
    const resolved = resolveCompressionConfig(ANTHROPIC_AGENT, {
      model: "anthropic/claude-3-haiku",
    });
    expect(resolved.model).toBe("anthropic/claude-3-haiku");
  });

  it("throws CompressionModelUnresolvedError for unknown agent model with no override", () => {
    expect(() => resolveCompressionConfig("foo/bar", {})).toThrow(/foo\/bar/);
  });

  it("unknown agent model succeeds when explicit model override is provided", () => {
    const resolved = resolveCompressionConfig("foo/bar", {
      model: "openai/gpt-4o-mini",
    });
    expect(resolved.model).toBe("openai/gpt-4o-mini");
  });
});

describe("T2.2 step 2 — resolveCompressionConfig key resolution chain", () => {
  afterEach(() => {
    delete process.env.THEOKIT_COMPRESSION_API_KEY;
  });

  it("uses env var THEOKIT_COMPRESSION_API_KEY when set", () => {
    process.env.THEOKIT_COMPRESSION_API_KEY = "env-key-123";
    const resolved = resolveCompressionConfig(OPENAI_AGENT, {});
    expect(resolved.apiKey).toBe("env-key-123");
    expect(resolved.apiKeySource).toBe("env");
  });

  it("uses explicit apiKey override over env var", () => {
    process.env.THEOKIT_COMPRESSION_API_KEY = "env-key-123";
    const resolved = resolveCompressionConfig(OPENAI_AGENT, {
      apiKey: "explicit-key-456",
    });
    expect(resolved.apiKey).toBe("explicit-key-456");
    expect(resolved.apiKeySource).toBe("explicit");
  });

  it("falls back to undefined (main pool) when no env and no explicit key", () => {
    const resolved = resolveCompressionConfig(OPENAI_AGENT, {});
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.apiKeySource).toBe("main-pool-fallback");
  });
});

describe("T2.2 step 2 — resolveCompressionConfig defaults", () => {
  it("defaults maxAttempts to 3", () => {
    const resolved = resolveCompressionConfig(OPENAI_AGENT, {});
    expect(resolved.maxAttempts).toBe(3);
  });

  it("defaults grace to 1", () => {
    const resolved = resolveCompressionConfig(OPENAI_AGENT, {});
    expect(resolved.grace).toBe(1);
  });

  it("respects explicit maxAttempts override", () => {
    const resolved = resolveCompressionConfig(OPENAI_AGENT, { maxAttempts: 5 });
    expect(resolved.maxAttempts).toBe(5);
  });

  it("respects explicit grace override", () => {
    const resolved = resolveCompressionConfig(OPENAI_AGENT, { grace: 0 });
    expect(resolved.grace).toBe(0);
  });
});
