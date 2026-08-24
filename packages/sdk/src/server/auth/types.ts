/**
 * Orchestrator types (Path C Hybrid per G11) — `@theokit/sdk/server/auth`.
 *
 * Plan: g11-auth-architecture-implementation v1.4 (sha256 4d381020...)
 * Blueprint: g11-auth-architecture-decision v1.1 (SHIPPABLE 97.9)
 * AUTH-DELEGATION lock (theokit/CLAUDE.md:217-225) — these types are the
 * orchestrator contract; concrete OAuth/email providers ship in opt-in
 * @theokit/auth-* packages (adapters layer per ADR D11).
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * SessionManager contract (matches theokit/packages/theo/src/server/auth/session.ts:49).
 * Imported as type-only — runtime depends via peerDep `theokit@>=0.2.4`.
 */
export interface SessionManager<TSession> {
  getSession(req: IncomingMessage): Promise<TSession | null>;
  createSession(res: ServerResponse, data: TSession): Promise<void>;
  destroySession(res: ServerResponse): void;
  rotateSession(req: IncomingMessage, res: ServerResponse): Promise<TSession | null>;
}

/**
 * Per ADR D5 — OAuth transaction state stored in encrypted HttpOnly cookie
 * (cookie-state pattern). Expires within 10 minutes per invariant.
 */
export interface OAuthTransaction {
  state: string;
  pkceVerifier?: string;
  returnTo?: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Per ADR D9 — provider profile types are provider-specific (not unified).
 * Each @theokit/auth-* package exports its own profile shape.
 * Generic param TProfile lets consumers narrow via discriminated unions on providerName.
 */
export interface AuthResult<TProfile, TName extends string = string> {
  profile: TProfile;
  providerName: TName;
  rawTokens?: {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt?: number;
  };
}

/**
 * Provider contract — each @theokit/auth-* package implements this.
 * Per blueprint Q5 + ADR D11 (adapters layer).
 */
export interface AuthProvider<TProfile, TName extends string = string> {
  name: TName;
  createAuthorizationURL(tx: OAuthTransaction): URL | Promise<URL>;
  handleCallback(req: IncomingMessage, tx: OAuthTransaction): Promise<AuthResult<TProfile, TName>>;
}

/**
 * `defineAuth(opts)` configuration shape — Path C (Hybrid).
 * `providers` optional: empty = Path A escape hatch (manual signIn only).
 * `onSignIn` invoked after provider callback success; returns TSession to persist.
 */
export interface DefineAuthOptions<TSession> {
  session: SessionManager<TSession>;
  providers?: AuthProvider<unknown, string>[];
  onSignIn?: <TProfile>(args: { profile: TProfile; provider: string }) => Promise<TSession>;
  onSignOut?: (session: TSession | null) => Promise<void> | void;
}

/**
 * Returned by `defineAuth<TSession>(opts)` — 5-method orchestrator surface.
 *
 * - startSignIn: returns Response.redirect to provider authorization URL with state cookie
 * - finishSignIn: handles provider callback; verifies state; calls onSignIn; rotates session ID
 *   (OWASP A07:2021 per EC-10); creates session cookie; clears transaction cookie
 * - signIn: Path A escape hatch — skip OAuth flow; directly persist session from external profile
 * - signOut: destroys session cookie + invokes onSignOut callback
 * - getSession: read-only passthrough to session.getSession
 */
export interface AuthOrchestrator<TSession> {
  startSignIn(
    providerName: string,
    req: IncomingMessage,
    opts?: { returnTo?: string },
  ): Promise<Response>;
  finishSignIn(
    providerName: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ session: TSession; returnTo?: string }>;
  signIn<TProfile>(
    profile: TProfile,
    providerName: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<TSession>;
  signOut(res: ServerResponse): void | Promise<void>;
  getSession(req: IncomingMessage): Promise<TSession | null>;
}
