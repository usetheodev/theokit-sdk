/**
 * The cookie `startSignIn` sets must be the one `finishSignIn` reads.
 *
 * `oauth-transaction-store.ts` declares `COOKIE_NAME = "__Host-theo_oauth_tx"` and uses it to write
 * and to read. `orchestrator.ts` did not: it built the `Set-Cookie` header by hand — the comment
 * beside it says "need Set-Cookie header manually" — and the literal it wrote,
 * `theo_oauth_tx=`, lost the prefix.
 *
 * The consequence is not subtle. Every OAuth sign-in driven through the orchestrator failed at the
 * callback with `AuthCallbackError: OAuth transaction cookie missing or expired`, on a request that
 * carried the cookie and had not expired. Reproduced end to end against the published 4.53.1 and
 * against 2.18.0 — it survived a major.
 *
 * `server/auth-host-cookie-prefix.test.ts` did not catch it because it sets the header itself
 * (`res.setHeader("Set-Cookie", "__Host-theo_oauth_tx=...")`) and then asserts on its own string.
 * That is a test of the literal in the test. This one drives `startSignIn` and hands what it emits
 * back to `finishSignIn`, which is what a browser does.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import { Auth } from "../../src/server/auth/orchestrator.js";
import type { AuthProvider, OAuthTransaction } from "../../src/server/auth/types.js";

const provider: AuthProvider<{ sub: string; email: string }> = {
  name: "probe",
  createAuthorizationURL: (tx: OAuthTransaction) =>
    Promise.resolve(new URL(`https://idp.test/authorize?state=${tx.state}`)),
  handleCallback: () =>
    Promise.resolve({
      providerName: "probe",
      profile: { sub: "u1", email: "u@example.test" },
    }),
};

/** The minimum session manager the orchestrator requires. */
const session = {
  createSession: () => Promise.resolve(undefined),
  getSession: () => Promise.resolve(null),
  getSessionWithMeta: () => Promise.resolve({ data: null, meta: {} }),
  destroySession: () => Promise.resolve(undefined),
};

/** The minimum an `IncomingMessage` needs to be for the orchestrator to read it. */
function nodeReq(url: string, cookie?: string): IncomingMessage {
  return {
    url,
    headers: cookie === undefined ? { host: "app.test" } : { host: "app.test", cookie },
  } as unknown as IncomingMessage;
}

/** The minimum a `ServerResponse` needs to be. */
function nodeRes(): ServerResponse {
  const headers: Record<string, unknown> = {};
  return {
    setHeader: (k: string, v: unknown) => {
      headers[k] = v;
    },
    getHeader: (k: string) => headers[k],
  } as unknown as ServerResponse;
}

describe("the OAuth transaction cookie survives the round trip", () => {
  it("writes it under the name the transaction store reads", async () => {
    // `Auth.create`, not `new Auth(...)`: the constructor is empty and returns an object with no
    // methods, silently. Measured on the published build while reproducing this.
    const auth = Auth.create({
      providers: [provider],
      session: session as never,
    });

    const started = await auth.startSignIn("probe", nodeReq("/api/auth/probe"));
    const setCookie = started.headers.get("set-cookie");

    expect(setCookie, "startSignIn set no cookie").not.toBeNull();

    // The assertion that matters: the name, not the value. `__Host-` is what the store looks
    // for, and RFC 6265bis makes the prefix a browser-enforced guarantee — without it a sibling
    // subdomain can set this cookie.
    expect(setCookie).toMatch(/^__Host-theo_oauth_tx=/);
  });

  it("completes the callback when the browser returns exactly what was set", async () => {
    // `Auth.create`, not `new Auth(...)`: the constructor is empty and returns an object with no
    // methods, silently. Measured on the published build while reproducing this.
    const auth = Auth.create({
      providers: [provider],
      session: session as never,
    });

    const started = await auth.startSignIn("probe", nodeReq("/api/auth/probe"));
    const setCookie = started.headers.get("set-cookie") ?? "";
    const cookiePair = setCookie.split(";")[0];
    const state = new URL(started.headers.get("location") ?? "").searchParams.get("state");

    // Both halves are Node-shaped: `(name, req: IncomingMessage, res: ServerResponse)`. The
    // helpers above supply the minimum each side reads.
    //
    // Hand back exactly what was set, as a browser does — nothing rewritten.
    await expect(
      auth.finishSignIn(
        "probe",
        nodeReq(`/api/auth/probe/callback?code=abc&state=${state}`, cookiePair),
        nodeRes(),
      ),
    ).resolves.toBeDefined();
  });
});
