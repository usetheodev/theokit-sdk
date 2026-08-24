import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CredentialStoreConfig,
  DeviceDeps,
  DeviceOAuthConfig,
  HttpDeps,
  OAuthProviderConfig,
  OpenAIDeviceConfig,
  ResolvedCredential,
} from "../../../src/internal/auth/auth-types.js";
import { writeCredential } from "../../../src/internal/auth/credential-store.js";
import {
  extractAccountId,
  openaiDeviceLogin,
  pollDeviceToken,
} from "../../../src/internal/auth/oauth-device.js";
import {
  ensureFreshCredential,
  exchangeCode,
  refreshOAuthTokens,
} from "../../../src/internal/auth/oauth-engine.js";
import { AuthCallbackError } from "../../../src/server/auth/errors.js";

/**
 * M42 — ported from agent-builder `oauth.test.ts` + `oauth-device.test.ts`. Injected fake fetch + fixed
 * clock; real tmp-dir fs for the store (so the 0600 + refresh-persist invariants hit a real filesystem).
 */

const roots: string[] = [];
const FIXED_NOW = 1_000_000_000_000;

function newStore(): CredentialStoreConfig {
  const home = mkdtempSync(join(tmpdir(), "oauth-eng-"));
  roots.push(home);
  return { home, dirName: ".theo-auth", fileName: "auth.json" };
}

const config: OAuthProviderConfig = {
  provider: "openai",
  authorizeEndpoint: "https://auth.test/authorize",
  tokenEndpoint: "https://auth.test/token",
  clientId: "cid-1",
  scopes: ["openid"],
  redirectUri: "https://app.test/cb",
};

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

afterEach(() => {
  for (const r of roots.splice(0)) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  vi.restoreAllMocks();
});

describe("oauth-engine — exchange / refresh", () => {
  it("exchangeCode POSTs an authorization_code grant carrying the PKCE verifier", async () => {
    let sentBody = "";
    const deps: HttpDeps = {
      now: () => FIXED_NOW,
      fetch: (async (_url: string, init?: { body?: string }) => {
        sentBody = init?.body ?? "";
        return okJson({ access_token: "acc", refresh_token: "ref", expires_in: 3600 });
      }) as unknown as typeof fetch,
    };
    const tokens = await exchangeCode(config, { code: "CODE", verifier: "VER" }, deps);
    expect(sentBody).toContain("grant_type=authorization_code");
    expect(sentBody).toContain("code_verifier=VER");
    expect(tokens.expires).toBe(FIXED_NOW + 3600 * 1000);
  });

  it("refreshOAuthTokens POSTs a refresh_token grant", async () => {
    let sentBody = "";
    const deps: HttpDeps = {
      now: () => FIXED_NOW,
      fetch: (async (_url: string, init?: { body?: string }) => {
        sentBody = init?.body ?? "";
        return okJson({ access_token: "a2", refresh_token: "r2", expires_in: 60 });
      }) as unknown as typeof fetch,
    };
    await refreshOAuthTokens(config, "OLD-REFRESH", deps);
    expect(sentBody).toContain("grant_type=refresh_token");
    expect(sentBody).toContain("refresh_token=OLD-REFRESH");
  });

  it("a non-200 exchange throws a typed error and does NOT echo the body (no token leak)", async () => {
    const deps: HttpDeps = {
      now: () => FIXED_NOW,
      fetch: (async () =>
        new Response("LEAK-TOKEN-abc", { status: 400 })) as unknown as typeof fetch,
    };
    await expect(exchangeCode(config, { code: "c", verifier: "v" }, deps)).rejects.toThrow(
      /HTTP 400/,
    );
    await expect(exchangeCode(config, { code: "c", verifier: "v" }, deps)).rejects.not.toThrow(
      /LEAK-TOKEN/,
    );
  });

  it("a 200 non-JSON body throws 'not valid JSON' without echoing the token", async () => {
    const deps: HttpDeps = {
      now: () => FIXED_NOW,
      fetch: (async () =>
        new Response("LEAK-TOKEN-xyz not-json", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })) as unknown as typeof fetch,
    };
    await expect(exchangeCode(config, { code: "c", verifier: "v" }, deps)).rejects.toThrow(
      /not valid JSON/,
    );
    await expect(exchangeCode(config, { code: "c", verifier: "v" }, deps)).rejects.not.toThrow(
      /LEAK-TOKEN/,
    );
  });
});

