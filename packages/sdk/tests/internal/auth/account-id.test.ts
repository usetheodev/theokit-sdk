import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { readStoredOAuth, writeCredential } from "../../../src/internal/auth/credential-store.js";
import { openaiDeviceLogin } from "../../../src/internal/auth/oauth-device.js";
import { ensureFreshCredential } from "../../../src/internal/auth/oauth-engine.js";
import type {
  CredentialStoreConfig,
  HttpDeps,
  OAuthProviderConfig,
  ResolvedCredential,
} from "../../../src/internal/auth/types.js";

/**
 * M43 — the account_id lifecycle (ADR D4). account_id is the ChatGPT-Account-Id the Codex backend requires
 * per-request; it MUST survive refresh (OpenAI's refresh JWT has no top-level account_id) and be captured at
 * login (the two-step exchange returns a JWT). Both fixes: prefer freshly-derived, else preserve stored.
 */

const roots: string[] = [];
const NOW = 1_000_000_000_000;

function newStore(): CredentialStoreConfig {
  const home = mkdtempSync(join(tmpdir(), "acct-id-"));
  roots.push(home);
  return { home, dirName: ".theo-auth", fileName: "auth.json" };
}

const config: OAuthProviderConfig = {
  provider: "openai",
  authorizeEndpoint: "https://auth.test/authorize",
  tokenEndpoint: "https://auth.test/token",
  clientId: "cid",
  scopes: ["openid"],
  redirectUri: "https://app.test/cb",
};

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const expiredCred: ResolvedCredential = {
  kind: "oauth",
  provider: "openai",
  apiKey: "OLD",
  source: "test",
  inferred: false,
  expiresAt: NOW,
};

afterEach(() => {
  for (const r of roots.splice(0)) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("account_id lifecycle (M43 D4)", () => {
  it("refresh PRESERVES a stored account_id when the refresh response omits it (fix #1)", async () => {
    const store = newStore();
    writeCredential(
      {
        type: "oauth",
        provider: "openai",
        access: "OLD",
        refresh: "OLD-REF",
        expires: NOW,
        account_id: "acct-STABLE",
      },
      store,
    );
    const deps: HttpDeps = {
      now: () => NOW,
      // refresh response has NO account_id (OpenAI returns JWTs, not a top-level account_id)
      fetch: (async () =>
        okJson({
          access_token: "NEW",
          refresh_token: "NEW-REF",
          expires_in: 3600,
        })) as unknown as typeof fetch,
    };
    await ensureFreshCredential(expiredCred, { config, store }, deps);
    const stored = readStoredOAuth(store);
    expect(stored?.access).toBe("NEW"); // refreshed
    expect(stored?.account_id).toBe("acct-STABLE"); // PRESERVED (was wiped before the fix)
  });

  it("refresh PREFERS a fresh account_id when the refresh response carries one", async () => {
    const store = newStore();
    writeCredential(
      {
        type: "oauth",
        provider: "openai",
        access: "OLD",
        refresh: "OLD-REF",
        expires: NOW,
        account_id: "old-acct",
      },
      store,
    );
    const deps: HttpDeps = {
      now: () => NOW,
      fetch: (async () =>
        okJson({
          access_token: "NEW",
          refresh_token: "NEW-REF",
          expires_in: 3600,
          account_id: "fresh-acct",
        })) as unknown as typeof fetch,
    };
    await ensureFreshCredential(expiredCred, { config, store }, deps);
    expect(readStoredOAuth(store)?.account_id).toBe("fresh-acct");
  });

  it("openaiDeviceLogin extracts account_id from the exchanged access-token JWT (fix #2)", async () => {
    const oaConfig = {
      ...config,
      deviceUsercodeEndpoint: "https://auth.test/usercode",
      devicePollEndpoint: "https://auth.test/poll",
      verificationUri: "https://auth.test/verify",
    };
    const access = jwt({ chatgpt_account_id: "acct-from-jwt" });
    const responses = [
      okJson({ device_auth_id: "d1", user_code: "UC", interval: 1 }),
      okJson({ authorization_code: "AC", code_verifier: "CV" }),
      // exchange response: access is a JWT with chatgpt_account_id, NO top-level account_id
      okJson({ access_token: access, refresh_token: "r", expires_in: 3600 }),
    ];
    let i = 0;
    const deps = {
      now: () => NOW,
      sleep: async () => {},
      fetch: (async () => responses[i++]!) as unknown as typeof fetch,
    };
    const tokens = await openaiDeviceLogin(oaConfig, deps, { onPrompt: () => {} });
    expect(tokens.accountId).toBe("acct-from-jwt");
  });
});
