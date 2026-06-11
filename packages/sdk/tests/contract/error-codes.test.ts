/**
 * T1.1 — `KnownAgentRunErrorCode` MUST be a closed literal union (no
 * `(string & {})` escape hatch). An exhaustive `switch (code)` whose every
 * arm is a known code MUST type-check; the `default` branch reduces to
 * `never` and a typed `assertNever` call passes `tsc --noEmit`.
 *
 * This test exists at compile-time AND at runtime: the runtime piece
 * verifies that the switch handles every known code; the compile-time
 * piece (which tsc validates) verifies the union is closed.
 *
 * Back-compat: `AgentRunErrorCode` is re-aliased to `KnownAgentRunErrorCode`
 * — same set of strings, no runtime behavior change. Legacy callers that
 * pass arbitrary strings into the `code` field of an `AgentRunError`
 * options object now get a type error AND ship a migration codemod (see
 * scripts/migrations/error-code-string-2-known.mjs).
 */

import { describe, expect, it } from "vitest";

import type { KnownAgentRunErrorCode } from "../../src/errors.js";

function assertNever(x: never): never {
  throw new Error(`Unreachable code branch: ${String(x)}`);
}

function categorize(code: KnownAgentRunErrorCode): "transient" | "auth" | "input" | "other" {
  switch (code) {
    case "rate_limit":
    case "timeout":
    case "server_error":
    case "network":
    case "provider_unreachable":
      return "transient";
    case "auth_failed":
      return "auth";
    case "invalid_request":
    case "context_too_long":
    case "content_filtered":
    case "model_unavailable":
    case "invalid_model":
    case "safety_blocked":
      return "input";
    case "quota_exceeded":
    case "tool_runtime_error":
    case "aborted":
    case "unknown":
      return "other";
    default:
      return assertNever(code);
  }
}

describe("T1.1 — KnownAgentRunErrorCode is a closed literal union", () => {
  it("every known code categorizes to exactly one bucket", () => {
    const allCodes: KnownAgentRunErrorCode[] = [
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
      "quota_exceeded",
      "tool_runtime_error",
      "aborted",
      "invalid_model",
      "safety_blocked",
      "provider_unreachable",
    ];
    for (const code of allCodes) {
      expect(["transient", "auth", "input", "other"]).toContain(categorize(code));
    }
  });

  it("assertNever resolves type to `never` in default branch (compile-time invariant)", () => {
    // If the union is open (contains `(string & {})`), the default branch's
    // `code` parameter would be inferred as `string` and `assertNever(code)`
    // would fail tsc with `Argument of type 'string' is not assignable to
    // parameter of type 'never'`. This test passes ONLY when the union is
    // closed. Runtime smoke also verifies the throw path.
    expect(() => assertNever("not-a-real-code" as never)).toThrow(/Unreachable/);
  });
});
