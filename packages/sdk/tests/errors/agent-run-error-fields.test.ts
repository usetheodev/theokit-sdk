/**
 * AgentRunError discriminated codes + computed getters (Production-Readiness #3, ADRs D311-D314).
 */

import { describe, expect, it } from "vitest";

import { AgentRunError } from "../../src/errors.js";

describe("AgentRunError — discriminated code union (T3.1)", () => {
  it("accepts new code: quota_exceeded", () => {
    const err = new AgentRunError("billing", { code: "quota_exceeded" });
    expect(err.code).toBe("quota_exceeded");
  });

  it("accepts new code: tool_runtime_error", () => {
    const err = new AgentRunError("handler threw", { code: "tool_runtime_error" });
    expect(err.code).toBe("tool_runtime_error");
  });

  it("accepts new code: aborted", () => {
    const err = new AgentRunError("user cancelled", { code: "aborted" });
    expect(err.code).toBe("aborted");
  });

  it("accepts new code: invalid_model", () => {
    const err = new AgentRunError("no such model", { code: "invalid_model" });
    expect(err.code).toBe("invalid_model");
  });

  it("accepts new code: safety_blocked", () => {
    const err = new AgentRunError("safety filter", { code: "safety_blocked" });
    expect(err.code).toBe("safety_blocked");
  });

  it("accepts new code: provider_unreachable", () => {
    const err = new AgentRunError("dns failure", { code: "provider_unreachable" });
    expect(err.code).toBe("provider_unreachable");
  });

  it("existing legacy ErrorCode values still accepted (backcompat)", () => {
    const codes = ["rate_limit", "auth_failed", "network", "unknown"] as const;
    for (const c of codes) {
      const err = new AgentRunError("legacy", { code: c });
      expect(err.code).toBe(c);
    }
  });

  it("forward-compat string code accepted via `& {}` escape hatch", () => {
    const err = new AgentRunError("future", { code: "future_unknown_code" });
    expect(err.code).toBe("future_unknown_code");
  });
});

describe("AgentRunError — computed getters (T3.2)", () => {
  it("retriable mirrors isRetryable (rate_limit → true)", () => {
    const err = new AgentRunError("rate limited", { code: "rate_limit" });
    expect(err.retriable).toBe(true);
    expect(err.isRetryable).toBe(true);
  });

  it("retriable false for non-retriable codes (auth_failed)", () => {
    const err = new AgentRunError("bad key", { code: "auth_failed" });
    expect(err.retriable).toBe(false);
  });

  it("retriable: true override wins over code default", () => {
    const err = new AgentRunError("unusual", { code: "auth_failed", retriable: true });
    expect(err.retriable).toBe(true);
  });

  it("retryAfterMs converts seconds to ms", () => {
    const err = new AgentRunError("rate limited", {
      code: "rate_limit",
      metadata: { provider: "openai", endpoint: "/v1/chat", code: "rate_limit", retryAfter: 30 },
    });
    expect(err.retryAfterMs).toBe(30_000);
  });

  it("retryAfterMs undefined when no metadata.retryAfter", () => {
    const err = new AgentRunError("network", { code: "network" });
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("retryAfterMs returns 0 (not undefined) when retryAfter is 0 — EC-11", () => {
    const err = new AgentRunError("immediate retry", {
      code: "rate_limit",
      metadata: { provider: "openai", endpoint: "/v1/chat", code: "rate_limit", retryAfter: 0 },
    });
    expect(err.retryAfterMs).toBe(0);
    expect(err.retryAfterMs === undefined).toBe(false);
  });

  it("providerError aliases metadata.raw", () => {
    const rawBody = { error: { message: "leak risk" } };
    const err = new AgentRunError("server error", {
      code: "server_error",
      metadata: { provider: "openai", endpoint: "/v1/chat", code: "server_error", raw: rawBody },
    });
    expect(err.providerError).toBe(rawBody);
  });

  it("providerError undefined when no metadata", () => {
    const err = new AgentRunError("no metadata", { code: "unknown" });
    expect(err.providerError).toBeUndefined();
  });

  it(".message NEVER contains providerError content (anti-leak invariant)", () => {
    const secretPayload = { x_internal_token: "sk-leak-12345" };
    const err = new AgentRunError("server returned 500", {
      code: "server_error",
      metadata: {
        provider: "openai",
        endpoint: "/v1/chat",
        code: "server_error",
        raw: secretPayload,
      },
    });
    expect(err.message).not.toContain("sk-leak-12345");
    expect(err.message).not.toContain("x_internal_token");
    // But providerError is reachable for debugging
    expect(err.providerError).toBe(secretPayload);
  });
});

describe("AgentRunError — new fields (requestId, conversationId)", () => {
  it("requestId stored from constructor", () => {
    const err = new AgentRunError("failed", {
      code: "server_error",
      requestId: "req_abc123",
    });
    expect(err.requestId).toBe("req_abc123");
  });

  it("conversationId stored from constructor", () => {
    const err = new AgentRunError("failed mid-conversation", {
      code: "network",
      conversationId: "agent-user-42",
    });
    expect(err.conversationId).toBe("agent-user-42");
  });

  it("requestId + conversationId both omitted by default", () => {
    const err = new AgentRunError("simple", { code: "unknown" });
    expect(err.requestId).toBeUndefined();
    expect(err.conversationId).toBeUndefined();
  });
});
