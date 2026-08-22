/**
 * Encrypted OAuth transaction cookie store — `@theokit/sdk/server/auth`.
 *
 * Per ADR D5 — cookie-state pattern (no Redis/db dependency in core).
 *
 * Stores OAuthTransaction (state + pkceVerifier + returnTo + expiry) in a
 * single signed+encrypted HttpOnly cookie. Stateless, works in edge/serverless.
 *
 * Cookie name: `__Host-theo_oauth_tx` (T5.3 — RFC 6265bis prefix)
 * Lifetime: 10 minutes (per D5 invariant)
 * Encryption: AES-256-GCM via Node's webcrypto subtle API
 *
 * Note: this is a minimal in-package implementation. Production deployments
 * may prefer using `theokit/server/auth/crypto`'s encrypt/decrypt helpers
 * via the SessionManager's existing secret rotation chain. For T1.2 we keep
 * it self-contained to avoid cross-package peer-dep complexity; T2+ may
 * refactor to share SessionManager's encrypt path.
 */

import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OAuthTransaction } from "./types.js";

// T5.3 — `__Host-` prefix per RFC 6265bis. Browsers enforce that any
// cookie with this prefix MUST be set with `Secure`, MUST NOT carry a
// `Domain` attribute, and MUST have `Path=/`. This blocks the
// subdomain-fixation vector where a malicious page on
// `evil.example.com` could plant a same-name cookie that the parent
// app at `example.com` would happily decrypt.
const COOKIE_NAME = "__Host-theo_oauth_tx";
const TX_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes per D5

// T5.1 — HKDF info string fixed per plan; bump version (v1 → v2) only when
// the AES-GCM derivation contract itself changes (which would invalidate
// all in-flight cookies).
const HKDF_INFO = "theokit:oauth-tx-v1";

/**
 * T5.1 — Derive a 32-byte AES-256-GCM key from `secret` via HKDF-SHA256
 * (RFC 5869). Replaces the pre-T5.1 zero-padding scheme that was NOT a
 * KDF and produced near-identical keys for near-identical secrets.
 *
 * Contract:
 * - `secret` MUST be ≥ 32 bytes (256 bits) — throws otherwise.
 * - Salt is sourced from `THEOKIT_OAUTH_TX_SALT` env (UTF-8 string);
 *   when unset, RFC 5869's zero-string fallback is used and operators
 *   accept the default cross-app collision risk.
 * - `info` is fixed at "theokit:oauth-tx-v1" so v1 cookies decrypt
 *   forever even if a future v2 derivation ships alongside.
 *
 * Throws `AuthSecretTooShortError` (typed) when secret < 32 bytes.
 *
 * @internal
 */
