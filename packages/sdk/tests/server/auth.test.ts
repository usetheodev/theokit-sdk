/**
 * T1.2 critical tests — `@theokit/sdk/server/auth`.
 *
 * Covers MUST FIX edge cases from plan v1.4:
 *   - EC-1: AuthCancelledError on ?error=access_denied
 *   - EC-2: validateReturnTo same-origin check
 *   - EC-10: rotateSession on login (OWASP A07:2021)
 * Plus core happy-path + provider not found + state mismatch.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { AuthProvider, SessionManager } from "../../src/server/auth/index.js";
import {
  Auth,
  AuthCallbackError,
  AuthCancelledError,
  AuthConfigError,
  AuthProviderNotFoundError,
  validateReturnTo,
} from "../../src/server/auth/index.js";

interface MockSessionState<T> {
  rotated: boolean;
  created: T | null;
  destroyed: boolean;
  secret: string;
}

function mockSession<T>(): SessionManager<T> & { _state: MockSessionState<T> } {
  const state: MockSessionState<T> = {
    rotated: false,
    created: null,
    destroyed: false,
    // T5.1 — secret MUST be ≥ 32 bytes (HKDF-SHA256 minimum entropy
    // requirement); the pre-T5.1 31-byte value was silently zero-padded.
    secret: "test-secret-32-chars-abcdefghijK",
  };
  return {
    async getSession(): Promise<T | null> {
      return state.created;
    },
    async createSession(_res: ServerResponse, data: T): Promise<void> {
      state.created = data;
    },
    destroySession(): void {
      state.destroyed = true;
    },
    async rotateSession(): Promise<T | null> {
      state.rotated = true;
      return state.created;
    },
    // Through the PORT. This was a bare `secret: state.secret` field with the comment "include
    // secret prop so orchestrator txCookieSecret() finds it" — the double shaped to fit a cast the
    // orchestrator was making past its own contract, rather than the contract declaring the member.
    // `SessionManager.getCookieSecret?()` exists now, so this conforms instead of compensating.
    getCookieSecret(): string {
      return state.secret;
    },
    _state: state,
  } as unknown as SessionManager<T> & { _state: MockSessionState<T> };
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

describe("Auth.create() — config validation", () => {
  it("throws AuthConfigError when session missing", () => {
    expect(() => Auth.create({} as never)).toThrow(AuthConfigError);
  });

  it("throws AuthConfigError on duplicate provider name", () => {
    const session = mockSession<{ userId: string }>();
    const google1 = mockProvider("google", { id: "1" });
    const google2 = mockProvider("google", { id: "2" });
    expect(() => Auth.create({ session, providers: [google1, google2] })).toThrow(
      /duplicate_provider_name/,
    );
  });

  it("throws AuthConfigError on invalid provider name grammar", () => {
    const session = mockSession<{ userId: string }>();
    const bad = mockProvider("Google!", { id: "1" });
    expect(() => Auth.create({ session, providers: [bad] })).toThrow(/invalid_provider_name/);
  });

  it("accepts empty providers (Path A escape hatch)", () => {
    const session = mockSession<{ userId: string }>();
    expect(() => Auth.create({ session })).not.toThrow();
  });
});

describe("startSignIn — unknown provider", () => {
  it("throws AuthProviderNotFoundError when provider name unregistered", async () => {
    const session = mockSession<{ userId: string }>();
    const auth = Auth.create({ session });
    await expect(auth.startSignIn("unknown", mockReq())).rejects.toThrow(AuthProviderNotFoundError);
  });
});

describe("EC-1 (v1.1) — OAuth provider error response", () => {
  it("throws AuthCancelledError on ?error=access_denied", async () => {
    const session = mockSession<{ userId: string }>();
    const google = mockProvider("google", { id: "1" });
    const auth = Auth.create({ session, providers: [google] });

    const req = mockReq({
      url: "/api/auth/google/callback?error=access_denied&error_description=User+denied",
    });
    const res = mockRes();

    await expect(auth.finishSignIn("google", req, res)).rejects.toThrow(AuthCancelledError);
  });

  it("throws AuthCallbackError on non-access_denied error", async () => {
    const session = mockSession<{ userId: string }>();
    const google = mockProvider("google", { id: "1" });
    const auth = Auth.create({ session, providers: [google] });

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

    const auth = Auth.create({
      session,
      providers: [google],
      onSignIn: async ({ profile }) => ({ userId: (profile as { sub: string }).sub }),
    });

    // Need valid transaction cookie + matching state in URL
    const { encodeTransaction, newTransaction } = await import(
      "../../src/server/auth/oauth-transaction-store.js"
    );
    const tx = newTransaction({ state: "test-state-12345" });
    const cookieValue = await encodeTransaction(tx, session._state.secret);

    const req = mockReq({
      url: "/api/auth/google/callback?code=test-code&state=test-state-12345",
      // T5.3 — cookie now uses the `__Host-` prefix per RFC 6265bis
      // (browser-enforced contract: Secure + Path=/ + no Domain).
      cookie: `__Host-theo_oauth_tx=${cookieValue}`,
    });
    const res = mockRes();

    const result = await auth.finishSignIn("google", req, res);

    expect(session._state.rotated).toBe(true);
    expect(session._state.created).toEqual({ userId: "google-user-123" });
    expect(result.session).toEqual({ userId: "google-user-123" });
  });
});

describe("signIn — Path A escape hatch", () => {
  it("creates session directly from profile without OAuth flow", async () => {
    const session = mockSession<{ userId: string }>();
    const auth = Auth.create({
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
    const auth = Auth.create({ session, providers: [google] });

    const req = mockReq({ url: "/api/auth/google/callback?code=x&state=y" });
    const res = mockRes();

    await expect(auth.finishSignIn("google", req, res)).rejects.toMatchObject({
      name: "AuthCallbackError",
      code: "oauth_transaction_expired",
    });
  });
});

describe("the transaction-cookie secret comes through the SessionManager port", () => {
  /**
   * `txCookieSecret` read `opts.session as unknown as { secret?: string | string[] }`. The
   * `as unknown as` is the tell: TypeScript would have refused the property access, so the code
   * asserted a shape `SessionManager` does not declare. No conforming caller could reach that branch
   * — a grep of `src/` for anything supplying `session.secret` returned nothing — and it was green
   * only because the mock above carried the field, with a comment saying it existed to satisfy the
   * cast.
   *
   * `SessionManager.getCookieSecret?()` is declared now, so these use a manager that satisfies the
   * INTERFACE with no cast at all. That is the difference: the double conforms to the contract
   * instead of the code conforming to the double.
   */
  function managerWith(secret: string | string[] | undefined): SessionManager<{ id: string }> {
    return {
      async getSession() {
        return null;
      },
      async createSession() {},
      destroySession() {},
      async rotateSession() {
        return null;
      },
      getCookieSecret: () => secret,
    };
  }

  it("a manager that offers a secret supplies it", async () => {
    const { _txCookieSecretForTests } = await import("../../src/server/auth/orchestrator.js");
    expect(
      _txCookieSecretForTests({ session: managerWith("manager-secret-32-chars-abcdefghijK") }),
    ).toBe("manager-secret-32-chars-abcdefghijK");
  });

  it("a rotation array encrypts with the first entry", async () => {
    const { _txCookieSecretForTests } = await import("../../src/server/auth/orchestrator.js");
    expect(
      _txCookieSecretForTests({
        session: managerWith(["newest-secret-32-chars-abcdefghijK", "older-one"]),
      }),
    ).toBe("newest-secret-32-chars-abcdefghijK");
  });

  it("a manager without the optional member falls through to the environment", async () => {
    const { _txCookieSecretForTests } = await import("../../src/server/auth/orchestrator.js");
    const previous = process.env.THEOKIT_OAUTH_TX_SECRET;
    process.env.THEOKIT_OAUTH_TX_SECRET = "env-secret-32-chars-abcdefghijKLM";
    try {
      // `getCookieSecret` is optional; a manager predating it is still a conforming manager.
      expect(_txCookieSecretForTests({ session: managerWith(undefined) })).toBe(
        "env-secret-32-chars-abcdefghijKLM",
      );
    } finally {
      if (previous === undefined) delete process.env.THEOKIT_OAUTH_TX_SECRET;
      else process.env.THEOKIT_OAUTH_TX_SECRET = previous;
    }
  });
});
