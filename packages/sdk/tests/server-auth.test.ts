/**
 * @theokit/sdk/server/auth — T1.2 critical tests
 *
 * Covers MUST FIX edge cases from plan v1.4:
 *   - EC-1: AuthCancelledError on ?error=access_denied
 *   - EC-2: validateReturnTo same-origin check
 *   - EC-10: rotateSession on login (OWASP A07:2021)
 * Plus core happy-path + provider not found + state mismatch.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { AuthProvider, SessionManager } from "../src/server/auth/index.js";
import {
  AuthCallbackError,
  AuthCancelledError,
  AuthConfigError,
  AuthProviderNotFoundError,
  defineAuth,
  validateReturnTo,
} from "../src/server/auth/index.js";

function mockSession<T>(): SessionManager<T> & {
  _state: { rotated: boolean; created: T | null; destroyed: boolean };
} {
  const state = {
    rotated: false,
    created: null as T | null,
    destroyed: false,
    secret: "test-secret-32-chars-abcdefghij",
  };
  return {
    async getSession() {
      return state.created;
    },
    async createSession(_res, data) {
      state.created = data;
    },
    destroySession() {
      state.destroyed = true;
    },
    async rotateSession() {
      state.rotated = true;
      return state.created;
    },
    _state: state,
    // include secret prop so orchestrator txCookieSecret() finds it
    secret: state.secret,
  } as unknown as SessionManager<T> & { _state: typeof state };
}

function mockProvider<TProfile>(name: string, profile: TProfile): AuthProvider<TProfile, string> {
  return {
    name,
    async createAuthorizationURL() {
      return new URL(`https://example-provider.com/oauth/authorize?provider=${name}`);
    },
    async handleCallback() {
      return { profile, providerName: name };
    },
  };
}

function mockReq(opts: { url?: string; cookie?: string } = {}): IncomingMessage {
  return {
    url: opts.url ?? "/api/auth/google/callback",
    headers: {
      host: "myapp.com",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
  } as unknown as IncomingMessage;
}

function mockRes(): ServerResponse & { _headers: Record<string, string | string[]> } {
  const headers: Record<string, string | string[]> = {};
  return {
    setHeader(name: string, value: string | string[]) {
      headers[name] = value;
    },
    getHeader(name: string) {
      return headers[name];
    },
    _headers: headers,
  } as unknown as ServerResponse & { _headers: Record<string, string | string[]> };
}

describe("defineAuth() — config validation", () => {
  it("throws AuthConfigError when session missing", () => {
    expect(() => defineAuth({} as never)).toThrow(AuthConfigError);
  });

  it("throws AuthConfigError on duplicate provider name", () => {
    const session = mockSession<{ userId: string }>();
    const google1 = mockProvider("google", { id: "1" });
    const google2 = mockProvider("google", { id: "2" });
    expect(() => defineAuth({ session, providers: [google1, google2] })).toThrow(
      /duplicate_provider_name/,
    );
  });

  it("throws AuthConfigError on invalid provider name grammar", () => {
    const session = mockSession<{ userId: string }>();
    const bad = mockProvider("Google!", { id: "1" });
    expect(() => defineAuth({ session, providers: [bad] })).toThrow(/invalid_provider_name/);
  });

  it("accepts empty providers (Caminho A escape hatch)", () => {
    const session = mockSession<{ userId: string }>();
    expect(() => defineAuth({ session })).not.toThrow();
  });
});

describe("startSignIn — unknown provider", () => {
  it("throws AuthProviderNotFoundError when provider name unregistered", async () => {
    const session = mockSession<{ userId: string }>();
    const auth = defineAuth({ session });
    await expect(auth.startSignIn("unknown", mockReq())).rejects.toThrow(AuthProviderNotFoundError);
  });
});

describe("EC-1 (v1.1) — OAuth provider error response", () => {
  it("throws AuthCancelledError on ?error=access_denied", async () => {
    const session = mockSession<{ userId: string }>();
    const google = mockProvider("google", { id: "1" });
    const auth = defineAuth({ session, providers: [google] });

    const req = mockReq({
      url: "/api/auth/google/callback?error=access_denied&error_description=User+denied",
    });
    const res = mockRes();

    await expect(auth.finishSignIn("google", req, res)).rejects.toThrow(AuthCancelledError);
  });

  it("throws AuthCallbackError on non-access_denied error", async () => {
    const session = mockSession<{ userId: string }>();
    const google = mockProvider("google", { id: "1" });
    const auth = defineAuth({ session, providers: [google] });

    const req = mockReq({
      url: "/api/auth/google/callback?error=server_error",
    });
    const res = mockRes();

    await expect(auth.finishSignIn("google", req, res)).rejects.toThrow(AuthCallbackError);
  });
});

describe("EC-2 (v1.1) — validateReturnTo same-origin", () => {
  const base = new URL("https://myapp.com/login");

  it("returns default '/' for undefined/empty", () => {
    expect(validateReturnTo(undefined, base)).toBe("/");
    expect(validateReturnTo("", base)).toBe("/");
    expect(validateReturnTo("   ", base)).toBe("/");
  });

  it("rejects protocol-relative URLs", () => {
    expect(validateReturnTo("//evil.com/path", base)).toBe("/");
  });

  it("rejects cross-origin absolute URLs", () => {
    expect(validateReturnTo("https://evil.com/path", base)).toBe("/");
    expect(validateReturnTo("https://attacker.example/page", base)).toBe("/");
  });

  it("accepts same-origin absolute URLs (returns pathname)", () => {
    expect(validateReturnTo("https://myapp.com/dashboard", base)).toBe("/dashboard");
    expect(validateReturnTo("https://myapp.com/profile?tab=settings", base)).toBe(
      "/profile?tab=settings",
    );
  });

  it("accepts relative paths starting with /", () => {
    expect(validateReturnTo("/dashboard", base)).toBe("/dashboard");
    expect(validateReturnTo("/items?id=42", base)).toBe("/items?id=42");
  });

  it("rejects bare strings (non-path)", () => {
    expect(validateReturnTo("dashboard", base)).toBe("/");
    expect(validateReturnTo("javascript:alert(1)", base)).toBe("/");
  });
});

describe("EC-10 (v1.1) — rotateSession on login (OWASP A07:2021)", () => {
  it("calls session.rotateSession before createSession during finishSignIn happy path", async () => {
    const session = mockSession<{ userId: string }>();
    const google = mockProvider("google", { sub: "google-user-123" });

    const auth = defineAuth({
      session,
      providers: [google],
      onSignIn: async ({ profile }) => ({ userId: (profile as { sub: string }).sub }),
    });

    // Need valid transaction cookie + matching state in URL
    const { encodeTransaction, newTransaction } = await import(
      "../src/server/auth/oauth-transaction-store.js"
    );
    const tx = newTransaction({ state: "test-state-12345" });
    const cookieValue = await encodeTransaction(tx, session._state.secret);

    const req = mockReq({
      url: "/api/auth/google/callback?code=test-code&state=test-state-12345",
      cookie: `theo_oauth_tx=${cookieValue}`,
    });
    const res = mockRes();

    const result = await auth.finishSignIn("google", req, res);

    expect(session._state.rotated).toBe(true);
    expect(session._state.created).toEqual({ userId: "google-user-123" });
    expect(result.session).toEqual({ userId: "google-user-123" });
  });
});

describe("signIn — Caminho A escape hatch", () => {
  it("creates session directly from profile without OAuth flow", async () => {
    const session = mockSession<{ userId: string }>();
    const auth = defineAuth({
      session,
      onSignIn: async ({ profile }) => ({ userId: (profile as { sub: string }).sub }),
    });

    const req = mockReq();
    const res = mockRes();
    const result = await auth.signIn({ sub: "external-user" }, "external", req, res);

    expect(result).toEqual({ userId: "external-user" });
    expect(session._state.created).toEqual({ userId: "external-user" });
  });
});

describe("finishSignIn — state mismatch + expired tx", () => {
  it("throws AuthCallbackError on missing transaction cookie", async () => {
    const session = mockSession<{ userId: string }>();
    const google = mockProvider("google", { id: "1" });
    const auth = defineAuth({ session, providers: [google] });

    const req = mockReq({ url: "/api/auth/google/callback?code=x&state=y" });
    const res = mockRes();

    await expect(auth.finishSignIn("google", req, res)).rejects.toMatchObject({
      name: "AuthCallbackError",
      code: "oauth_transaction_expired",
    });
  });
});
