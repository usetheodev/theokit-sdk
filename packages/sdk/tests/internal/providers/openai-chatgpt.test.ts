import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCredential } from "../../../src/internal/auth/credential-store.js";
import type { CredentialStoreConfig } from "../../../src/internal/auth/types.js";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../../src/internal/providers/builtin/index.js";
import { getProviderProfile } from "../../../src/internal/providers/registry.js";

/**
 * M43 — the openai-chatgpt builtin. Its `transform.fetch` resolves the LIVE credential per request (fresh
 * Bearer + dynamic ChatGPT-Account-Id from the ambient store, pointed via THEOKIT_AUTH_HOME). Hermetic: a tmp
 * store + a spy `globalThis.fetch` routed by URL (token endpoint → refresh json; codex endpoint → capture).
 */

const roots: string[] = [];
const NOW = 1_000_000_000_000;
let realFetch: typeof fetch;
let prevHome: string | undefined;

function newHome(): CredentialStoreConfig {
  const dir = mkdtempSync(join(tmpdir(), "codex-store-"));
  roots.push(dir);
  process.env.THEOKIT_AUTH_HOME = dir; // the builtin's DEFAULT_STORE reads here
  // a store config whose homeEnvVar override resolves to THEOKIT_AUTH_HOME/auth.json (same file the builtin reads)
  return { home: dir, dirName: ".ignored", fileName: "auth.json", homeEnvVar: "THEOKIT_AUTH_HOME" };
}

beforeEach(() => {
  _resetBuiltinsRegistered();
  registerBuiltins();
  realFetch = globalThis.fetch;
  prevHome = process.env.THEOKIT_AUTH_HOME;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (prevHome === undefined) delete process.env.THEOKIT_AUTH_HOME;
  else process.env.THEOKIT_AUTH_HOME = prevHome;
  for (const r of roots.splice(0)) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("openai-chatgpt builtin (M43)", () => {
  it("registers with apiMode responses_api + oauth authType + codex baseUrl", () => {
    const p = getProviderProfile("openai-chatgpt");
    expect(p).toBeDefined();
    expect(p?.apiMode).toBe("responses_api");
    expect(p?.authType).toBe("oauth_device_code");
    expect(p?.baseUrl).toBe("https://chatgpt.com/backend-api/codex");
    // #165 — this assertion used to pin `codex_cli_rs`, the official Codex CLI's own value. It
    // encoded a false client identity AS THE CONTRACT, which is how the claim survived review: the
    // test made correcting it look like a regression. A test that pins a defect protects the defect.
    expect(p?.extraHeaders?.originator).toBe("theokit");
    expect(
      p?.extraHeaders?.originator,
      "the SDK must not present itself as another vendor's client",
    ).not.toBe("codex_cli_rs");
    expect(p?.fallbackModels).toContain("openai-chatgpt/gpt-5.4");
  });

  it("transform.fetch sets a fresh Bearer + dynamic ChatGPT-Account-Id (single authorization header)", async () => {
    const store = newHome();
    writeCredential(
      {
        type: "oauth",
        provider: "openai",
        access: "LIVE-ACCESS",
        refresh: "r",
        expires: 4_000_000_000_000, // far-future (year 2096) — valid vs real clock, no refresh
        account_id: "acct-XYZ",
      },
      store,
      process.env,
    );
    let sent: Record<string, string> = {};
    globalThis.fetch = (async (_url: string, init?: { headers?: Headers }) => {
      const h = init?.headers as Headers;
      sent = {
        authorization: h.get("authorization") ?? "",
        accountId: h.get("ChatGPT-Account-Id") ?? "",
        originator: h.get("originator") ?? "",
      };
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const profile = getProviderProfile("openai-chatgpt");
    const wrapper = profile!.transform!.fetch!({ apiKey: "__oauth_lazy_token__" });
    await wrapper("https://chatgpt.com/backend-api/codex/responses", {
      headers: { originator: "theokit" },
    });
    expect(sent.authorization).toBe("Bearer LIVE-ACCESS");
    expect(sent.accountId).toBe("acct-XYZ");
    // The transform must pass an inbound header through untouched — it only ADDS auth headers.
    expect(sent.originator).toBe("theokit");
  });

  it("transform.fetch refreshes an expired token → outbound Bearer is the FRESH token", async () => {
    const store = newHome();
    writeCredential(
      {
        type: "oauth",
        provider: "openai",
        access: "OLD-ACCESS",
        refresh: "OLD-REFRESH",
        expires: NOW, // expired
        account_id: "acct-XYZ",
      },
      store,
      process.env,
    );
    let outboundAuth = "";
    globalThis.fetch = (async (url: string, init?: { headers?: Headers }) => {
      if (String(url).includes("auth.openai.com/oauth/token")) {
        return new Response(
          JSON.stringify({ access_token: "FRESH-ACCESS", refresh_token: "NR", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      outboundAuth = (init?.headers as Headers).get("authorization") ?? "";
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const profile = getProviderProfile("openai-chatgpt");
    const wrapper = profile!.transform!.fetch!({ apiKey: "__oauth_lazy_token__" });
    await wrapper("https://chatgpt.com/backend-api/codex/responses", { headers: {} });
    expect(outboundAuth).toBe("Bearer FRESH-ACCESS"); // refreshed at request time, no rebuild
  });

  it("transform.fetch throws a clear error when not logged in (no placeholder on the wire)", async () => {
    newHome(); // empty store
    let hitNetwork = false;
    globalThis.fetch = (async () => {
      hitNetwork = true;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const profile = getProviderProfile("openai-chatgpt");
    const wrapper = profile!.transform!.fetch!({ apiKey: "__oauth_lazy_token__" });
    await expect(
      wrapper("https://chatgpt.com/backend-api/codex/responses", { headers: {} }),
    ).rejects.toThrow(/no ChatGPT credential|login/i);
    expect(hitNetwork).toBe(false); // never POSTed the placeholder
  });
});
