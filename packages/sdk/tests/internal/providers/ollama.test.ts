/**
 * Tests for Ollama builtin provider (ADR D182).
 *
 * Ollama is local-first: it ships as a builtin profile with `authType: "none"`
 * so users can run `Agent.create({ model: "ollama/llama3.2" })` without
 * configuring any env var. `OLLAMA_HOST` overrides the default localhost
 * baseUrl; `OLLAMA_API_KEY` overrides the sentinel for Ollama Cloud /
 * reverse-proxy auth.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveProviderChain } from "../../../src/internal/llm/router.js";
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
  "OLLAMA_HOST",
  "OLLAMA_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
];

beforeEach(() => {
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
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

describe("ollama builtin provider (D182)", () => {
  it("ollama profile registered as builtin", () => {
    const p = getProviderProfile("ollama");
    expect(p).toBeDefined();
    expect(p?.apiMode).toBe("chat_completions");
    expect(p?.authType).toBe("none");
    expect(p?.baseUrl).toBe("http://localhost:11434");
  });

  it("ollama profile counted alongside other builtins", () => {
    // anthropic, openai, openrouter, gemini, ollama (D182), lmstudio (D188), llamacpp (D189) = 7
    expect(listProviders()).toHaveLength(7);
  });

  it("ollama fallback models include a sensible default", () => {
    const p = getProviderProfile("ollama");
    expect(p?.fallbackModels.length).toBeGreaterThan(0);
  });

  it("router resolves ollama client with ZERO env vars set", () => {
    // The whole point: non-technical user runs `ollama serve` and the SDK
    // just works. No OLLAMA_API_KEY required.
    const chain = resolveProviderChain({ primary: "ollama" });
    expect(chain).toHaveLength(1);
  });

  it("OLLAMA_HOST env var overrides baseUrl (advanced users on remote box)", () => {
    process.env.OLLAMA_HOST = "http://192.168.1.50:11434";
    const chain = resolveProviderChain({ primary: "ollama" });
    expect(chain).toHaveLength(1);
    // The transport selection must honor OLLAMA_HOST; we assert indirectly via
    // the chain resolving without throwing. Deeper assertion lives in transport
    // unit tests but here we just guard against regression.
  });

  it("OLLAMA_API_KEY env var overrides sentinel (Ollama Cloud / reverse-proxy)", () => {
    process.env.OLLAMA_API_KEY = "secret-from-ollama-cloud";
    const chain = resolveProviderChain({ primary: "ollama" });
    expect(chain).toHaveLength(1);
  });

  it("ollama works as fallback when primary has no key", () => {
    // primary=anthropic with no key → ollama fallback should take over.
    const chain = resolveProviderChain({ primary: "anthropic", fallback: ["ollama"] });
    expect(chain).toHaveLength(1);
  });
});
