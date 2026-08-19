/**
 * Tests for LM Studio + llama.cpp sibling profiles (T7.1+T7.2, ADRs D188/D189).
 *
 * Both inherit the `authType: "none"` primitive from D182 (Ollama) — zero
 * env vars required for local use, base URL override via `LMSTUDIO_HOST` /
 * `LLAMACPP_HOST`, transports reuse `OpenAIClient` via `chat_completions`
 * apiMode.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetNoAuthApiKeyWarnings,
  resolveProviderChain,
} from "../../../src/internal/llm/router.js";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../../src/internal/providers/builtin/index.js";
import {
  _resetProvidersForTests,
  getProviderProfile,
  listProviders,
} from "../../../src/internal/providers/registry.js";

const ORIG_ENV: Record<string, string | undefined> = {};
const TRACKED_ENV = [
  "LMSTUDIO_HOST",
  "LMSTUDIO_API_KEY",
  "LLAMACPP_HOST",
  "LLAMACPP_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
];

beforeEach(() => {
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
  _resetNoAuthApiKeyWarnings();
  for (const k of TRACKED_ENV) {
    ORIG_ENV[k] = process.env[k];
    delete process.env[k];
  }
  registerBuiltins();
});
afterEach(() => {
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
});

/**
 * Same behavioural route as `ollama.test.ts` — see the note there. The `_HOST` overrides are applied
 * when the transport is built and `LlmClient` exposes only `name` and `stream`, so the request is
 * where the configuration becomes observable.
 */
async function captureRequestUrl(primary: string): Promise<string> {
  let url = "";
  vi.stubGlobal("fetch", (async (u: unknown) => {
    url = String(u);
    return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as unknown as typeof fetch);
  try {
    const [client] = resolveProviderChain({ primary });
    if (client === undefined) throw new Error(`no client resolved for primary="${primary}"`);
    const gen = (
      client as unknown as { stream: (r: unknown, s: AbortSignal) => AsyncGenerator }
    ).stream(
      { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      new AbortController().signal,
    );
    let r = await gen.next();
    while (!r.done) r = await gen.next();
    return url;
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("LM Studio profile (D188)", () => {
  it("registered as builtin with authType: none", () => {
    const p = getProviderProfile("lmstudio");
    expect(p?.apiMode).toBe("chat_completions");
    expect(p?.authType).toBe("none");
    expect(p?.baseUrl).toBe("http://localhost:1234");
  });

  it("alias 'lm-studio' resolves to canonical 'lmstudio'", () => {
    expect(getProviderProfile("lm-studio")?.name).toBe("lmstudio");
  });

  it("resolves client with zero env vars set", async () => {
    // B-073. `toHaveLength(1)` proved a client existed, never that it was lmstudio's. The item's dod
    // asks for `chain[0].name === "lmstudio"`, and that assertion can never hold: `name` is the
    // TRANSPORT class's name (`openai.ts:125` → "openai"), not the profile's, so every
    // chat_completions provider reports "openai". Measured — under a mutant resolving lmstudio to
    // the native ollama client, the name assertion would pass for the wrong reason and this test
    // stayed green either way.
    //
    // The default base URL is what distinguishes them, and this file's own profile test at :60
    // already pins `http://localhost:1234` as lmstudio's. Asserting the request lands there is the
    // dod's intent expressed through something observable.
    //
    // Scope of this oracle, stated rather than implied: it pins the PROFILE, not the transport
    // class. Measured — a mutant routing lmstudio through the native ollama client leaves this green
    // (the native client still reads `profile.baseUrl`, so the port is unchanged), while a mutant
    // resolving lmstudio to the llamacpp profile kills it. Discriminating profiles is what the item
    // asks for; discriminating transports is a different property and no test here claims it.
    const chain = resolveProviderChain({ primary: "lmstudio" });
    expect(chain).toHaveLength(1);

    expect(
      await captureRequestUrl("lmstudio"),
      "zero configuration must resolve the lmstudio profile, not merely some client",
    ).toMatch(/^http:\/\/localhost:1234\//);
  });

  it("LMSTUDIO_HOST env var allows pointing at a remote box", async () => {
    // B-031. `toHaveLength(1)` never observed the host. Measured: deleting
    // `case "lmstudio": return process.env.LMSTUDIO_HOST` from `router.ts` left this file green.
    process.env.LMSTUDIO_HOST = "http://192.168.1.50:1234";

    expect(
      await captureRequestUrl("lmstudio"),
      "the request must go to the host LMSTUDIO_HOST names",
    ).toMatch(/^http:\/\/192\.168\.1\.50:1234\//);
  });
});

describe("llama.cpp profile (D189)", () => {
  it("registered as builtin with authType: none", () => {
    const p = getProviderProfile("llamacpp");
    expect(p?.apiMode).toBe("chat_completions");
    expect(p?.authType).toBe("none");
    expect(p?.baseUrl).toBe("http://localhost:8080");
  });

  it("aliases 'llama-cpp' and 'llama.cpp' resolve to canonical 'llamacpp'", () => {
    expect(getProviderProfile("llama-cpp")?.name).toBe("llamacpp");
    expect(getProviderProfile("llama.cpp")?.name).toBe("llamacpp");
  });

  it("resolves client with zero env vars set", async () => {
    // B-073, llama.cpp half. Same reasoning as the lmstudio case above: `name` cannot discriminate
    // (both report the transport's "openai"), the default base URL can, and this file pins
    // `http://localhost:8080` as llamacpp's at :85.
    const chain = resolveProviderChain({ primary: "llamacpp" });
    expect(chain).toHaveLength(1);

    expect(
      await captureRequestUrl("llamacpp"),
      "zero configuration must resolve the llamacpp profile, not merely some client",
    ).toMatch(/^http:\/\/localhost:8080\//);
  });

  it("LLAMACPP_HOST env var allows pointing at a remote box", async () => {
    // B-032. Same measurement, same gap: deleting the `llamacpp` case left this file green.
    process.env.LLAMACPP_HOST = "http://192.168.1.50:8080";

    expect(
      await captureRequestUrl("llamacpp"),
      "the request must go to the host LLAMACPP_HOST names",
    ).toMatch(/^http:\/\/192\.168\.1\.50:8080\//);
  });
});

describe("Builtin count after D188 + D189 + D286/D288 + T10.1 catalog", () => {
  it("listProviders includes all 9 builtins plus dynamic catalog providers", () => {
    // 9 first-party builtins + 35 catalog-only providers (T10.1, ADR D447) = 44
    const providers = listProviders();
    expect(providers.length).toBeGreaterThanOrEqual(9);
    const names = providers.map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "anthropic",
        "openai",
        "openrouter",
        "gemini",
        "ollama",
        "lmstudio",
        "llamacpp",
        "bedrock",
        "vertex",
      ]),
    );
  });
});
