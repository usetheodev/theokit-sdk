/**
 * Tests for `truncateRaw` redaction wiring (T1.1, ADRs D67/D68).
 *
 * Confirms ErrorMetadata.raw never echoes secrets even when the
 * provider response body includes them.
 */

import { describe, expect, it } from "vitest";

import { buildErrorMetadata, truncateRaw } from "../../../../src/internal/errors/mappers/shared.js";

describe("truncateRaw — secret redaction (T1.1)", () => {
  it("masks long sk-* tokens in string bodies", () => {
    const secret = "sk-abcdef0123456789ghijklmnopqrstuv";
    const out = truncateRaw(`{"error":"invalid key: ${secret}"}`);
    expect(out).not.toContain(secret);
    expect(typeof out).toBe("string");
  });

  it("masks Authorization: Bearer in echoed request headers", () => {
    const out = truncateRaw('{"error":{"req_headers":{"Authorization":"Bearer eyJabc.def.ghi"}}}');
    expect(out).not.toContain("eyJabc.def.ghi");
    expect(out).toContain("Bearer ***");
  });

  it("masks secrets when body is an object — returns string post-redact", () => {
    const out = truncateRaw({ error: { message: "key=sk-abcdef0123456789ghijklmn" } });
    expect(typeof out).toBe("string");
    expect(out).not.toContain("sk-abcdef0123456789ghijklmn");
  });

  it("returns undefined for null input", () => {
    expect(truncateRaw(null)).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(truncateRaw(undefined)).toBeUndefined();
  });
});

describe("buildErrorMetadata — wires redaction via truncateRaw", () => {
  it("produces redacted raw in the assembled metadata", () => {
    const secret = "sk-abcdef0123456789ghijklmnop";
    const meta = buildErrorMetadata({
      provider: "anthropic",
      endpoint: "/v1/messages",
      code: "auth_failed",
      status: 401,
      headers: undefined,
      body: { error: { message: `invalid key: ${secret}` } },
    });
    expect(typeof meta.raw).toBe("string");
    expect(meta.raw).not.toContain(secret);
    expect(meta.provider).toBe("anthropic");
  });
});
