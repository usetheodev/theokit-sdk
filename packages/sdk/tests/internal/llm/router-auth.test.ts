import { beforeEach, describe, expect, it } from "vitest";

import { resolveProviderChain } from "../../../src/internal/llm/router.js";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../../src/internal/providers/builtin/index.js";
import {
  _resetProvidersForTests,
  registerProvider,
} from "../../../src/internal/providers/registry.js";
import type { ProviderProfile } from "../../../src/internal/providers/types.js";

/**
 * M42 T2.2 — the router builds a client for an oauth provider (no static key) via the lazy sentinel, and its
 * M41 `transform.fetch(ctx)` owns the Authorization at stream time (where a real provider calls
 * `resolveCredential`). A plain api-key profile resolves byte-for-byte unchanged — the oauth path is
 * additive and authType-gated.
 */
describe("M42 — router obtains the oauth bearer at stream time (plain profiles unchanged)", () => {
  beforeEach(() => {
    _resetProvidersForTests();
    _resetBuiltinsRegistered();
    registerBuiltins();
  });

  async function drain(client: {
    stream: (r: unknown, s: AbortSignal) => AsyncGenerator;
  }): Promise<void> {
    const gen = client.stream(
      { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      new AbortController().signal,
    );
    let r = await gen.next();
    while (!r.done) r = await gen.next();
  }

  function chatSse(): string {
    return (
      'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n"
    );
  }

  it("a plain api-key profile resolves unchanged — Authorization is the static key (golden)", async () => {
    let sentAuth = "";
    const spyFetch = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      sentAuth = init?.headers?.authorization ?? init?.headers?.Authorization ?? "";
      return new Response(chatSse(), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const profile: ProviderProfile = {
      name: "plain-cc",
      apiMode: "chat_completions",
      envVars: [],
      authType: "api_key",
      baseUrl: "https://plain.test/v1",
      fallbackModels: ["plain-cc/m"],
      transform: { fetch: () => spyFetch },
    };
    registerProvider(profile);

    const [client] = resolveProviderChain({
      primary: "plain-cc",
      apiKeys: { "plain-cc": ["sk-static-key"] },
    });
    expect(client).toBeDefined();
    await drain(client as never);
    expect(sentAuth).toBe("Bearer sk-static-key"); // static key threaded, no oauth interference
  });

  it("an oauth provider (no static key) builds a client and its transform.fetch owns the bearer", async () => {
    let sentAuth = "";
    // In production this fetch calls resolveCredential to obtain a freshly-refreshed token; here we assert
    // the router BUILT the client (via the M42 lazy sentinel) and INVOKED the provider's transform.fetch.
    const providerOwnedFetch = (async (
      _url: string,
      init?: { headers?: Record<string, string> },
    ) => {
      sentAuth = init?.headers?.authorization ?? init?.headers?.Authorization ?? "";
      return new Response(chatSse(), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const oauthProfile: ProviderProfile = {
      name: "oauth-cc",
      apiMode: "chat_completions",
      envVars: [],
      authType: "oauth_external",
      baseUrl: "https://oauth.test/v1",
      fallbackModels: ["oauth-cc/m"],
      // The provider owns auth: transform.headers injects the fresh bearer (a real provider derives it
      // from resolveCredential inside transform.fetch); transform.fetch carries the request.
      transform: {
        fetch: () => providerOwnedFetch,
        headers: () => ({ authorization: "Bearer FRESH-OAUTH-TOKEN" }),
      },
    };
    registerProvider(oauthProfile);

    // NO apiKeys for this provider — before M42 the router returned no client for an oauth provider.
    const [client] = resolveProviderChain({ primary: "oauth-cc" });
    expect(client).toBeDefined(); // the lazy sentinel let the client build
    await drain(client as never);
    expect(sentAuth).toBe("Bearer FRESH-OAUTH-TOKEN"); // provider-owned bearer, NOT the lazy sentinel
  });

  it("an api_key provider with no key still resolves no client — confirm authType gating is precise", () => {
    // The M42 sentinel is oauth-gated: an api_key profile with no key yields NO client (unchanged — the
    // router throws ConfigurationError rather than fabricate a bearer), proving the sentinel did not widen.
    registerProvider({
      name: "no-cred",
      apiMode: "chat_completions",
      envVars: [],
      authType: "api_key",
      baseUrl: "https://no.test/v1",
      fallbackModels: ["no-cred/m"],
    });
    expect(() => resolveProviderChain({ primary: "no-cred" })).toThrow(/No provider client/);
  });

  it("an oauth provider WITHOUT a transform fails fast — never sends the __oauth_lazy_token__ placeholder (MEDIUM-1)", () => {
    // The auth model never puts a placeholder on the wire; a missing credential is MissingCredentialError.
    // theokit's analog: an oauth provider that supplies neither transform.fetch nor an authorization header
    // must throw a ConfigurationError, not POST "Bearer __oauth_lazy_token__" to the real upstream.
    registerProvider({
      name: "oauth-no-transform",
      apiMode: "chat_completions",
      envVars: [],
      authType: "oauth_external",
      baseUrl: "https://oauth.test/v1",
      fallbackModels: ["oauth-no-transform/m"],
      // NO transform → no fetch, no authorization header.
    });
    expect(() => resolveProviderChain({ primary: "oauth-no-transform" })).toThrow(
      /no credential was resolved/,
    );
  });

  it("an oauth provider whose transform supplies ONLY headers.authorization builds (no fetch needed)", () => {
    registerProvider({
      name: "oauth-headers-only",
      apiMode: "responses_api",
      envVars: [],
      authType: "oauth_external",
      baseUrl: "https://oauth.test/backend",
      fallbackModels: ["oauth-headers-only/m"],
      transform: { headers: () => ({ authorization: "Bearer TKN" }) },
    });
    const [client] = resolveProviderChain({ primary: "oauth-headers-only" });
    expect(client).toBeDefined();
  });
});
