/**
 * RED tests for T1.1 — `mapAnthropicError` HTTP error mapper.
 * Includes EC-2 (Anthropic 529 overloaded) + EC-5 (HTTP-date retry-after).
 */

import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
  UnknownAgentError,
} from "../../../../src/errors.js";
import { mapAnthropicError } from "../../../../src/internal/errors/mappers/anthropic.js";

function headers(record: Record<string, string> = {}): Headers {
  return new Headers(record);
}

describe("mapAnthropicError", () => {
  it("401 → AuthenticationError with metadata.code='auth_failed'", () => {
    const err = mapAnthropicError({
      status: 401,
      body: { error: { type: "authentication_error", message: "Invalid API key" } },
      headers: headers(),
      endpoint: "/v1/messages",
    });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.metadata?.provider).toBe("anthropic");
    expect(err.metadata?.code).toBe("auth_failed");
    expect(err.metadata?.endpoint).toBe("/v1/messages");
    expect(err.metadata?.statusCode).toBe(401);
  });

  it("429 → RateLimitError with metadata.code='rate_limit'", () => {
    const err = mapAnthropicError({
      status: 429,
      body: { error: { type: "rate_limit_error" } },
      headers: headers(),
      endpoint: "/v1/messages",
    });
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.metadata?.code).toBe("rate_limit");
  });

  it("429 with retry-after header populates metadata.retryAfter", () => {
    const err = mapAnthropicError({
      status: 429,
      body: {},
      headers: headers({ "retry-after": "60" }),
      endpoint: "/v1/messages",
    });
    expect(err.metadata?.retryAfter).toBe(60);
  });

  it("400 with context-length signal → ConfigurationError + code='context_too_long'", () => {
    const err = mapAnthropicError({
      status: 400,
      body: {
        error: { type: "invalid_request_error", message: "context length exceeded too long" },
      },
      headers: headers(),
      endpoint: "/v1/messages",
    });
    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err.metadata?.code).toBe("context_too_long");
  });

  it("400 generic → ConfigurationError + code='invalid_request'", () => {
    const err = mapAnthropicError({
      status: 400,
      body: { error: { type: "invalid_request_error", message: "missing parameter" } },
      headers: headers(),
      endpoint: "/v1/messages",
    });
    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err.metadata?.code).toBe("invalid_request");
  });

  it("503 → NetworkError with metadata.code='server_error'", () => {
    const err = mapAnthropicError({
      status: 503,
      body: {},
      headers: headers(),
      endpoint: "/v1/messages",
    });
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.metadata?.code).toBe("server_error");
  });

  it("body > 2KB → metadata.raw is truncated with '…' suffix", () => {
    const longString = "x".repeat(3000);
    const err = mapAnthropicError({
      status: 500,
      body: longString,
      headers: headers(),
      endpoint: "/v1/messages",
    });
    expect(typeof err.metadata?.raw).toBe("string");
    expect((err.metadata?.raw as string).length).toBeLessThanOrEqual(2049);
    expect((err.metadata?.raw as string).endsWith("…")).toBe(true);
  });

  it("metadata.provider is always 'anthropic'", () => {
    const err = mapAnthropicError({
      status: 500,
      body: {},
      headers: headers(),
      endpoint: "/anything",
    });
    expect(err.metadata?.provider).toBe("anthropic");
  });

  it("metadata.endpoint reflects what caller passed", () => {
    const err = mapAnthropicError({
      status: 500,
      body: {},
      headers: headers(),
      endpoint: "/v1/messages/special",
    });
    expect(err.metadata?.endpoint).toBe("/v1/messages/special");
  });

  // EC-2: Anthropic 529 "overloaded_error" — comum em horário de pico
  it("EC-2: 529 overloaded_error → NetworkError + retryAfter", () => {
    const err = mapAnthropicError({
      status: 529,
      body: { type: "error", error: { type: "overloaded_error" } },
      headers: headers({ "retry-after": "5" }),
      endpoint: "/v1/messages",
    });
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.metadata?.code).toBe("server_error");
    expect(err.metadata?.retryAfter).toBe(5);
    expect(err.metadata?.statusCode).toBe(529);
  });

  // EC-5: HTTP-date format retry-after must not propagate NaN
  it("EC-5: retry-after in HTTP-date format → metadata SEM retryAfter (no NaN propagation)", () => {
    const err = mapAnthropicError({
      status: 429,
      body: {},
      headers: headers({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }),
      endpoint: "/v1/messages",
    });
    expect(err.metadata?.retryAfter).toBeUndefined();
  });

  it("unknown status (e.g., 418) → UnknownAgentError", () => {
    const err = mapAnthropicError({
      status: 418,
      body: {},
      headers: headers(),
      endpoint: "/v1/messages",
    });
    expect(err).toBeInstanceOf(UnknownAgentError);
    expect(err.metadata?.code).toBe("unknown");
  });

  it("null body does not crash; metadata.raw is undefined", () => {
    const err = mapAnthropicError({
      status: 500,
      body: null,
      headers: headers(),
      endpoint: "/v1/messages",
    });
    expect(err.metadata?.raw).toBeUndefined();
  });

  it("undefined headers does not crash; metadata.retryAfter undefined", () => {
    const err = mapAnthropicError({
      status: 429,
      body: {},
      headers: undefined,
      endpoint: "/v1/messages",
    });
    expect(err.metadata?.retryAfter).toBeUndefined();
  });
});
