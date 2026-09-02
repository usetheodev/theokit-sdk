/**
 * The OAuth transaction secret must not be a constant shipped inside the package.
 *
 * `txCookieSecret` fell back to `DEV_ONLY_INSECURE_OAUTH_TX_SECRET_REPLACE_IN_PROD` — a literal
 * anyone can read out of npm — and the cookie it encrypts carries `state` and `pkceVerifier`, the
 * two values that make an authorization-code flow safe against CSRF and code interception.
 *
 * The first fallback branch (`opts.session.secret`) is unreachable for a conforming caller:
 * `SessionManager` declares four methods and no `secret`. So unless a deployment sets
 * `THEOKIT_OAUTH_TX_SECRET`, the published constant was what encrypted it.
 *
 * `AuthSecretTooShortError` did not catch it — the constant is 48 characters, and that guard checks
 * length rather than provenance.
 *
 * It was latent only because the cookie-name mismatch stopped the flow completing. Fixing the name
 * without this would have made it reachable, which is why the two ship together.
 */

import type { IncomingMessage } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

const session = {
  createSession: () => Promise.resolve(undefined),
  getSession: () => Promise.resolve(null),
  getSessionWithMeta: () => Promise.resolve({ data: null, meta: {} }),
  destroySession: () => Promise.resolve(undefined),
};

function start() {
  const auth = Auth.create({
    providers: [provider],
    session: session as never,
  });
  return auth.startSignIn("probe", nodeReq("/api/auth/probe"));
}

let previousEnv: string | undefined;
let previousNodeEnv: string | undefined;

beforeEach(() => {
  previousEnv = process.env.THEOKIT_OAUTH_TX_SECRET;
  previousNodeEnv = process.env.NODE_ENV;
});

afterEach(() => {
  // Both restored, not merely one — a leaked NODE_ENV would change unrelated suites.
  if (previousEnv === undefined) delete process.env.THEOKIT_OAUTH_TX_SECRET;
  else process.env.THEOKIT_OAUTH_TX_SECRET = previousEnv;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

/** The minimum an `IncomingMessage` needs to be for the orchestrator to read it. */
function nodeReq(url: string, cookie?: string): IncomingMessage {
  return {
    url,
    headers: cookie === undefined ? { host: "app.test" } : { host: "app.test", cookie },
  } as unknown as IncomingMessage;
}

describe("the transaction secret in production", () => {
  it("refuses to start a sign-in when no secret is configured", async () => {
    delete process.env.THEOKIT_OAUTH_TX_SECRET;
    process.env.NODE_ENV = "production";

    // It throws from `Auth.create`, not from the first request — better than expected, and worth
    // asserting where it actually happens. An app misconfigured this way fails at wiring time,
    // where a developer is looking, rather than at a user's first sign-in.
    expect(() => start()).toThrow(/THEOKIT_OAUTH_TX_SECRET/);
  });

  it("starts normally when the secret is configured", async () => {
    process.env.THEOKIT_OAUTH_TX_SECRET = "a".repeat(48);
    process.env.NODE_ENV = "production";

    const res = await start();
    expect(res.status).toBe(302);
  });
});

describe("outside production", () => {
  it("still starts, so local development is not blocked", async () => {
    delete process.env.THEOKIT_OAUTH_TX_SECRET;
    process.env.NODE_ENV = "development";

    // The fallback stays usable off production. Refusing here would break every `pnpm dev`, and
    // the risk it guards against is a deployed app, not a laptop.
    const res = await start();
    expect(res.status).toBe(302);
  });
});
