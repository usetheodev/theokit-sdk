import { describe, expect, it } from "vitest";

import {
  AgentRunError,
  AuthenticationError,
  ConfigurationError,
  CredentialPoolExhaustedError,
  NetworkError,
  RateLimitError,
} from "../../src/errors.js";
import { isTransientError } from "../../src/index.js";

/**
 * M0-1 (plan m0-foundation-expose-primitives, T1.1) — public `isTransientError`.
 *
 * Contract (sealed by these tests):
 *   - exported from the `@theokit/sdk` barrel (consumers `import { isTransientError }`)
 *   - returns the SDK's own retryability verdict (`TheokitAgentError.isRetryable`)
 *   - never inspects `err.message`; non-SDK errors are conservatively `false`
 */
describe("isTransientError", () => {
  it("is exported from the @theokit/sdk barrel", () => {
    expect(typeof isTransientError).toBe("function");
  });

  it("test_isTransientError_true_for_RateLimitError", () => {
    expect(isTransientError(new RateLimitError("rate limited"))).toBe(true);
  });

  it("test_isTransientError_true_for_NetworkError", () => {
    expect(isTransientError(new NetworkError("timeout"))).toBe(true);
  });

  it("test_isTransientError_true_for_AgentRunError_rate_limit_code", () => {
    expect(isTransientError(new AgentRunError("rate limited", { code: "rate_limit" }))).toBe(true);
  });

  it("test_isTransientError_true_for_CredentialPoolExhaustedError", () => {
    expect(
      isTransientError(new CredentialPoolExhaustedError("exhausted", { provider: "openai" })),
    ).toBe(true);
  });

  it("test_isTransientError_false_for_AuthenticationError", () => {
    expect(isTransientError(new AuthenticationError("bad key"))).toBe(false);
  });

  it("test_isTransientError_false_for_ConfigurationError", () => {
    expect(isTransientError(new ConfigurationError("bad model"))).toBe(false);
  });

  it("test_isTransientError_true_for_AgentRunError_auth_failed_is_false", () => {
    expect(isTransientError(new AgentRunError("auth", { code: "auth_failed" }))).toBe(false);
  });

  it("test_isTransientError_false_for_plain_Error_null_undefined_string", () => {
    expect(isTransientError(new Error("generic"))).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError("rate limit exceeded")).toBe(false);
  });
});
