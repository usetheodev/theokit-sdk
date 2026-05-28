import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { computeLineSignature, verifyLineSignature } from "../src/signature.js";

describe("signature (D408)", () => {
  it("computeLineSignature matches HMAC-SHA256 base64", () => {
    const body = '{"events":[]}';
    const secret = "shhh";
    const expected = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(computeLineSignature(secret, body)).toBe(expected);
  });

  it("verifyLineSignature accepts a freshly-computed signature", () => {
    const body = '{"events":[]}';
    const secret = "shhh";
    const sig = computeLineSignature(secret, body);
    expect(verifyLineSignature(secret, body, sig)).toBe(true);
  });

  it("rejects when signature header is missing", () => {
    expect(verifyLineSignature("s", '{"events":[]}', undefined)).toBe(false);
  });

  it("rejects an empty signature header", () => {
    expect(verifyLineSignature("s", '{"events":[]}', "")).toBe(false);
  });

  it("rejects mismatched signature (different secret)", () => {
    const body = '{"events":[]}';
    const sigA = computeLineSignature("secret-a", body);
    expect(verifyLineSignature("secret-b", body, sigA)).toBe(false);
  });

  it("rejects signature of different length without throwing", () => {
    // timingSafeEqual throws on length mismatch; we guard via length check first.
    expect(verifyLineSignature("s", "body", "AAA")).toBe(false);
  });
});