describe("oauth-engine — ensureFreshCredential (skew / refresh / coalescing)", () => {
  function oauthCred(expiresAt: number): ResolvedCredential {
    return {
      kind: "oauth",
      provider: "openai",
      apiKey: "OLD-ACCESS",
      source: "test",
      inferred: false,
      expiresAt,
    };
  }

  it("passes an api credential through by identity — no network", async () => {
    const store = newStore();
    const api: ResolvedCredential = {
      kind: "api",
      provider: "openai",
      apiKey: "sk-x",
      source: "env",
      inferred: false,
    };
    const spy = vi.fn();
    const out = await ensureFreshCredential(
      api,
      { config, store },
      { now: () => FIXED_NOW, fetch: spy as unknown as typeof fetch },
    );
    expect(out).toBe(api);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does NOT refresh a token still valid beyond the skew window", async () => {
    const store = newStore();
    const spy = vi.fn();
    const cred = oauthCred(FIXED_NOW + 3600 * 1000);
    const out = await ensureFreshCredential(
      cred,
      { config, store },
      { now: () => FIXED_NOW, fetch: spy as unknown as typeof fetch },
    );
    expect(out.apiKey).toBe("OLD-ACCESS");
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and re-persists it at 0600", async () => {
    const store = newStore();
    writeCredential(
      {
        type: "oauth",
        provider: "openai",
        access: "OLD-ACCESS",
        refresh: "OLD-REFRESH",
        expires: FIXED_NOW,
      },
      store,
    );
    const deps: HttpDeps = {
      now: () => FIXED_NOW,
      fetch: (async () =>
        okJson({
          access_token: "NEW",
          refresh_token: "NEW-REF",
          expires_in: 3600,
        })) as unknown as typeof fetch,
    };
    const out = await ensureFreshCredential(oauthCred(FIXED_NOW), { config, store }, deps);
    expect(out.apiKey).toBe("NEW");
    const path = join(store.home, store.dirName, store.fileName);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("coalesces two concurrent refreshes into ONE exchange; both get the same fresh token", async () => {
    const store = newStore();
    writeCredential(
      { type: "oauth", provider: "openai", access: "OLD", refresh: "OLD-REF", expires: FIXED_NOW },
      store,
    );
    let posts = 0;
    const deps: HttpDeps = {
      now: () => FIXED_NOW,
      fetch: (async () => {
        posts++;
        await new Promise((r) => setTimeout(r, 5));
        return okJson({ access_token: "NEW", refresh_token: "NEW-REF", expires_in: 3600 });
      }) as unknown as typeof fetch,
    };
    const [a, b] = await Promise.all([
      ensureFreshCredential(oauthCred(FIXED_NOW), { config, store }, deps),
      ensureFreshCredential(oauthCred(FIXED_NOW), { config, store }, deps),
    ]);
    expect(posts).toBe(1);
    expect(a.apiKey).toBe("NEW");
    expect(b.apiKey).toBe("NEW");
  });

  it("does NOT cache a rejected refresh — a retry re-attempts the network and succeeds", async () => {
    const store = newStore();
    writeCredential(
      { type: "oauth", provider: "openai", access: "OLD", refresh: "OLD-REF", expires: FIXED_NOW },
      store,
    );
    let call = 0;
    const deps: HttpDeps = {
      now: () => FIXED_NOW,
      fetch: (async () => {
        call++;
        if (call === 1) return new Response("boom", { status: 500 });
        return okJson({ access_token: "AFTER", refresh_token: "r", expires_in: 3600 });
      }) as unknown as typeof fetch,
    };
    // B-079 — was bare `.rejects.toThrow()`. `postGrant` throws the typed
    // `AuthCallbackError` (oauth-engine.ts:80) on a non-ok token response,
    // with a fixed code (`oauth_token_exchange_failed`, shared by every
    // failure in this function) and a message that names the actual status.
    // ONE call only — the test's own `call === 2` assertion below depends on
    // exactly one failed + one successful fetch.
    let rejectedWith: unknown;
    await ensureFreshCredential(oauthCred(FIXED_NOW), { config, store }, deps).catch((err) => {
      rejectedWith = err;
    });
    expect(rejectedWith).toBeInstanceOf(AuthCallbackError);
    expect((rejectedWith as { code?: string }).code).toBe("oauth_token_exchange_failed");
    expect((rejectedWith as Error).message).toContain("HTTP 500");

    const out = await ensureFreshCredential(oauthCred(FIXED_NOW), { config, store }, deps);
    expect(out.apiKey).toBe("AFTER");
    expect(call).toBe(2);
  });

  it("never prints the token to stdout/stderr across exchange + persist + refresh", async () => {
    const store = newStore();
    const outSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    writeCredential(
      {
        type: "oauth",
        provider: "openai",
        access: "SECRET-ACCESS",
        refresh: "SECRET-REFRESH",
        expires: FIXED_NOW,
      },
      store,
    );
    const deps: HttpDeps = {
      now: () => FIXED_NOW,
      fetch: (async () =>
        okJson({
          access_token: "SECRET-ACCESS",
          refresh_token: "SECRET-REFRESH",
          expires_in: 3600,
        })) as unknown as typeof fetch,
    };
    await ensureFreshCredential(oauthCred(FIXED_NOW), { config, store }, deps);
    const captured =
      outSpy.mock.calls.map((c) => String(c[0])).join("") +
      errSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(captured).not.toContain("SECRET-ACCESS");
    expect(captured).not.toContain("SECRET-REFRESH");
  });
});

describe("oauth-device — RFC 8628 + OpenAI two-step + JWT", () => {
  const deviceConfig: DeviceOAuthConfig = {
    ...config,
    deviceCodeEndpoint: "https://auth.test/device",
  };

  it("pollDeviceToken waits through authorization_pending then returns tokens", async () => {
    const responses = [
      new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 }),
      new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 }),
      okJson({ access_token: "acc", expires_in: 3600 }),
    ];
    let i = 0;
    const deps: DeviceDeps = {
      now: () => FIXED_NOW,
      sleep: async () => {},
      fetch: (async () => responses[i++]!) as unknown as typeof fetch,
    };
    const grant = {
      deviceCode: "dc",
      userCode: "UC",
      verificationUri: "u",
      interval: 1,
      expiresIn: 900,
    };
    const tokens = await pollDeviceToken(deviceConfig, grant, deps);
    expect(tokens.access).toBe("acc");
  });

  it("pollDeviceToken honors slow_down then succeeds", async () => {
    const responses = [
      new Response(JSON.stringify({ error: "slow_down" }), { status: 400 }),
      okJson({ access_token: "acc2", expires_in: 3600 }),
    ];
    let i = 0;
    const deps: DeviceDeps = {
      now: () => FIXED_NOW,
      sleep: async () => {},
      fetch: (async () => responses[i++]!) as unknown as typeof fetch,
    };
    const grant = {
      deviceCode: "dc",
      userCode: "UC",
      verificationUri: "u",
      interval: 1,
      expiresIn: 900,
    };
    const tokens = await pollDeviceToken(deviceConfig, grant, deps);
    expect(tokens.access).toBe("acc2");
  });

  it("pollDeviceToken throws oauth_device_code_expired when expiresIn is 0", async () => {
    const deps: DeviceDeps = {
      now: () => FIXED_NOW,
      sleep: async () => {},
      fetch: (async () => okJson({ error: "authorization_pending" })) as unknown as typeof fetch,
    };
    const grant = {
      deviceCode: "dc",
      userCode: "UC",
      verificationUri: "u",
      interval: 1,
      expiresIn: 0,
    };
    await expect(pollDeviceToken(deviceConfig, grant, deps)).rejects.toThrow(/device code expired/);
  });

  it("openaiDeviceLogin: 403 pending → authorization code → token exchange", async () => {
    const oaConfig: OpenAIDeviceConfig = {
      ...config,
      deviceUsercodeEndpoint: "https://auth.test/usercode",
      devicePollEndpoint: "https://auth.test/poll",
      verificationUri: "https://auth.test/verify",
    };
    const responses = [
      okJson({ device_auth_id: "d1", user_code: "UC", interval: 1 }), // user code
      new Response("pending", { status: 403 }), // poll pending
      okJson({ authorization_code: "AC", code_verifier: "CV" }), // poll ready
      okJson({ access_token: "final-acc", refresh_token: "final-ref", expires_in: 3600 }), // exchange
    ];
    let i = 0;
    const deps: DeviceDeps = {
      now: () => FIXED_NOW,
      sleep: async () => {},
      fetch: (async () => responses[i++]!) as unknown as typeof fetch,
    };
    const tokens = await openaiDeviceLogin(oaConfig, deps, { onPrompt: () => {} });
    expect(tokens.access).toBe("final-acc");
  });

  it("extractAccountId reads chatgpt_account_id from a base64url id_token", () => {
    const id = extractAccountId({ id_token: jwt({ chatgpt_account_id: "acct-123" }) });
    expect(id).toBe("acct-123");
    expect(extractAccountId({ access_token: "not-a-jwt" })).toBeUndefined();
  });
});
