/**
 * RED tests for T0.1 — `ErrorMetadata` + `ErrorCode` types on base class.
 * ADR D65 (optional field, no new hierarchy) + ADR D66 (finite enum).
 */

import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  ConfigurationError,
  type ErrorCode,
  type ErrorMetadata,
  NetworkError,
  RateLimitError,
  TheokitAgentError,
} from "../../src/errors.js";

describe("ErrorMetadata + ErrorCode (T0.1, ADR D65/D66)", () => {
  it("TheokitAgentError accepts metadata in constructor options", () => {
    const meta: ErrorMetadata = {
      provider: "anthropic",
      endpoint: "/v1/messages",
      code: "rate_limit",
    };
    const err = new TheokitAgentError("rate limited", { metadata: meta });
    expect(err.metadata).toEqual(meta);
    expect(err.metadata?.provider).toBe("anthropic");
    expect(err.metadata?.endpoint).toBe("/v1/messages");
    expect(err.metadata?.code).toBe("rate_limit");
  });

  it("TheokitAgentError without metadata leaves field undefined (backward compat)", () => {
    const err = new TheokitAgentError("legacy error");
    expect(err.metadata).toBeUndefined();
  });

  it("AuthenticationError accepts metadata via subclass options", () => {
    const meta: ErrorMetadata = {
      provider: "openai",
      endpoint: "/v1/chat/completions",
      code: "auth_failed",
      statusCode: 401,
    };
    const err = new AuthenticationError("bad key", { metadata: meta });
    expect(err.metadata).toEqual(meta);
    expect(err).toBeInstanceOf(TheokitAgentError);
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it("RateLimitError preserves retryAfter inside metadata", () => {
    const err = new RateLimitError("hit limit", {
      metadata: {
        provider: "openrouter",
        endpoint: "/v1/chat/completions",
        code: "rate_limit",
        statusCode: 429,
        retryAfter: 30,
      },
    });
    expect(err.metadata?.retryAfter).toBe(30);
    expect(err.isRetryable).toBe(true);
  });

  it("NetworkError accepts metadata for server_error path", () => {
    const err = new NetworkError("upstream 503", {
      metadata: {
        provider: "anthropic",
        endpoint: "/v1/messages",
        code: "server_error",
        statusCode: 503,
      },
    });
    expect(err.metadata?.code).toBe("server_error");
    expect(err.metadata?.statusCode).toBe(503);
  });

  it("ConfigurationError accepts metadata for context_too_long path", () => {
    const err = new ConfigurationError("ctx too long", {
      metadata: {
        provider: "openai",
        endpoint: "/v1/chat/completions",
        code: "context_too_long",
        statusCode: 400,
      },
    });
    expect(err.metadata?.code).toBe("context_too_long");
  });

  it("metadata and cause coexist on the same error instance", () => {
    const original = new Error("network EAI_AGAIN");
    const wrapped = new TheokitAgentError("wrapped", {
      cause: original,
      metadata: {
        provider: "anthropic",
        endpoint: "/v1/messages",
        code: "network",
      },
    });
    expect(wrapped.cause).toBe(original);
    expect(wrapped.metadata?.code).toBe("network");
  });

  it("existing callers without metadata continue working (backward compat)", () => {
    const auth = new AuthenticationError("missing key", { code: "missing_api_key" });
    expect(auth.code).toBe("missing_api_key");
    expect(auth.metadata).toBeUndefined();

    const rate = new RateLimitError("legacy");
    expect(rate.metadata).toBeUndefined();
  });

  it("ErrorCode is a literal union (compile-time exhaustive switch)", () => {
    const codes: ErrorCode[] = [
      "rate_limit",
      "auth_failed",
      "invalid_request",
      "timeout",
      "server_error",
      "context_too_long",
      "content_filtered",
      "model_unavailable",
      "network",
      "unknown",
    ];
    expect(codes).toHaveLength(10);
    // The compile-time check happens at typecheck. If a new code is added
    // without expanding the union, this line still fires the array literal.
  });

  it("can be caught via base TheokitAgentError and metadata accessed", () => {
    try {
      throw new RateLimitError("limit", {
        metadata: {
          provider: "openai",
          endpoint: "/v1/chat/completions",
          code: "rate_limit",
          retryAfter: 60,
        },
      });
    } catch (err) {
      if (err instanceof TheokitAgentError && err.metadata !== undefined) {
        // Caller does switch over err.metadata.code exhaustively
        const code: ErrorCode = err.metadata.code;
        expect(code).toBe("rate_limit");
        expect(err.metadata.retryAfter).toBe(60);
      } else {
        throw new Error("expected metadata to be present");
      }
    }
  });
});
