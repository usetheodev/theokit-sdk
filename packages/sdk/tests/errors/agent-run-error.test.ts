import { describe, expect, it } from "vitest";

import { AgentRunError, TheokitAgentError } from "../../src/index.js";

/**
 * T1.1 — AgentRunError class.
 *
 * New error class for the SDK's hierarchy. Thrown by `Agent.prompt` when
 * `throwOnError: true` is set (see T1.2). Carries the full structured
 * error metadata from a failed `RunResult` so callers can branch on
 * `code` + `provider` without unwrapping the run.
 *
 * Contract (sealed by these tests):
 *   - extends `TheokitAgentError` (no new hierarchy — ADR D65 of the SDK)
 *   - exposes `provider` + `raw` as public readonly fields
 *   - `code` is the standard SDK code (surface in catch via `.code`)
 *   - exported from the package barrel (consumers `import { AgentRunError } from '@theokit/sdk'`)
 */

describe("AgentRunError — class shape", () => {
  it("is exported from the @theokit/sdk barrel", () => {
    expect(typeof AgentRunError).toBe("function");
  });

  it("extends TheokitAgentError (no new hierarchy)", () => {
    const err = new AgentRunError("x", { code: "auth_failed" });
    expect(err).toBeInstanceOf(TheokitAgentError);
    expect(err).toBeInstanceOf(Error);
  });

  it("name is 'AgentRunError'", () => {
    const err = new AgentRunError("x", { code: "auth_failed" });
    expect(err.name).toBe("AgentRunError");
  });
});

describe("AgentRunError — fields", () => {
  it("carries provider + raw fields when supplied", () => {
    const err = new AgentRunError("Anthropic API error: auth_failed (HTTP 401)", {
      code: "auth_failed",
      provider: "anthropic",
      raw: '{"type":"error","error":{"type":"authentication_error"}}',
    });
    expect(err.provider).toBe("anthropic");
    expect(err.raw).toBe('{"type":"error","error":{"type":"authentication_error"}}');
  });

  it("code surfaces via the base class field in caught error", () => {
    try {
      throw new AgentRunError("rate limited", { code: "rate_limit" });
    } catch (e) {
      expect((e as AgentRunError).code).toBe("rate_limit");
    }
  });

  it("provider + raw are optional (undefined when omitted)", () => {
    const err = new AgentRunError("x", { code: "unknown" });
    expect(err.provider).toBeUndefined();
    expect(err.raw).toBeUndefined();
  });

  it("preserves message in the error chain", () => {
    const err = new AgentRunError("the agent run failed", { code: "server_error" });
    expect(err.message).toBe("the agent run failed");
  });

  it("accepts a cause for chained errors", () => {
    const root = new Error("network down");
    const err = new AgentRunError("upstream failed", { code: "network", cause: root });
    expect(err.cause).toBe(root);
  });
});