async function deriveKey(secret: string): Promise<webcrypto.CryptoKey> {
  const secretBytes = new TextEncoder().encode(secret);
  if (secretBytes.byteLength < 32) {
    throw new AuthSecretTooShortError(secretBytes.byteLength);
  }
  const saltRaw = process.env.THEOKIT_OAUTH_TX_SALT ?? "";
  const salt = new TextEncoder().encode(saltRaw);
  // Import the raw secret as HKDF input keying material.
  const ikm = await webcrypto.subtle.importKey("raw", secretBytes, "HKDF", false, ["deriveBits"]);
  // Derive 256 bits via HKDF-SHA256.
  const derived = await webcrypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode(HKDF_INFO) },
    ikm,
    256,
  );
  // Wrap the derived bits as an AES-GCM key.
  return webcrypto.subtle.importKey("raw", derived, { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * T5.1 — Typed error thrown when an OAuth tx-cookie secret has < 32
 * bytes of entropy. Surfaces the actual byte length so operators can
 * diagnose mis-configured env vars without leaking the secret itself.
 *
 * @public
 */
export class AuthSecretTooShortError extends Error {
  override readonly name = "AuthSecretTooShortError";
  constructor(actualBytes: number) {
    super(
      `OAuth transaction secret must be at least 32 bytes (got ${actualBytes}). ` +
        "Generate a fresh value with: openssl rand -base64 33",
    );
  }
}

/**
 * T5.1 — Test seam for the HKDF derivation. NOT included in the public
 * barrel — exposed only so unit tests can assert avalanche / determinism
 * properties without round-tripping through encodeTransaction.
 *
 * @internal
 */
export async function __TESTING__deriveKey(secret: string): Promise<webcrypto.CryptoKey> {
  return deriveKey(secret);
}

export async function encodeTransaction(tx: OAuthTransaction, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(tx));
  const ciphertext = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return Buffer.from(combined).toString("base64url");
}

async function decodeTransaction(
  encoded: string,
  secret: string,
): Promise<OAuthTransaction | null> {
  try {
    const key = await deriveKey(secret);
    const combined = Buffer.from(encoded, "base64url");
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const tx = JSON.parse(new TextDecoder().decode(plaintext)) as OAuthTransaction;
    return tx;
  } catch {
    return null;
  }
}

function getCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function setCookie(res: ServerResponse, name: string, value: string): void {
  const existing = res.getHeader("Set-Cookie");
  const cookie = `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TX_LIFETIME_MS / 1000}`;
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
  } else if (typeof existing === "string") {
    res.setHeader("Set-Cookie", [existing, cookie]);
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}

/**
 * T5.3 — Clear the tx cookie deterministically. Emits exactly ONE
 * Set-Cookie line for `name` (filtering any prior occurrences of the
 * same name from a pre-existing Set-Cookie header) with:
 *
 *   - empty value
 *   - `Max-Age=0` (modern browsers — immediate delete)
 *   - `Expires=Thu, 01 Jan 1970 00:00:00 GMT` (legacy fallback)
 *   - `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` — preserved so the
 *     `__Host-` prefix contract is honored even on the clear path
 *
 * Pre-T5.3 this function called setCookie() with an empty value (which
 * still carried `Max-Age=600`) AND then issued a second explicit
 * `Max-Age=0` clear into the Set-Cookie header. The double-write
 * produced a duplicate response header that some legacy clients did
 * not handle deterministically.
 */
function clearCookie(res: ServerResponse, name: string): void {
  const clear = `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  const existing = res.getHeader("Set-Cookie");
  const preserved = Array.isArray(existing)
    ? existing.filter((c) => !c.startsWith(`${name}=`))
    : typeof existing === "string" && !existing.startsWith(`${name}=`)
      ? [existing]
      : [];
  res.setHeader("Set-Cookie", [...preserved, clear]);
}

async function _setTransaction(
  res: ServerResponse,
  tx: OAuthTransaction,
  secret: string,
): Promise<void> {
  const encoded = await encodeTransaction(tx, secret);
  setCookie(res, COOKIE_NAME, encoded);
}
// Reserved internal helper — not currently invoked (drop-in for future T2.x refactor that consolidates SessionManager + tx-store crypto paths). Underscore prefix per biome noUnusedVariables documented escape.
void _setTransaction;

export async function getTransaction(
  req: IncomingMessage,
  secret: string,
): Promise<OAuthTransaction | null> {
  const raw = getCookie(req, COOKIE_NAME);
  if (!raw) return null;
  const tx = await decodeTransaction(raw, secret);
  if (!tx) return null;
  // Check expiry
  if (tx.expiresAt < Date.now()) return null;
  return tx;
}

export function clearTransaction(res: ServerResponse): void {
  clearCookie(res, COOKIE_NAME);
}

export function newTransaction(opts: {
  state: string;
  pkceVerifier?: string;
  returnTo?: string;
}): OAuthTransaction {
  const now = Date.now();
  return {
    state: opts.state,
    pkceVerifier: opts.pkceVerifier,
    returnTo: opts.returnTo,
    createdAt: now,
    expiresAt: now + TX_LIFETIME_MS,
  };
}
