/**
 * Tests for LM Studio + llama.cpp sibling profiles (T7.1+T7.2, ADRs D188/D189).
 *
 * Both inherit the `authType: "none"` primitive from D182 (Ollama) — zero
 * env vars required for local use, base URL override via `LMSTUDIO_HOST` /
 * `LLAMACPP_HOST`, transports reuse `OpenAIClient` via `chat_completions`
 * apiMode.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  it("resolves client with zero env vars set", () => {
    const chain = resolveProviderChain({ primary: "lmstudio" });
    expect(chain).toHaveLength(1);
  });

  it("LMSTUDIO_HOST env var allows pointing at a remote box", () => {
    process.env.LMSTUDIO_HOST = "http://192.168.1.50:1234";
    const chain = resolveProviderChain({ primary: "lmstudio" });
    expect(chain).toHaveLength(1);
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

  it("resolves client with zero env vars set", () => {
    const chain = resolveProviderChain({ primary: "llamacpp" });
    expect(chain).toHaveLength(1);
  });

  it("LLAMACPP_HOST env var allows pointing at a remote box", () => {
    process.env.LLAMACPP_HOST = "http://192.168.1.50:8080";
    const chain = resolveProviderChain({ primary: "llamacpp" });
    expect(chain).toHaveLength(1);
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
