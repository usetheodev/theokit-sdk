/**
 * RED tests for G5 T2.2 — @theokit/sdk/server/errors-envelope
 *
 * Per plan g5-error-envelope-cross-layer v1.0 § Phase 2 / T2.2.
 * Blueprint ADR D3 — SDK keeps 15+ Error class hierarchy internally;
 * boundary translation outward via toEnvelope()/fromEnvelope() at
 * Agent.send -> RunResult egress edge. NO hierarchy flattening.
 */
import { describe, expect, it } from "vitest";
import {
  AgentRunError,
  AuthenticationError,
  BudgetExceededError,
  ConfigurationError,
  CredentialPoolExhaustedError,
  IntegrationNotConnectedError,
  NetworkError,
  RateLimitError,
  TheokitAgentError,
  UnknownAgentError,
} from "../../src/errors.js";
import {
  fromEnvelope,
  type TheokitErrorEnvelope,
  toEnvelope,
} from "../../src/server/errors-envelope.js";

describe("toEnvelope (G5 T2.2)", () => {
  it("should map AuthenticationError to UNAUTHORIZED envelope", () => {
    // Given: an SDK authentication failure
    const err = new AuthenticationError("Invalid API key");

    // When: translated at boundary
    const env: TheokitErrorEnvelope = toEnvelope(err);

    // Then: envelope code is canonical UNAUTHORIZED
    expect(env.code).toBe("UNAUTHORIZED");
    expect(env.message).toBe("Invalid API key");
    expect(env.meta?.sdkErrorName).toBe("AuthenticationError");
  });

  it("should map RateLimitError to RATE_LIMITED envelope with retryable ext", () => {
    // Given: a rate-limit failure with retry-after hint
    const err = new RateLimitError("Quota exhausted", {
      metadata: {
        provider: "openai",
        endpoint: "/v1/chat/completions",
        code: "rate_limit",
        retryAfter: 30,
      },
    });

    // Then: envelope code is RATE_LIMITED + retryable ext populated
    const env = toEnvelope(err);
    expect(env.code).toBe("RATE_LIMITED");
    const ext = env.ext as { retryable: true; retryAfterMs?: number };
    expect(ext.retryable).toBe(true);
    // retryAfter is in seconds per SDK metadata; envelope normalizes to ms
    expect(ext.retryAfterMs).toBe(30_000);
  });

  it("should map ConfigurationError to PROVIDER_KEY_MISSING envelope", () => {
    // Given: a missing-config failure
    const err = new ConfigurationError("OPENAI_API_KEY is not set");

    // Then: envelope code surfaces the canonical PROVIDER_KEY_MISSING shape
    const env = toEnvelope(err);
    expect(env.code).toBe("PROVIDER_KEY_MISSING");
    expect(env.message).toMatch(/OPENAI_API_KEY/);
  });

  it("should map IntegrationNotConnectedError (ConfigurationError subclass) to PROVIDER_KEY_MISSING", () => {
    // Given: a more specific config failure (Notion/Google MCP not connected)
    const err = new IntegrationNotConnectedError("Notion is not connected", {
      provider: "notion",
      helpUrl: "/api/notion/oauth/start",
    });

    // Then: envelope code is still PROVIDER_KEY_MISSING (subclass inherits mapping)
    const env = toEnvelope(err);
    expect(env.code).toBe("PROVIDER_KEY_MISSING");
    expect(env.meta?.sdkErrorName).toBe("IntegrationNotConnectedError");
  });

  it("should map NetworkError to SERVICE_UNAVAILABLE envelope", () => {
    // Given: a transport-layer failure
    const err = new NetworkError("DNS resolution failed");

    // Then: envelope code is canonical SERVICE_UNAVAILABLE (retryable code)
    const env = toEnvelope(err);
    expect(env.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("should map AgentRunError to AGENT_RUN_ERROR envelope", () => {
    // Given: an agent runtime failure
    const err = new AgentRunError("Tool exceeded max iterations", {
      code: "tool_runtime_error",
    });

    // Then: envelope code is canonical AGENT_RUN_ERROR
    const env = toEnvelope(err);
    expect(env.code).toBe("AGENT_RUN_ERROR");
  });

  it("should map BudgetExceededError to BUDGET_EXCEEDED envelope", () => {
    // Given: a budget exceeded
    const err = new BudgetExceededError({
      budgetName: "session-default",
      window: "1h",
      spentUsd: 1.0,
      limitUsd: 0.5,
      mode: "block",
    });

    // Then: envelope code is BUDGET_EXCEEDED
    const env = toEnvelope(err);
    expect(env.code).toBe("BUDGET_EXCEEDED");
  });

  it("should map CredentialPoolExhaustedError to CREDENTIAL_POOL_EXHAUSTED", () => {
    // Given: pool exhausted
    const err = new CredentialPoolExhaustedError("openai pool exhausted", {
      provider: "openai",
    });

    // Then: envelope code is canonical CREDENTIAL_POOL_EXHAUSTED
    const env = toEnvelope(err);
    expect(env.code).toBe("CREDENTIAL_POOL_EXHAUSTED");
  });

  it("should map UnknownAgentError to INTERNAL_SERVER_ERROR envelope", () => {
    // Given: catch-all unknown error
    const err = new UnknownAgentError("something happened");

    // Then: envelope code is INTERNAL_SERVER_ERROR
    const env = toEnvelope(err);
    expect(env.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("should default unmapped TheokitAgentError to INTERNAL_SERVER_ERROR", () => {
    // Given: an unmapped (but still TheokitAgentError) instance via custom name
    const err = new TheokitAgentError("strange edge case");

    // Then: envelope falls back to INTERNAL_SERVER_ERROR
    const env = toEnvelope(err);
    expect(env.code).toBe("INTERNAL_SERVER_ERROR");
    expect(env.meta?.sdkErrorName).toBe("TheokitAgentError");
  });

  it("should map plain Error to INTERNAL_SERVER_ERROR envelope", () => {
    // Given: a non-SDK error
    const err = new Error("unexpected boom");

    // Then: safe fallback envelope is emitted
    const env = toEnvelope(err);
    expect(env.code).toBe("INTERNAL_SERVER_ERROR");
    expect(env.message).toBe("unexpected boom");
  });

  it("should preserve cause chain in envelope", () => {
    // Given: an SDK error wrapping another error
    const inner = new Error("underlying issue");
    const err = new TheokitAgentError("wrapped", { cause: inner });

    // Then: envelope.cause is the inner error
    const env = toEnvelope(err);
    expect(env.cause).toBe(inner);
  });
});

describe("fromEnvelope (G5 T2.2)", () => {
  it("should reconstruct AuthenticationError from UNAUTHORIZED envelope", () => {
    // Given: a canonical UNAUTHORIZED envelope from the wire
    const env: TheokitErrorEnvelope = {
      code: "UNAUTHORIZED",
      message: "Invalid token",
    };

    // When: hydrated back into SDK class hierarchy
    const err = fromEnvelope(env);

    // Then: the class identity is restored for downstream `instanceof` checks
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.message).toBe("Invalid token");
  });

  it("should reconstruct RateLimitError from RATE_LIMITED envelope", () => {
    // Given: a RATE_LIMITED envelope with retry-after ext
    const env: TheokitErrorEnvelope = {
      code: "RATE_LIMITED",
      message: "Slow down",
      ext: { retryable: true, retryAfterMs: 5_000 },
    };

    // When: hydrated
    const err = fromEnvelope(env);

    // Then: rate-limit class restored
    expect(err).toBeInstanceOf(RateLimitError);
  });

  it("should reconstruct ConfigurationError from PROVIDER_KEY_MISSING envelope", () => {
    // Given: a PROVIDER_KEY_MISSING envelope
    const env: TheokitErrorEnvelope = {
      code: "PROVIDER_KEY_MISSING",
      message: "OPENAI_API_KEY missing",
    };

    // When: hydrated
    const err = fromEnvelope(env);

    // Then: ConfigurationError is restored
    expect(err).toBeInstanceOf(ConfigurationError);
  });

  it("should round-trip common SDK errors preserving class identity", () => {
    // Given: an SDK AuthenticationError (has trivial reconstructor)
    const original = new AuthenticationError("Token invalid");

    // When: round-tripped through the envelope
    const env = toEnvelope(original);
    const restored = fromEnvelope(env);

    // Then: class identity (instanceof) is preserved at the boundary
    expect(restored).toBeInstanceOf(AuthenticationError);
    expect(restored.message).toBe("Token invalid");
  });

  it("should fall back to UnknownAgentError for envelopes lacking domain args (BudgetExceededError)", () => {
    // Given: a BUDGET_EXCEEDED envelope WITHOUT domain context (budgetName etc.)
    // — the envelope cannot carry SDK-internal field shape, so the
    // boundary documents this as: typed class lost, but TheokitAgentError
    // base preserved so consumer code still gets a safe handle.
    const env: TheokitErrorEnvelope = {
      code: "BUDGET_EXCEEDED",
      message: "Budget exceeded",
    };

    // When: hydrated
    const err = fromEnvelope(env);

    // Then: base class preserved (no false reconstruction)
    expect(err).toBeInstanceOf(UnknownAgentError);
  });

  it("should default INTERNAL_SERVER_ERROR codes to UnknownAgentError", () => {
    // Given: an INTERNAL_SERVER_ERROR envelope (catch-all surface)
    const env: TheokitErrorEnvelope = {
      code: "INTERNAL_SERVER_ERROR",
      message: "boom",
    };

    // When: hydrated
    const err = fromEnvelope(env);

    // Then: returns UnknownAgentError so consumer code still gets a typed
    // TheokitAgentError handle for downstream `instanceof` checks
    expect(err).toBeInstanceOf(UnknownAgentError);
    expect(err.message).toBe("boom");
  });
});
