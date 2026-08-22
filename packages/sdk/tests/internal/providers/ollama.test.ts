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
import { captureRequest } from "../../helpers/capture-request.js";

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
    // 9 first-party builtins + 35 catalog-only providers (T10.1, ADR D447)
    const providers = listProviders();
    expect(providers.length).toBeGreaterThanOrEqual(9);
    expect(providers.map((p) => p.name)).toContain("ollama");
  });

  it("ollama fallback models include a sensible default", () => {
    const p = getProviderProfile("ollama");
    expect(p?.fallbackModels.length).toBeGreaterThan(0);
  });

  it("router resolves ollama client with ZERO env vars set", () => {
    // B-073. The whole point: a non-technical user runs `ollama serve` and the SDK just works, with
    // no OLLAMA_API_KEY. `toHaveLength(1)` proved a client existed, never that it was this one.
    const chain = resolveProviderChain({ primary: "ollama" });

    expect(chain).toHaveLength(1);
    expect(chain[0]?.name, "zero configuration must still resolve the ollama client").toBe(
      "ollama",
    );
  });

  it("OLLAMA_HOST env var overrides baseUrl (advanced users on remote box)", async () => {
    // B-028. The body asserted `toHaveLength(1)` under a comment claiming the deeper assertion
    // "lives in transport unit tests". No such test exists — measured: making `router.ts:359` read
    // `profile.baseUrl` instead of `process.env.OLLAMA_HOST ?? profile.baseUrl` passes 1923 tests in
    // `tests/internal/` + `tests/golden/` with zero failures. The override was not weakly tested,
    // it was untested, and the comment is why that survived: a reader checking for coverage found a
    // sentence saying it was covered elsewhere.
    //
    // The first version of THIS comment cited a different mutant — deleting `case "ollama"` from
    // `resolveBaseUrlEnvOverride` — which yields the same 1923 and proves nothing, because that case
    // is unreachable for ollama (`router.ts:358` returns the native client first). Both mutants
    // giving an identical number is exactly what made the misattribution invisible.
    process.env.OLLAMA_HOST = "http://192.168.1.50:11434";

    const { url } = await captureRequest({ primary: "ollama" });

    expect(url, "the request must go to the host OLLAMA_HOST names").toMatch(
      /^http:\/\/192\.168\.1\.50:11434\//,
    );
  });

  it("OLLAMA_API_KEY env var overrides sentinel (Ollama Cloud / reverse-proxy)", async () => {
    // B-029. Same shape: `toHaveLength(1)` never observed the credential. Measured — dropping
    // `envVars: ["OLLAMA_API_KEY"]` from the ollama profile passes all 48 provider tests.
    // "Overrides the sentinel" means something specific to a caller behind a reverse proxy: the
    // request carries THEIR key, not Ollama's local placeholder. That is what is asserted.
    process.env.OLLAMA_API_KEY = "secret-from-ollama-cloud";

    const { authorization } = await captureRequest({ primary: "ollama" });

    expect(authorization, "the caller's key must reach the wire, not the local sentinel").toBe(
      "Bearer secret-from-ollama-cloud",
    );
  });

  it("ollama works as fallback when primary has no key", () => {
    // B-030. `toHaveLength(1)` says one client resolved; the test is named for WHICH one. A
    // regression that dropped the fallback and resolved something else entirely would have passed.
    const chain = resolveProviderChain({ primary: "anthropic", fallback: ["ollama"] });

    expect(chain).toHaveLength(1);
    expect(chain[0]?.name, "the keyless primary must yield to the ollama fallback").toBe("ollama");
  });
});
