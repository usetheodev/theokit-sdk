/**
 * T1.5 — `AgentRunError.providerError` MUST redact any secret-shaped
 * substrings in the raw provider response, AND `JSON.stringify(err)` MUST
 * NOT leak `metadata.raw` unless the operator explicitly opts in via
 * `THEOKIT_DEBUG_RAW_ERRORS=1`.
 *
 * Without these guards, a 401/403 dump containing the offending Authorization
 * header (or a JSON body echoing the API key) flows into logs / Sentry /
 * Langfuse and amplifies the breach blast-radius.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentRunError } from "../../src/errors.js";

const LEAKY_RAW = JSON.stringify({
  error: { message: "Invalid API key sk-abcdefghijklmnopqrstuvwxyz1234" },
  headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.body.sig" },
});

let restoreDebug: string | undefined;

beforeEach(() => {
  restoreDebug = process.env.THEOKIT_DEBUG_RAW_ERRORS;
  delete process.env.THEOKIT_DEBUG_RAW_ERRORS;
});

afterEach(() => {
  if (restoreDebug === undefined) delete process.env.THEOKIT_DEBUG_RAW_ERRORS;
  else process.env.THEOKIT_DEBUG_RAW_ERRORS = restoreDebug;
});

describe("T1.5 — providerError getter redacts secrets", () => {
  it("getter removes sk-... fragments from raw", () => {
    const err = new AgentRunError("Provider rejected", {
      code: "auth_failed",
      metadata: {
        provider: "openai",
        endpoint: "/v1/chat/completions",
        code: "auth_failed",
        raw: LEAKY_RAW,
      },
    });
    const surfaced = String(err.providerError ?? "");
    expect(surfaced).not.toContain("sk-abcdefghijklmnopqrstuvwxyz1234");
  });

  it("getter removes Bearer JWT-like tokens from raw", () => {
    const err = new AgentRunError("Provider rejected", {
      code: "auth_failed",
      metadata: {
        provider: "openai",
        endpoint: "/v1/chat/completions",
        code: "auth_failed",
        raw: LEAKY_RAW,
      },
    });
    const surfaced = String(err.providerError ?? "");
    expect(surfaced).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.body.sig");
  });
});

describe("T1.5 — JSON.stringify omits metadata.raw by default", () => {
  it("metadata.raw absent from JSON when THEOKIT_DEBUG_RAW_ERRORS unset", () => {
    const err = new AgentRunError("Provider rejected", {
      code: "auth_failed",
      metadata: {
        provider: "openai",
        endpoint: "/v1/chat/completions",
        code: "auth_failed",
        raw: LEAKY_RAW,
      },
    });
    const serialized = JSON.stringify(err);
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrstuvwxyz1234");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.body.sig");
    expect(serialized).not.toMatch(/"raw"\s*:/);
  });

  it("metadata.raw exposed (redacted) when THEOKIT_DEBUG_RAW_ERRORS=1", () => {
    process.env.THEOKIT_DEBUG_RAW_ERRORS = "1";
    const err = new AgentRunError("Provider rejected", {
      code: "auth_failed",
      metadata: {
        provider: "openai",
        endpoint: "/v1/chat/completions",
        code: "auth_failed",
        raw: LEAKY_RAW,
      },
    });
    const serialized = JSON.stringify(err);
    expect(serialized).toMatch(/"raw"\s*:/);
    // Even with debug on, the raw value MUST stay redacted.
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrstuvwxyz1234");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.body.sig");
  });

  it("non-metadata fields stay accessible in JSON", () => {
    const err = new AgentRunError("Provider rejected", {
      code: "auth_failed",
      provider: "openai",
      requestId: "req_abc",
      metadata: {
        provider: "openai",
        endpoint: "/v1/chat/completions",
        code: "auth_failed",
        raw: LEAKY_RAW,
      },
    });
    const parsed: { name?: string; code?: string; provider?: string; requestId?: string } =
      JSON.parse(JSON.stringify(err));
    expect(parsed.name).toBe("AgentRunError");
    expect(parsed.code).toBe("auth_failed");
    expect(parsed.provider).toBe("openai");
    expect(parsed.requestId).toBe("req_abc");
  });
});
