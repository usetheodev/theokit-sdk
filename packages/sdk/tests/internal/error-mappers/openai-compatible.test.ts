/**
 * RED tests for T1.2 — `mapOpenAICompatibleError` HTTP error mapper.
 * Includes EC-3 (body WITHOUT an .error field) + EC-5 (HTTP-date retry-after).
 */

import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
  UnknownAgentError,
} from "../../../src/errors.js";
import { mapOpenAICompatibleError } from "../../../src/internal/error-mappers/openai-compatible.js";

function headers(record: Record<string, string> = {}): Headers {
  return new Headers(record);
}

describe("mapOpenAICompatibleError", () => {
  it("401 → AuthenticationError + code='auth_failed'", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      status: 401,
      body: { error: { type: "invalid_api_key", message: "bad key" } },
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.metadata?.code).toBe("auth_failed");
    expect(err.metadata?.provider).toBe("openai");
  });

  it("429 with retry-after → RateLimitError + retryAfter", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openrouter",
      status: 429,
      body: { error: { type: "rate_limit_exceeded" } },
      headers: headers({ "retry-after": "30" }),
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.metadata?.code).toBe("rate_limit");
    expect(err.metadata?.retryAfter).toBe(30);
  });

  it("400 with context_length_exceeded → context_too_long", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      status: 400,
      body: { error: { code: "context_length_exceeded", message: "max tokens" } },
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err.metadata?.code).toBe("context_too_long");
  });

  it("400 with content_policy_violation → content_filtered", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      status: 400,
      body: { error: { code: "content_policy_violation" } },
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err.metadata?.code).toBe("content_filtered");
  });

  it("400 with model_not_found → model_unavailable", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      status: 400,
      body: { error: { code: "model_not_found" } },
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err.metadata?.code).toBe("model_unavailable");
  });

  it("500 → NetworkError + code='server_error'", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      status: 500,
      body: {},
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.metadata?.code).toBe("server_error");
  });

  it("providerId preserved in metadata", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openrouter",
      status: 401,
      body: {},
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err.metadata?.provider).toBe("openrouter");
  });

  it("HTML body falls back to status-based mapping", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      status: 502,
      body: "<html><body>502 Bad Gateway</body></html>",
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.metadata?.code).toBe("server_error");
  });

  it("body > 2KB → metadata.raw truncated with '…' suffix", () => {
    const big = "y".repeat(3000);
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      status: 500,
      body: big,
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(typeof err.metadata?.raw).toBe("string");
    expect((err.metadata?.raw as string).endsWith("…")).toBe(true);
  });

  // EC-3: body without .error field (DeepInfra, Together quirks)
  it("EC-3: body without an .error field + 429 → RateLimitError via status fallback", () => {
    const err = mapOpenAICompatibleError({
      providerId: "deepinfra",
      status: 429,
      body: { message: "Too many requests" },
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.metadata?.code).toBe("rate_limit");
    expect(err.metadata?.provider).toBe("deepinfra");
  });

  // EC-5: HTTP-date format retry-after must not propagate NaN
  it("EC-5: retry-after in HTTP-date format → metadata carries parsed seconds (#60)", () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      status: 429,
      body: {},
      headers: headers({ "retry-after": future }),
      endpoint: "/v1/chat/completions",
    });
    // #60 — the RFC-7231 HTTP-date form is now parsed to seconds-until-then.
    expect(err.metadata?.retryAfter).toBeGreaterThanOrEqual(28);
    expect(err.metadata?.retryAfter).toBeLessThanOrEqual(31);
  });

  it("unknown status (418) → UnknownAgentError", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      status: 418,
      body: {},
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err).toBeInstanceOf(UnknownAgentError);
    expect(err.metadata?.code).toBe("unknown");
  });

  // D314: Production-Readiness Phase 3 — billing-style codes
  it("T3.7 — 402 maps to quota_exceeded (was invalid_request pre-T3.7)", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      status: 402,
      body: { error: { type: "insufficient_quota" } },
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    // T3.7 widened ErrorCode with `quota_exceeded`; 402 now maps there
    // canonically. Pre-T3.7 callers received `invalid_request` due to the
    // missing bucket.
    expect(err.metadata?.code).toBe("quota_exceeded");
  });

  it("T3.7 — body with insufficient_quota code now maps to quota_exceeded", () => {
    const err = mapOpenAICompatibleError({
      providerId: "openai",
      status: 400,
      body: { error: { code: "insufficient_quota", message: "billing" } },
      headers: headers(),
      endpoint: "/v1/chat/completions",
    });
    expect(err.metadata?.code).toBe("quota_exceeded");
  });
});
