/**
 * T5.3 — `__Host-` cookie prefix + cookie clear fix (DR6 finding #3).
 *
 * Pre-T5.3 the OAuth tx-cookie was named `theo_oauth_tx`. Browsers
 * accepted it without enforcing the cookie-prefix contract, leaving
 * the door open for subdomain attacks: a malicious page on
 * `evil.example.com` could set a `theo_oauth_tx` cookie that the
 * parent app at `example.com` would happily decrypt and treat as
 * its own (cookie-fixation / CSRF on the OAuth state).
 *
 * RFC 6265bis defines the `__Host-` prefix as a browser-enforced
 * security contract: the cookie MUST be set with `Secure`, MUST NOT
 * have a `Domain` attribute, and MUST have `Path=/`. Browsers reject
 * any `__Host-`-prefixed cookie that violates the contract.
 *
 * Additionally `clearCookie` previously called `setCookie` with an
 * empty value (still carrying `Max-Age=600` from the live cookie)
 * AND then issued a second explicit `Max-Age=0` clear into the
 * Set-Cookie header — creating a duplicate response header that
 * some legacy clients did not handle deterministically. T5.3
 * simplifies to a single clean clear with `Max-Age=0` + the legacy
 * `Expires=Thu, 01 Jan 1970 00:00:00 GMT` for pre-modern browsers.
 */

import { ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { clearTransaction } from "../../src/server/auth/oauth-transaction-store.js";

function buildResponse(): ServerResponse {
  // Construct a ServerResponse without actually opening a socket — we
  // only read the Set-Cookie header(s) it produces.
  const req = { method: "GET", url: "/", headers: {} } as unknown as Parameters<
    typeof ServerResponse.prototype.assignSocket
  >[0];
  const res = new ServerResponse(req as never);
  res.assignSocket(new Socket());
  return res;
}

function readSetCookieHeaders(res: ServerResponse): string[] {
  const raw = res.getHeader("Set-Cookie");
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") return [raw];
  return [];
}

describe("T5.3 — __Host- cookie prefix", () => {
  // REMOVED 2026-09-01 — a test that could not fail, holding the only title in this file that
  // claimed to cover the EMIT path.
  //
  // It wrote the header itself — `res.setHeader("Set-Cookie", `__Host-theo_oauth_tx=${encoded}; …`)`
  // — and then asserted that the header started with `__Host-theo_oauth_tx=`. No production code
  // produced the cookie NAME anywhere in it; the only SDK call supplied the value. What it measured
  // was `ServerResponse.getHeader`.
  //
  // Measured rather than argued: with `COOKIE_NAME` in oauth-transaction-store.ts changed from
  // `__Host-theo_oauth_tx` to `theo_oauth_tx` — the exact defect that broke every
  // orchestrator-driven sign-in and survived from 2.18.0 to 4.53.1 — this file reported
  // **5 failed | 1 passed**, and the one that passed was this test. The five that failed are the
  // `clearTransaction` cases below, which call production and are why the file is not worthless.
  //
  // The emit path IS covered, by a test that drives it: `server/auth-cookie-roundtrip.test.ts:66`
  // calls `auth.startSignIn(...)` and asserts `/^__Host-theo_oauth_tx=/` on what production
  // returned. That one fails under the same mutation. Keeping this one cost more than nothing: a
  // title claiming emit coverage is what stops the next reader from noticing there was none.

  it("clearTransaction emits a Set-Cookie with the __Host- prefix", () => {
    const res = buildResponse();
    clearTransaction(res);
    const cookies = readSetCookieHeaders(res);
    expect(cookies.some((c) => c.startsWith("__Host-theo_oauth_tx="))).toBe(true);
  });

  it("clearTransaction sets Max-Age=0 (browser deletes immediately)", () => {
    const res = buildResponse();
    clearTransaction(res);
    const cookies = readSetCookieHeaders(res);
    const cleared = cookies.find((c) => c.startsWith("__Host-theo_oauth_tx="));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0/);
  });

  it("clearTransaction sets legacy Expires=Thu, 01 Jan 1970 for pre-modern browsers", () => {
    const res = buildResponse();
    clearTransaction(res);
    const cookies = readSetCookieHeaders(res);
    const cleared = cookies.find((c) => c.startsWith("__Host-theo_oauth_tx="));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Expires=Thu,\s*01\s*Jan\s*1970/i);
  });

  it("clearTransaction respects __Host- prefix contract: Secure + Path=/ + no Domain", () => {
    const res = buildResponse();
    clearTransaction(res);
    const cookies = readSetCookieHeaders(res);
    const cleared = cookies.find((c) => c.startsWith("__Host-theo_oauth_tx="));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Secure/);
    expect(cleared).toMatch(/Path=\//);
    expect(cleared).not.toMatch(/Domain=/);
  });

  it("clearTransaction emits exactly ONE Set-Cookie line for the tx cookie (no duplicate)", () => {
    const res = buildResponse();
    clearTransaction(res);
    const cookies = readSetCookieHeaders(res);
    const txCookies = cookies.filter((c) => c.startsWith("__Host-theo_oauth_tx="));
    expect(txCookies.length).toBe(1);
  });
});
