/**
 * T5.1 — HKDF-SHA256 derivation for AES-256-GCM OAuth tx-cookie key
 * (CRITICAL, DR6 finding #1).
 *
 * Pre-T5.1 `server/auth/oauth-transaction-store.ts:deriveKey` accepted
 * any string secret and zero-padded raw bytes to 32 bytes if the
 * input was shorter, or truncated if longer. This is NOT a KDF. Two
 * near-identical secrets (e.g., `"a".repeat(31)` vs `"b".repeat(31)`)
 * produce nearly-identical AES keys: only one byte differs across
 * 32. An attacker who recovers one cookie can brute-force adjacent
 * deployments cheaply.
 *
 * T5.1 fixes the vulnerability by:
 *
 * (a) Rejecting secrets < 32 bytes outright (raise a typed error).
 *     Operators MUST supply at least 256 bits of entropy.
 * (b) Using HKDF-SHA256 with `info="theokit:oauth-tx-v1"` and a
 *     per-app salt sourced from `THEOKIT_OAUTH_TX_SALT` env (or empty
 *     RFC 5869 zero-string default) to derive the AES-256-GCM key.
 *     Distinct secrets ALWAYS produce distinct keys.
 *
 * The encryption/decryption round-trip stays end-to-end (same secret
 * encodes + decodes the same cookie) — only the derivation function
 * changes.
 */

import { describe, expect, it } from "vitest";
import {
  __TESTING__deriveKey,
  encodeTransaction,
  newTransaction,
} from "../../src/server/auth/oauth-transaction-store.js";

const TX = newTransaction({ state: "abc123", pkceVerifier: "v" });

// 32-byte secrets — minimum allowed.
const SECRET_A = "0123456789abcdef0123456789abcdef";
const SECRET_B = "abcdef0123456789abcdef0123456789";
const SECRET_NEAR_A = `${SECRET_A.slice(0, 31)}!`; // one-byte diff from SECRET_A

describe("T5.1 — HKDF-SHA256 key derivation (CRITICAL)", () => {
  it("rejects secrets shorter than 32 bytes with a typed error", async () => {
    await expect(() => encodeTransaction(TX, "tooshort")).rejects.toThrow(/32 bytes/i);
  });

  it("rejects empty secret with a typed error", async () => {
    await expect(() => encodeTransaction(TX, "")).rejects.toThrow(/32 bytes/i);
  });

  it("accepts 32-byte secret (minimum allowed)", async () => {
    const cookie = await encodeTransaction(TX, SECRET_A);
    expect(typeof cookie).toBe("string");
    expect(cookie.length).toBeGreaterThan(0);
  });

  it("distinct secrets produce distinct AES keys (no zero-padding collision)", async () => {
    const k1 = await __TESTING__deriveKey(SECRET_A);
    const k2 = await __TESTING__deriveKey(SECRET_B);
    const r1 = new Uint8Array(await crypto.subtle.exportKey("raw", k1));
    const r2 = new Uint8Array(await crypto.subtle.exportKey("raw", k2));
    expect(r1.length).toBe(32);
    expect(r2.length).toBe(32);
    expect(Buffer.from(r1).toString("hex")).not.toBe(Buffer.from(r2).toString("hex"));
  });

  it("near-identical secrets produce avalanche-distinct keys (T5.1 fuzz invariant)", async () => {
    const k1 = await __TESTING__deriveKey(SECRET_A);
    const k2 = await __TESTING__deriveKey(SECRET_NEAR_A);
    const r1 = new Uint8Array(await crypto.subtle.exportKey("raw", k1));
    const r2 = new Uint8Array(await crypto.subtle.exportKey("raw", k2));
    // Hamming distance > 100 bits expected from a real KDF (avalanche).
    // Pre-T5.1 (zero-pad): bytes 0..30 IDENTICAL, only byte 31 differs.
    let differingBytes = 0;
    for (let i = 0; i < 32; i++) {
      if (r1[i] !== r2[i]) differingBytes++;
    }
    expect(differingBytes).toBeGreaterThan(20); // >62% of bytes differ
  });

  it("same secret deterministically produces the same key (encrypt/decrypt round-trip)", async () => {
    const k1 = await __TESTING__deriveKey(SECRET_A);
    const k2 = await __TESTING__deriveKey(SECRET_A);
    const r1 = new Uint8Array(await crypto.subtle.exportKey("raw", k1));
    const r2 = new Uint8Array(await crypto.subtle.exportKey("raw", k2));
    expect(Buffer.from(r1).toString("hex")).toBe(Buffer.from(r2).toString("hex"));
  });

  it("salt from THEOKIT_OAUTH_TX_SALT env produces different key vs default", async () => {
    const k1 = await __TESTING__deriveKey(SECRET_A);
    const r1 = new Uint8Array(await crypto.subtle.exportKey("raw", k1));
    process.env.THEOKIT_OAUTH_TX_SALT = "per-app-salt-v1-very-unique";
    try {
      const k2 = await __TESTING__deriveKey(SECRET_A);
      const r2 = new Uint8Array(await crypto.subtle.exportKey("raw", k2));
      expect(Buffer.from(r1).toString("hex")).not.toBe(Buffer.from(r2).toString("hex"));
    } finally {
      delete process.env.THEOKIT_OAUTH_TX_SALT;
    }
  });
});
