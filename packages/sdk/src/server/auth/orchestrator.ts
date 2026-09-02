/**
 * DefineAuth orchestrator runtime (Path C Hybrid) — `@theokit/sdk/server/auth`.
 *
 * Plan T1.2 implementation per blueprint Q5 § Path C signatures.
 * Composes existing primitives + the v1.1 EC-1/EC-2/EC-10 fixes.
 */

import { webcrypto } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthCallbackError,
  AuthCancelledError,
  AuthConfigError,
  AuthProviderNotFoundError,
} from "./errors.js";
import { clearTransaction, getTransaction, newTransaction } from "./oauth-transaction-store.js";
import type { AuthOrchestrator, AuthProvider, DefineAuthOptions } from "./types.js";
import { validateReturnTo } from "./validate-return-to.js";

const PROVIDER_NAME_RE = /^[a-z0-9-]{1,32}$/;

function randomState(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Generate a PKCE code_verifier per RFC 7636 §4.1 — 43..128 chars from the
 * unreserved set [A-Z][a-z][0-9]-._~ (base64url is a strict subset).
 *
 * 32 random bytes → 43 base64url chars satisfies the minimum. Provided by
 * the orchestrator so every transaction carries one; PKCE-aware providers
 * (Google) consume it; PKCE-ignorant providers (GitHub) discard it.
 */
function generatePkceVerifier(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

function txCookieSecret<TSession>(opts: DefineAuthOptions<TSession>): string {
  // Read through the PORT. This was `opts.session as unknown as { secret?: string | string[] }` —
  // and `as unknown as` is the tell: TypeScript would have refused the property access, so the code
  // asserted a shape `SessionManager` does not offer. No conforming caller could reach the branch,
  // nothing in src/ supplied the field, and it was green only because a test double carried one. The
  // comment that stood here said this code WANTED a `getCookieSecret()` method; `SessionManager` now
  // declares it, optional and additive, so the branch is reachable through the contract and the
  // double conforms rather than the code conforming to the double.
  const fromManager = opts.session.getCookieSecret?.();
  if (Array.isArray(fromManager)) {
    // First entry encrypts; the rest exist to verify cookies written before the last rotation.
    const first = fromManager[0];
    if (first !== undefined && first !== "") return first;
  } else if (fromManager !== undefined && fromManager !== "") {
    return fromManager;
  }
  const fromEnv = process.env.THEOKIT_OAUTH_TX_SECRET;
  if (fromEnv) return fromEnv;

  // The comment that used to sit here said this fallback "will fail in production scrutiny —
  // flagged by future audit". This is that audit, and the fallback is now refused where it matters.
  //
  // The cookie this secret encrypts carries `state` and `pkceVerifier` — the two values that make
  // an authorization-code flow safe against CSRF and code interception. Encrypting them with a
  // constant published inside the package protects nothing from anyone who can read npm.
  //
  // `AuthSecretTooShortError` never caught it: the constant is 48 characters, and that guard checks
  // LENGTH, not provenance.
  //
  // Refused in production only. Blocking it everywhere would break every `pnpm dev`, and the risk
  // is a deployed app rather than a laptop. The branch above (`opts.session.secret`) stays for
  // callers who wire one, though `SessionManager` declares no such field today.
  if (process.env.NODE_ENV === "production") {
    throw new AuthConfigError(
      "missing_tx_secret",
      "No OAuth transaction secret is configured. Set THEOKIT_OAUTH_TX_SECRET to a 32+ character " +
        "random value — e.g. `openssl rand -hex 32`. Refusing to encrypt the transaction cookie " +
        "with the development fallback, which ships inside this package and protects nothing.",
    );
  }
  return "DEV_ONLY_INSECURE_OAUTH_TX_SECRET_REPLACE_IN_PROD";
}

function defineAuth<TSession>(opts: DefineAuthOptions<TSession>): AuthOrchestrator<TSession> {
  // Validate config at define-time (per blueprint Q5 invariants)
  if (!opts.session) {
    throw new AuthConfigError("missing_session", "defineAuth({ session }) is required");
  }

  const providersMap = new Map<string, AuthProvider<unknown, string>>();
  for (const provider of opts.providers ?? []) {
    if (!provider.name || !PROVIDER_NAME_RE.test(provider.name)) {
      throw new AuthConfigError(
        "invalid_provider_name",
        `Provider name must match ${PROVIDER_NAME_RE} (got: '${provider.name}')`,
      );
    }
    if (providersMap.has(provider.name)) {
      throw new AuthConfigError(
        "duplicate_provider_name",
        `Duplicate provider name: '${provider.name}'`,
      );
    }
    providersMap.set(provider.name, provider);
  }

  const txSecret = txCookieSecret(opts);

  function requireProvider(name: string): AuthProvider<unknown, string> {
    const p = providersMap.get(name);
    if (!p) throw new AuthProviderNotFoundError(name);
    return p;
  }

  async function startSignIn(
    providerName: string,
    req: IncomingMessage,
    startOpts?: { returnTo?: string },
  ): Promise<Response> {
    const provider = requireProvider(providerName);

    // EC-2 (v1.1) — validate returnTo same-origin
    const baseUrl = new URL(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`);
    const safeReturnTo = validateReturnTo(startOpts?.returnTo, baseUrl);

    // Generate transaction. Always include a PKCE verifier — PKCE-aware
    // providers (Google OIDC) consume it; PKCE-ignorant providers (GitHub
    // OAuth 2.0) discard it. Generating unconditionally simplifies the
    // provider contract: every tx is PKCE-ready.
    const state = randomState();
    const pkceVerifier = generatePkceVerifier();
    const tx = newTransaction({
      state,
      pkceVerifier,
      returnTo: safeReturnTo === "/" ? undefined : safeReturnTo,
    });

    // Persist transaction cookie via headers (since we return Response, need Set-Cookie header manually)
    const authUrl = await provider.createAuthorizationURL(tx);

    // Build response with Set-Cookie + redirect
    const headers = new Headers();
    headers.set("Location", authUrl.toString());
    const { encodeTransaction, COOKIE_NAME } = await import("./oauth-transaction-store.js");
    const encodedTx = await encodeTransaction(tx, txSecret);
    // COOKIE_NAME, never a literal: this header used to be written by hand as `theo_oauth_tx=`,
    // while the store reads the `__Host-` prefixed name — so `finishSignIn` never found the cookie
    // and every sign-in failed at the callback. One constant, one name.
    //
    // The `__Host-` prefix requires exactly what is set below: `Secure`, `Path=/`, and NO `Domain`.
    headers.set(
      "Set-Cookie",
      `${COOKIE_NAME}=${encodedTx}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    );

    return new Response(null, { status: 302, headers });
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: OAuth callback handler must validate 6 distinct error conditions sequentially (provider error / state / tx fetch / PKCE / code exchange / session) — extracting helpers fragments the linear control flow without clarifying intent (per EC-1 v1.1 absorbed)
  async function finishSignIn(
    providerName: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ session: TSession; returnTo?: string }> {
    const provider = requireProvider(providerName);

    // EC-1 (v1.1) — OAuth provider error response (user declined consent) check BEFORE code-exchange
    const url = new URL(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`);
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      const errorDescription = url.searchParams.get("error_description") ?? undefined;
      if (errorParam === "access_denied") {
        throw new AuthCancelledError(errorDescription);
      }
      throw new AuthCallbackError(
        "oauth_provider_error",
        `Provider returned error: ${errorParam}${errorDescription ? ` (${errorDescription})` : ""}`,
      );
    }

    // Read + validate transaction cookie
    const tx = await getTransaction(req, txSecret);
    if (!tx) {
      throw new AuthCallbackError(
        "oauth_transaction_expired",
        "OAuth transaction cookie missing or expired (>10min). Please retry sign-in.",
      );
    }

    // Verify state matches query param (CSRF defense per RFC 6749 §10.12)
    const queryState = url.searchParams.get("state");
    if (!queryState || queryState !== tx.state) {
      throw new AuthCallbackError(
        "oauth_state_mismatch",
        "OAuth state mismatch. Possible CSRF attempt or stale callback.",
      );
    }

    // Provider-specific callback handling (token exchange + userinfo fetch)
    const result = await provider.handleCallback(req, tx);

    // Invoke onSignIn callback if defined to derive session shape
    let sessionData: TSession;
    if (opts.onSignIn) {
      sessionData = await opts.onSignIn({ profile: result.profile, provider: result.providerName });
    } else {
      // No onSignIn — pass the raw profile as session (consumers must type their own TSession)
      sessionData = result.profile as unknown as TSession;
    }

    // EC-10 (v1.1) — OWASP A07:2021 session fixation mitigation: rotate session ID BEFORE creating new session
    try {
      await opts.session.rotateSession(req, res);
    } catch {
      // rotateSession may no-op if no pre-existing session — non-fatal
    }

    // Create session cookie
    await opts.session.createSession(res, sessionData);

    // Clear transaction cookie
    clearTransaction(res);

    return { session: sessionData, returnTo: tx.returnTo };
  }

  async function signIn<TProfile>(
    profile: TProfile,
    providerName: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<TSession> {
    // Path A escape hatch — skip OAuth flow, directly derive + persist session
    let sessionData: TSession;
    if (opts.onSignIn) {
      sessionData = await opts.onSignIn({ profile, provider: providerName });
    } else {
      sessionData = profile as unknown as TSession;
    }

    try {
      await opts.session.rotateSession(req, res);
    } catch {
      /* no-op if no pre-existing session */
    }

    await opts.session.createSession(res, sessionData);
    return sessionData;
  }

  async function signOut(res: ServerResponse): Promise<void> {
    // Read current session before destroying (so onSignOut can see it)
    let sessionData: TSession | null = null;
    if (opts.onSignOut) {
      // We don't have req here per AuthOrchestrator contract; onSignOut receives null
      // when no pre-existing session is available. Apps that need session-aware
      // signOut should use the manual session.destroySession + custom logic.
      sessionData = null;
    }

    opts.session.destroySession(res);

    if (opts.onSignOut) {
      await opts.onSignOut(sessionData);
    }
  }

  async function getSession(req: IncomingMessage): Promise<TSession | null> {
    return opts.session.getSession(req);
  }

  return { startSignIn, finishSignIn, signIn, signOut, getSession };
}

/** SE36 — `Auth.create` replaces `defineAuth` (ADR 0015). @public  *
 * `Auth.create` returns an **`AuthOrchestrator<TSession>`**, not an `Auth`. The class is
 * the namespace; the orchestrator is the product.
 */
export class Auth {
  private constructor() {}
  static create<TSession>(opts: DefineAuthOptions<TSession>): AuthOrchestrator<TSession> {
    return defineAuth(opts);
  }
}

/**
 * Test seam over {@link txCookieSecret}.
 *
 * Exported so the resolution order can be exercised through a CONFORMING `SessionManager` — the
 * point of the change that introduced `getCookieSecret`. Without a seam the only way to reach it is
 * a full `defineAuth` round trip, which is what let the previous version go untested through the
 * port and tested only through a cast.
 *
 * @internal
 */
export function _txCookieSecretForTests<TSession>(
  opts: Pick<DefineAuthOptions<TSession>, "session">,
): string {
  return txCookieSecret(opts as DefineAuthOptions<TSession>);
}
