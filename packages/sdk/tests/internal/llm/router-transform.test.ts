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
 * M41 — the provider `transform` seam. Hermetic router-branch coverage (the gap the M40 review flagged):
 * register a provider whose `transform` supplies a spy fetch + dynamic headers, resolve it through the real
 * `resolveProviderChain`, drain a turn, and assert the router FED the transform into the transport — closing
 * the `responses.ts` `fetch?` that the router never passed.
 */
describe("M41 — provider transform seam (router feeds fetch + headers)", () => {
  beforeEach(() => {
    _resetProvidersForTests();
    _resetBuiltinsRegistered();
    registerBuiltins();
  });

  it("responses_api honors transform.fetch + merges transform.headers over extraHeaders", async () => {
    let usedFetch = false;
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      usedFetch = true;
      sentHeaders = init?.headers ?? {};
      const sse =
        'data: {"type":"response.output_text.delta","delta":"hi"}\n\n' +
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    const provider: ProviderProfile = {
      name: "test-responses",
      apiMode: "responses_api",
      envVars: [],
      authType: "oauth_external",
      baseUrl: "https://example.test/backend",
      fallbackModels: ["test-responses/model-x"],
      extraHeaders: { "static-header": "s" },
      transform: {
        fetch: () => spyFetch,
        headers: (ctx) => ({ "dynamic-header": `d-${ctx.apiKey}` }),
      },
    };
    registerProvider(provider);

    const [client] = resolveProviderChain({
      primary: "test-responses",
      apiKeys: { "test-responses": ["tok-123"] },
    });
    const gen = client!.stream(
      { model: "model-x", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      new AbortController().signal,
    );
    let r = await gen.next();
    while (!r.done) r = await gen.next();

    expect(usedFetch).toBe(true); // the provider's fetch was used, not global fetch
    expect(sentHeaders["static-header"]).toBe("s"); // static extraHeaders preserved
    expect(sentHeaders["dynamic-header"]).toBe("d-tok-123"); // transform.headers merged + ctx.apiKey threaded
  });

  it("chat_completions honors transform.fetch + transform.headers (MEDIUM-4/MEDIUM-1)", async () => {
    let usedFetch = false;
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      usedFetch = true;
      sentHeaders = init?.headers ?? {};
      const sse =
        'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n' +
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
        "data: [DONE]\n\n";
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    registerProvider({
      name: "cc-transform",
      apiMode: "chat_completions",
      envVars: [],
      authType: "api_key",
      baseUrl: "https://cc.test/v1",
      fallbackModels: ["cc-transform/m"],
      transform: { fetch: () => spyFetch, headers: (ctx) => ({ "x-dyn": ctx.apiKey }) },
    });
    const [client] = resolveProviderChain({
      primary: "cc-transform",
      apiKeys: { "cc-transform": ["kk"] },
    });
    const gen = client!.stream(
      { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      new AbortController().signal,
    );
    let r = await gen.next();
    while (!r.done) r = await gen.next();
    expect(usedFetch).toBe(true);
    expect(sentHeaders["x-dyn"]).toBe("kk"); // OpenAIClient now honors extraHeaders (transform.headers)
  });

  it("a plain responses_api profile passes its static extraHeaders + uses global fetch (back-compat golden)", async () => {
    let sawStatic = false;
    let sawDynamic = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      const h = init?.headers ?? {};
      if (h["static-only"] === "S") sawStatic = true;
      if ("x-dyn" in h) sawDynamic = true;
      const sse =
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    try {
      registerProvider({
        name: "plain-responses",
        apiMode: "responses_api",
        envVars: [],
        authType: "api_key",
        baseUrl: "https://plain.test/backend",
        fallbackModels: ["plain-responses/m"],
        extraHeaders: { "static-only": "S" },
        // NO transform
      });
      const [client] = resolveProviderChain({
        primary: "plain-responses",
        apiKeys: { "plain-responses": ["k"] },
      });
      const gen = client!.stream(
        { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
        new AbortController().signal,
      );
      let r = await gen.next();
      while (!r.done) r = await gen.next();
      expect(sawStatic).toBe(true); // static extraHeaders still sent
      expect(sawDynamic).toBe(false); // no transform → no dynamic header
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("a profile WITHOUT transform resolves via the static path (back-compat, no throw)", () => {
    const plain: ProviderProfile = {
      name: "plain-x",
      apiMode: "chat_completions",
      envVars: [],
      authType: "api_key",
      baseUrl: "https://x.test/v1",
      fallbackModels: ["plain-x/m"],
    };
    registerProvider(plain);
    const [client] = resolveProviderChain({ primary: "plain-x", apiKeys: { "plain-x": ["k"] } });
    expect(client?.name).toBeDefined();
  });
});
