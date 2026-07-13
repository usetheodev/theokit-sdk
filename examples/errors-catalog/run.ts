/**
 * Errors — every SDK error extends TheokitAgentError, so you catch once and branch on `code`,
 * `isRetryable`, and `instanceof`. Deterministic: constructs typed errors and inspects them (no LLM).
 */
import assert from "node:assert/strict";
import {
  TheokitAgentError,
  AuthenticationError,
  RateLimitError,
  NetworkError,
  ConfigurationError,
  isTransientError,
} from "@theokit/sdk";

const errors: TheokitAgentError[] = [
  new AuthenticationError("invalid API key"),
  new RateLimitError("429 — slow down"),
  new NetworkError("connection reset", { code: "network_error" }),
  new ConfigurationError("missing model id"),
];

for (const err of errors) {
  console.log(
    `${err.name.padEnd(20)} base=${err instanceof TheokitAgentError} ` +
      `retryable=${err.isRetryable} transient=${isTransientError(err)}`,
  );
}

// --- validate output (assert) ---
assert.ok(errors.every((e) => e instanceof TheokitAgentError));
assert.equal(new RateLimitError("x").isRetryable, true);
assert.equal(new AuthenticationError("x").isRetryable, false);
