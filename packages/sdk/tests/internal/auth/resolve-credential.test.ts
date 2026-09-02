import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { writeCredential } from "../../../src/internal/auth/credential-store.js";
import { resolveCredential } from "../../../src/internal/auth/resolve-credential.js";
import type {
  CredentialStoreConfig,
  OAuthProviderConfig,
} from "../../../src/internal/auth/types.js";

const roots: string[] = [];
const FIXED_NOW = 1_000_000_000_000;

function newStore(): CredentialStoreConfig {
  const home = mkdtempSync(join(tmpdir(), "resolve-cred-"));
  roots.push(home);
  return { home, dirName: ".theo-auth", fileName: "auth.json" };
}

const oauthConfig: OAuthProviderConfig = {
  provider: "openai",
  authorizeEndpoint: "https://auth.test/authorize",
  tokenEndpoint: "https://auth.test/token",
  clientId: "cid",
  scopes: ["openid"],
  redirectUri: "https://app.test/cb",
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

describe("resolveCredential", () => {
  it("returns undefined when the store is absent", async () => {
    const store = newStore();
    expect(await resolveCredential({ provider: "openai", store })).toBeUndefined();
  });

  it("does NOT attribute a provider-less legacy api file to the requested provider (MEDIUM-2, fail-closed)", async () => {
    // A legacy {api_key:"…"} file with no `provider` must NOT be POSTed to whatever provider the caller asks
    // for — cross-vendor key exposure. The generic SDK cannot infer provider from prefix; it fails closed.
    const config = newStore();
    const dir = join(config.home, config.dirName);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const p = join(dir, config.fileName);
    writeFileSync(p, '{"api_key":"sk-ant-legacy"}');
    chmodSync(p, 0o600);
    expect(await resolveCredential({ provider: "openai", store: config })).toBeUndefined();
  });

  it("does NOT attribute a mismatched-provider api file to the requested provider (MEDIUM-2)", async () => {
    const config = newStore();
    writeCredential({ provider: "anthropic", apiKey: "sk-ant-x" }, config);
    expect(await resolveCredential({ provider: "openai", store: config })).toBeUndefined();
  });

  it("resolves an api credential without any network call", async () => {
    const store = newStore();
    writeCredential({ provider: "openai", apiKey: "sk-live" }, store);
    const spy = vi.fn();
    const cred = await resolveCredential({
      provider: "openai",
      store,
      deps: { fetch: spy as unknown as typeof fetch },
    });
    expect(cred?.kind).toBe("api");
    expect(cred?.apiKey).toBe("sk-live");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns undefined when the store holds a different provider (oauth)", async () => {
    const store = newStore();
    writeCredential(
      { type: "oauth", provider: "anthropic", access: "a", refresh: "r", expires: FIXED_NOW },
      store,
    );
    expect(await resolveCredential({ provider: "openai", store })).toBeUndefined();
  });

  it("passes a still-valid oauth token through without a refresh", async () => {
    const store = newStore();
    writeCredential(
      {
        type: "oauth",
        provider: "openai",
        access: "VALID",
        refresh: "r",
        expires: FIXED_NOW + 3600 * 1000,
      },
      store,
    );
    const spy = vi.fn();
    const cred = await resolveCredential({
      provider: "openai",
      store,
      oauth: oauthConfig,
      deps: { fetch: spy as unknown as typeof fetch, now: () => FIXED_NOW },
    });
    expect(cred?.kind).toBe("oauth");
    expect(cred?.apiKey).toBe("VALID");
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes an expired oauth token via the injected fetch", async () => {
    const store = newStore();
    writeCredential(
      { type: "oauth", provider: "openai", access: "OLD", refresh: "OLD-REF", expires: FIXED_NOW },
      store,
    );
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ access_token: "FRESH", refresh_token: "r2", expires_in: 3600 }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;
    const cred = await resolveCredential({
      provider: "openai",
      store,
      oauth: oauthConfig,
      deps: { fetch: fetchImpl, now: () => FIXED_NOW },
    });
    expect(cred?.apiKey).toBe("FRESH");
  });
});
