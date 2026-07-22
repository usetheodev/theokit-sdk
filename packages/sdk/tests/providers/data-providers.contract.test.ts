import { beforeEach, describe, expect, it } from "vitest";

import { resolveProviderChain } from "../../src/internal/llm/router.js";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../src/internal/providers/builtin/index.js";

import {
  _resetProvidersForTests,
  getProviderProfile,
  registerProvider,
} from "../../src/internal/providers/registry.js";
import type { ProviderProfile } from "../../src/internal/providers/types.js";

/**
 * M45 — the data-providers contract suite. Three pillars per provider:
 *  (1) identity — name/apiMode/authType/baseUrl/envVars strict;
 *  (2) models — fallbackModels non-empty (checked per-entry below);
 *  (3) WIRE — spy fetch through the real router asserts the EXACT request URL (the /v1/v1 regression net)
 *      and every contract header with its exact value.
 */

function chatSse(): string {
  return (
    'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n' +
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
    "data: [DONE]\n\n"
  );
}

/** Streams one turn via spy fetch; returns {url, headers}. */
async function wire(providerName: string, apiKey = "sk-test-key"): Promise<{
  url: string;
  headers: Record<string, string>;
}> {
  let url = "";
  let headers: Record<string, string> = {};
  const spy = (async (u: string | URL, init?: { headers?: Record<string, string> }) => {
    url = String(u);
    headers = { ...(init?.headers ?? {}) };
    return new Response(chatSse(), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  // inject the spy through the transform seam of a cloned profile (never mutates the registered one)
  const base = getProviderProfile(providerName);
  if (base === undefined) throw new Error(`profile ${providerName} not registered`);
  const probed: ProviderProfile = { ...base, name: `${base.name}--wire-probe`, aliases: [], transform: { fetch: () => spy } };
  registerProvider(probed);
  const [client] = resolveProviderChain({
    primary: probed.name,
    apiKeys: { [probed.name]: [apiKey] },
  });
  const gen = client!.stream(
    { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
    new AbortController().signal,
  );
  let r = await gen.next();
  while (!r.done) r = await gen.next();
  return { url, headers };
}

beforeEach(() => {
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
  registerBuiltins();
});

describe("M45 Phase 0 — URL-join byte-identity for EXISTING builtins (RED-first net)", () => {
  it("openai (host-only baseUrl) → https://api.openai.com/v1/chat/completions (unchanged)", async () => {
    const { url } = await wire("openai");
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("openrouter (…/api baseUrl) → https://openrouter.ai/api/v1/chat/completions (unchanged)", async () => {
    const { url } = await wire("openrouter");
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("a version-suffixed baseUrl does NOT double (…/openai/v1 → single /v1)", async () => {
    registerProvider({
      name: "join-v1-test",
      apiMode: "chat_completions",
      authType: "api_key",
      envVars: [],
      baseUrl: "https://api.groq.com/openai/v1",
      fallbackModels: ["join-v1-test/m"],
    });
    const { url } = await wire("join-v1-test");
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions"); // was …/v1/v1/… before the fix
  });

  it("chatCompletionsPath escape → exact path with no version segment", async () => {
    registerProvider({
      name: "join-escape-test",
      apiMode: "chat_completions",
      authType: "api_key",
      envVars: [],
      baseUrl: "https://api.perplexity.ai",
      chatCompletionsPath: "/chat/completions",
      fallbackModels: ["join-escape-test/m"],
    });
    const { url } = await wire("join-escape-test");
    expect(url).toBe("https://api.perplexity.ai/chat/completions");
  });
});

/** M45 T1.1 — the per-provider contract table (identity + wire URL/headers). */
const CONTRACTS: Array<{
  name: string;
  baseUrl: string;
  envVars: string[];
  endpoint: string;
  headers?: Record<string, string>;
}> = [
  { name: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", envVars: ["GOOGLE_API_KEY", "GEMINI_API_KEY"], endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" },
  { name: "mistral", baseUrl: "https://api.mistral.ai/v1", envVars: ["MISTRAL_API_KEY"], endpoint: "https://api.mistral.ai/v1/chat/completions" },
  { name: "groq", baseUrl: "https://api.groq.com/openai/v1", envVars: ["GROQ_API_KEY"], endpoint: "https://api.groq.com/openai/v1/chat/completions" },
  { name: "cohere", baseUrl: "https://api.cohere.ai/compatibility/v1", envVars: ["COHERE_API_KEY", "CO_API_KEY"], endpoint: "https://api.cohere.ai/compatibility/v1/chat/completions" },
  { name: "deepinfra", baseUrl: "https://api.deepinfra.com/v1/openai", envVars: ["DEEPINFRA_API_KEY"], endpoint: "https://api.deepinfra.com/v1/openai/chat/completions" },
  { name: "together", baseUrl: "https://api.together.xyz/v1", envVars: ["TOGETHER_API_KEY"], endpoint: "https://api.together.xyz/v1/chat/completions" },
  { name: "xai", baseUrl: "https://api.x.ai/v1", envVars: ["XAI_API_KEY"], endpoint: "https://api.x.ai/v1/chat/completions" },
  { name: "perplexity", baseUrl: "https://api.perplexity.ai", envVars: ["PERPLEXITY_API_KEY"], endpoint: "https://api.perplexity.ai/chat/completions" },
  { name: "cerebras", baseUrl: "https://api.cerebras.ai/v1", envVars: ["CEREBRAS_API_KEY"], endpoint: "https://api.cerebras.ai/v1/chat/completions", headers: { "X-Cerebras-3rd-Party-Integration": "theokit" } },
  { name: "openrouter", baseUrl: "https://openrouter.ai/api", envVars: ["OPENROUTER_API_KEY", "OPENAI_API_KEY"], endpoint: "https://openrouter.ai/api/v1/chat/completions", headers: { "HTTP-Referer": "https://usetheo.dev", "X-Title": "theokit" } },
];

describe("M45 — data-provider contracts (identity + models + wire)", () => {
  for (const c of CONTRACTS) {
    it(`${c.name}: identity + non-empty models + EXACT wire URL/headers`, async () => {
      const p = getProviderProfile(c.name);
      expect(p, c.name).toBeDefined();
      expect(p?.apiMode).toBe("chat_completions");
      expect(p?.authType).toBe("api_key");
      expect(p?.baseUrl).toBe(c.baseUrl);
      expect(p?.envVars).toEqual(c.envVars);
      expect((p?.fallbackModels.length ?? 0) > 0, `${c.name} models`).toBe(true);
      const { url, headers } = await wire(c.name);
      expect(url).toBe(c.endpoint); // the /v1/v1 net, per provider, forever
      for (const [k, v] of Object.entries(c.headers ?? {})) {
        expect(headers[k], `${c.name} header ${k}`).toBe(v);
      }
      expect(headers.authorization).toBe("Bearer sk-test-key");
    });
  }

  it("google and gemini are DISTINCT routes (ADR D3 — no alias collision)", () => {
    const google = getProviderProfile("google");
    const gemini = getProviderProfile("gemini");
    expect(google?.baseUrl).toContain("generativelanguage.googleapis.com"); // direct, GOOGLE_API_KEY
    expect(gemini?.baseUrl).toContain("openrouter.ai"); // passthrough, OPENROUTER_API_KEY
    expect(google?.name).not.toBe(gemini?.name);
  });

  it("anthropic builtin carries the beta header as data (consumed by the Phase-2 transport wiring)", () => {
    expect(getProviderProfile("anthropic")?.extraHeaders?.["anthropic-beta"]).toBe(
      "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
    );
  });
});

describe("M45 Phase 2 — anthropic transport extraHeaders (the sanctioned delta)", () => {
  function anthropicSse(): string {
    return (
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n' +
      'data: {"type":"message_stop"}\n\n'
    );
  }

  async function anthropicWire(profileOverrides: Partial<ProviderProfile>): Promise<Record<string, string>> {
    let headers: Record<string, string> = {};
    const spy = (async (_u: string | URL, init?: { headers?: Record<string, string> }) => {
      headers = { ...(init?.headers ?? {}) };
      return new Response(anthropicSse(), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    const base = getProviderProfile("anthropic");
    const probed: ProviderProfile = {
      ...(base as ProviderProfile),
      name: "anthropic--wire-probe",
      aliases: [],
      ...profileOverrides,
      transform: { fetch: () => spy },
    };
    registerProvider(probed);
    const [client] = resolveProviderChain({
      primary: probed.name,
      apiKeys: { [probed.name]: ["sk-ant-test"] },
    });
    const gen = client!.stream(
      { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      new AbortController().signal,
    );
    let r = await gen.next();
    while (!r.done) r = await gen.next();
    return headers;
  }

  it("the anthropic wire carries the beta header + unchanged base headers", async () => {
    const headers = await anthropicWire({});
    expect(headers["anthropic-beta"]).toBe(
      "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
    );
    expect(headers["x-api-key"]).toBe("sk-ant-test"); // base auth unchanged
    expect(headers["anthropic-version"]).toBe("2023-06-01"); // base version unchanged
  });

  it("a plain anthropic profile (no extraHeaders) sends exactly today's header set (golden)", async () => {
    const headers = await anthropicWire({ extraHeaders: undefined });
    expect(Object.keys(headers).sort()).toEqual(["anthropic-version", "content-type", "x-api-key"]);
  });

  it("transform.headers merge over extraHeaders on anthropic_messages (M41 parity)", async () => {
    // the transform seam supplies dynamic headers on the anthropic branch now
    let headers: Record<string, string> = {};
    const spy = (async (_u: string | URL, init?: { headers?: Record<string, string> }) => {
      headers = { ...(init?.headers ?? {}) };
      return new Response(anthropicSse(), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    registerProvider({
      name: "anthropic-transform-probe",
      apiMode: "anthropic_messages",
      authType: "api_key",
      envVars: [],
      baseUrl: "https://api.anthropic.com",
      fallbackModels: ["anthropic-transform-probe/m"],
      extraHeaders: { "static-h": "s" },
      transform: { fetch: () => spy, headers: () => ({ "dyn-h": "d" }) },
    });
    const [client] = resolveProviderChain({
      primary: "anthropic-transform-probe",
      apiKeys: { "anthropic-transform-probe": ["k"] },
    });
    const gen = client!.stream(
      { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      new AbortController().signal,
    );
    let r = await gen.next();
    while (!r.done) r = await gen.next();
    expect(headers["static-h"]).toBe("s");
    expect(headers["dyn-h"]).toBe("d");
  });
});
