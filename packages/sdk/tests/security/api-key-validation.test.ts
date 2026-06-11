/**
 * T1.3 — API key boundary validation tests.
 *
 * The validator runs early in `Agent.create` so malformed keys (whitespace,
 * sub-16-char fragments, embedded whitespace, known-provider prefix
 * mismatches) get a precise `AuthenticationError({code:"malformed_api_key"})`
 * BEFORE the SDK attempts a provider round-trip. Live validation (actual
 * `fetch` against the provider URL) still happens later.
 */

import { describe, expect, it } from "vitest";
import { AuthenticationError } from "../../src/errors.js";
import { Agent } from "../../src/index.js";
import {
  type ApiKeyValidationResult,
  validateApiKeyShape,
} from "../../src/internal/auth/api-key-validator.js";

describe("T1.3 — validateApiKeyShape unit", () => {
  function assertMalformed(
    result: ApiKeyValidationResult,
    reason: ApiKeyValidationResult extends infer R
      ? R extends { reason: infer Why }
        ? Why
        : never
      : never,
  ): void {
    expect(result.malformed).toBe(true);
    if (!result.malformed) throw new Error("type narrowing failed");
    expect(result.reason).toBe(reason);
  }

  it("rejects empty string", () => {
    assertMalformed(validateApiKeyShape(""), "empty");
  });

  it("rejects undefined", () => {
    assertMalformed(validateApiKeyShape(undefined), "empty");
  });

  it("rejects whitespace-only", () => {
    assertMalformed(validateApiKeyShape("   "), "whitespace_only");
    assertMalformed(validateApiKeyShape("\t\n"), "whitespace_only");
  });

  it("rejects sub-16-char fragments like 'x'", () => {
    assertMalformed(validateApiKeyShape("x"), "too_short");
    assertMalformed(validateApiKeyShape("sk-short"), "too_short");
  });

  it("rejects keys with embedded whitespace", () => {
    assertMalformed(validateApiKeyShape("sk-abcdefghij klmnopqrstuvwxyz"), "embedded_whitespace");
  });

  it("flags provider prefix mismatch for openai", () => {
    assertMalformed(
      validateApiKeyShape("ak-abcdefghijklmnopqrstuvwxyz", "openai"),
      "missing_known_prefix",
    );
  });

  it("accepts a well-shaped openai key with explicit provider hint", () => {
    expect(validateApiKeyShape("sk-abcdefghijklmnopqrstuvwxyz", "openai").malformed).toBe(false);
  });

  it("accepts a well-shaped openrouter key", () => {
    expect(validateApiKeyShape("sk-or-v1-abcdefghijklmnopqrstuvwxyz", "openrouter").malformed).toBe(
      false,
    );
  });

  it("bypasses validation for fixture keys (theo_test_*)", () => {
    expect(validateApiKeyShape("theo_test_x").malformed).toBe(false);
    expect(validateApiKeyShape("theo_test_fixture").malformed).toBe(false);
  });

  it("bypasses validation for local-runtime mock key 'local'", () => {
    expect(validateApiKeyShape("local").malformed).toBe(false);
  });

  it("accepts long opaque keys when no provider hint is passed", () => {
    expect(validateApiKeyShape("very-long-opaque-key-abc123-xyz789").malformed).toBe(false);
  });
});

describe("T1.3 — Agent.create boundary validation", () => {
  it("throws AuthenticationError with code 'malformed_api_key' on 'x'", async () => {
    await expect(
      Agent.create({ apiKey: "x", model: { id: "openai/gpt-4o-mini" } }),
    ).rejects.toMatchObject({
      name: "AuthenticationError",
      code: "malformed_api_key",
    });
  });

  it("throws AuthenticationError on whitespace-only key", async () => {
    await expect(
      Agent.create({ apiKey: "   ", model: { id: "openai/gpt-4o-mini" } }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("accepts theo_test_fixture (existing fixture path)", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_fixture",
      model: { id: "openai/gpt-4o-mini" },
    });
    await agent.dispose();
  });
});
