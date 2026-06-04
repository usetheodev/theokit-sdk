/**
 * @theokit/sdk/server/auth — encrypted OAuth transaction cookie store
 *
 * Per ADR D5 — cookie-state pattern (no Redis/db dependency in core).
 *
 * Stores OAuthTransaction (state + pkceVerifier + returnTo + expiry) in a
 * single signed+encrypted HttpOnly cookie. Stateless, works in edge/serverless.
 *
 * Cookie name: `theo_oauth_tx`
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

const COOKIE_NAME = "theo_oauth_tx";
const TX_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes per D5

async function deriveKey(secret: string): Promise<webcrypto.CryptoKey> {
  const keyMaterial = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(secret).slice(0, 32).length === 32
      ? Buffer.from(secret).slice(0, 32)
      : Buffer.concat([Buffer.from(secret), Buffer.alloc(32)]).slice(0, 32),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return keyMaterial;
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

export async function decodeTransaction(
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

export function getCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function setCookie(res: ServerResponse, name: string, value: string): void {
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

export function clearCookie(res: ServerResponse, name: string): void {
  setCookie(
    res,
    name,
    `; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`.split(";").slice(0, 1).join(""),
  );
  // Explicit clear with Max-Age=0
  const clear = `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
  const existing = res.getHeader("Set-Cookie");
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing.filter((c) => !c.includes(`${name}=`)), clear]);
  } else {
    res.setHeader("Set-Cookie", clear);
  }
}

export async function setTransaction(
  res: ServerResponse,
  tx: OAuthTransaction,
  secret: string,
): Promise<void> {
  const encoded = await encodeTransaction(tx, secret);
  setCookie(res, COOKIE_NAME, encoded);
}

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
