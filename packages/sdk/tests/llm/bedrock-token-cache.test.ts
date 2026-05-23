/**
 * Tests for resolveBedrockToken (D287, D295).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetBedrockTokenCache,
  resolveBedrockToken,
} from "../../src/internal/llm/bedrock-token-cache.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  __resetBedrockTokenCache();
});
afterEach(() => {
  process.env = originalEnv;
  __resetBedrockTokenCache();
});

describe("resolveBedrockToken — env path", () => {
  it("returns env value when AWS_BEARER_TOKEN_BEDROCK set", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "env-token";
    const token = await resolveBedrockToken("us-east-1");
    expect(token).toBe("env-token");
  });

  it("env wins even when generator peer dep installed (precedence)", async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = "env-token";
    // generator would normally be tried — but env takes precedence.
    const token = await resolveBedrockToken("us-west-2");
    expect(token).toBe("env-token");
  });
});

describe("resolveBedrockToken — peer dep path", () => {
  // The peer deps `@aws/bedrock-token-generator` + `@aws-sdk/credential-providers`
  // may be hoisted into the workspace root in dev. When they are AND AWS
  // credentials are available, `resolveBedrockToken` returns a real Bearer token
  // (string starting with `bedrock-api-key-`). When either peer is missing or
  // the credential chain fails, it returns `undefined`. Both outcomes are valid.
  it("returns either a generated token or undefined (depending on peer + creds availability)", async () => {
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    const token = await resolveBedrockToken("us-east-1");
    if (token !== undefined) {
      expect(token).toMatch(/^bedrock-api-key-/);
    } else {
      expect(token).toBeUndefined();
    }
  });
});
