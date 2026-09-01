/**
 * Tests for refactored router (T4.3, ADRs D105-D107).
 */

/**
 * Peels off ALL decorators down to the real transport, in a loop.
 *
 * In a loop and not two `if`s: the order in which router and chain-builder wrap is not fixed, and one
 * positional unwrapping now depends on it. M93 — `RetryingLlmClient` was the second
 * decorator to arrive; the third must not break these tests again.
 */
function unwrapDecorators(client: LlmClient): LlmClient {
  let current = client;
  for (;;) {
    if (current instanceof RetryingLlmClient) current = current.inner;
    else if (current instanceof FaultInjectingLlmClient) current = current.inner;
    else return current;
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaultInjectingLlmClient } from "../../../src/internal/llm/fault-injection.js";
import type { OpenAIClient } from "../../../src/internal/llm/openai.js";
import { RetryingLlmClient } from "../../../src/internal/llm/retrying-client.js";
import {
  _resetNoAuthApiKeyWarnings,
  _resolveApiKeyForTests,
  resolveProviderChain,
} from "../../../src/internal/llm/router.js";
import type { LlmClient } from "../../../src/internal/llm/types.js";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../../src/internal/providers/builtin/index.js";
import { OPENROUTER } from "../../../src/internal/providers/builtin/openrouter.js";
import {
  _resetProvidersForTests,
  registerProvider,
} from "../../../src/internal/providers/registry.js";

const ORIG_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
  _resetNoAuthApiKeyWarnings();
  for (const k of [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_BASE_URL",
    "OPENAI_API_BASE_URL",
    "OPENROUTER_API_BASE_URL",
  ]) {
    ORIG_ENV[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
});

describe("router (T4.3)", () => {
  it("buildClient anthropic via profile", () => {
    process.env.ANTHROPIC_API_KEY = "k1";
    const chain = resolveProviderChain({ primary: "anthropic" });
    expect(chain).toHaveLength(1);
  });

  it("buildClient openrouter alias 'or'", () => {
    process.env.OPENROUTER_API_KEY = "k1";
    const chain = resolveProviderChain({ primary: "or" });
    expect(chain).toHaveLength(1);
  });

  it("buildClient user-overridden provider used", () => {
    registerBuiltins();
    registerProvider({
      name: "anthropic",
      apiMode: "anthropic_messages",
      envVars: ["MY_OVERRIDE_KEY"],
      authType: "api_key",
      baseUrl: "https://custom.anthropic-proxy.com",
      fallbackModels: ["claude-custom"],
    });
    process.env.MY_OVERRIDE_KEY = "ok";
    const chain = resolveProviderChain({ primary: "anthropic" });
    expect(chain).toHaveLength(1);
  });

  it("unknown provider throws helpful error", () => {
    expect(() => resolveProviderChain({ primary: "totally-unknown-provider" })).toThrow(
      /No provider client could be resolved/,
    );
  });

  it("EC-3: selectTransport unsupported apiMode throws transport_unavailable", () => {
    registerProvider({
      name: "bedrock-needs-transport",
      apiMode: "bedrock",
      envVars: ["AWS_ACCESS_KEY_ID"],
      authType: "aws_sdk",
      baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
      fallbackModels: ["anthropic.claude-3-haiku-20240307-v1:0"],
    });
    process.env.AWS_ACCESS_KEY_ID = "fake";
    // Was `/transport plugin/`, which pinned a message telling the user to install
    // `@theokit-transport-{apiMode}` — a package with nothing to plug into, since no
    // `registerTransport` exists anywhere in this package. Asserting the CODE and the failing mode
    // survives a rewording of the advice; asserting the advice pinned the wrong advice in place.
    expect(() => resolveProviderChain({ primary: "bedrock-needs-transport" })).toThrow(
      /no transport for/,
    );
    try {
      resolveProviderChain({ primary: "bedrock-needs-transport" });
    } catch (err) {
      expect((err as { code?: string }).code).toBe("transport_unavailable");
    }
  });

  it("EC-10: the fallback env var resolves when the preferred one is absent", () => {
    // Renamed to what it proves. Under its old name — "first match wins" — it set ONE of the two env
    // vars, so there was no ordering to observe: `chain.length === 1` shows the fallback is consulted
    // and would survive the profile's list being reversed. The ordering claim is the test below.
    process.env.OPENAI_API_KEY = "openai-key";
    const chain = resolveProviderChain({ primary: "openrouter" });
    expect(chain).toHaveLength(1);
  });

  it("EC-10: with BOTH env vars set, the one the profile declares first wins", () => {
    // The openrouter profile declares `envVars: ["OPENROUTER_API_KEY", "OPENAI_API_KEY"]` with the
    // source comment "Ordered fallback (EC-10): OPENROUTER_API_KEY preferred, OPENAI_API_KEY as
    // compat". Nothing anywhere set both, so that preference had no test at all.
    //
    // Asserted through `_resolveApiKeyForTests`, the seam over the private resolver, and against the
    // profile's OWN envVars array rather than a literal — so reordering the profile fails this, which
    // is the whole point. The other observable place is the Authorization header at stream time, and
    // reaching it for a BUILTIN profile means a real network call: measured, the first version of this
    // test sent a request to openrouter and came back 401.
    process.env.OPENROUTER_API_KEY = "preferred-openrouter-key";
    process.env.OPENAI_API_KEY = "compat-openai-key";

    const profile = OPENROUTER;
    expect(profile.envVars, "the fixture is the real profile, not a copy of it").toEqual([
      "OPENROUTER_API_KEY",
      "OPENAI_API_KEY",
    ]);
    expect(_resolveApiKeyForTests(profile.envVars)).toBe("preferred-openrouter-key");

    // And the other direction, so the assertion above cannot pass by coincidence.
    process.env.OPENROUTER_API_KEY = "";
    expect(
      _resolveApiKeyForTests(profile.envVars),
      "an empty value is not a credential — it falls through to the next var",
    ).toBe("compat-openai-key");
  });

  it("EC-C (D187): authType: 'none' + apiKeys populated → no-op transport + one-shot warn", () => {
    // Register builtins so 'ollama' (authType: "none") is resolvable.
    registerBuiltins();
    const stderrSpy = vi.spyOn(process.stderr, "write");
    stderrSpy.mockClear();

    // First call: 2 apiKeys against ollama → must NOT build a pool; must warn once.
    const chain1 = resolveProviderChain({
      primary: "ollama",
      apiKeys: { ollama: ["k1", "k2"] },
    });
    expect(chain1).toHaveLength(1);
    // Pool path would build PoolAwareLlmClient; non-pool path builds OpenAIClient directly.
    // We assert via warn fire: any stderr call mentioning "authType" or "apiKeys ignored".
    const warnCalls = stderrSpy.mock.calls.filter((args) =>
      String(args[0]).includes("apiKeys ignored"),
    );
    expect(warnCalls.length).toBe(1);

    // Second call: warn must NOT re-fire (one-shot).
    stderrSpy.mockClear();
    const chain2 = resolveProviderChain({
      primary: "ollama",
      apiKeys: { ollama: ["k1", "k2"] },
    });
    expect(chain2).toHaveLength(1);
    const warnCallsAgain = stderrSpy.mock.calls.filter((args) =>
      String(args[0]).includes("apiKeys ignored"),
    );
    expect(warnCallsAgain.length).toBe(0);

    stderrSpy.mockRestore();
  });
});

describe("router — leaked-dialect recovery route flag (theokit#58 follow-up)", () => {
  // In NODE_ENV=test every client is wrapped by FaultInjectingLlmClient (D14);
  // the real transport is on `.inner`.
  // M93 — `RetryingLlmClient` arrived as an outer decorator; unwrap both.
  const unwrap = (client: LlmClient): OpenAIClient => {
    return unwrapDecorators(client) as OpenAIClient;
  };

  it("clones the resolved profile with extractToolCallsFromContent when the route opts in", () => {
    process.env.OPENROUTER_API_KEY = "k1";
    const chain = resolveProviderChain({
      primary: "openrouter",
      extractToolCallsFromContent: true,
    });
    expect(chain).toHaveLength(1);
    expect(unwrap(chain[0] as LlmClient).recoversLeakedToolCalls).toBe(true);
  });

  it("leaves recovery off when the route does not opt in (default-off backward compat)", () => {
    process.env.OPENROUTER_API_KEY = "k1";
    const chain = resolveProviderChain({ primary: "openrouter" });
    expect(chain).toHaveLength(1);
    expect(unwrap(chain[0] as LlmClient).recoversLeakedToolCalls).toBe(false);
  });
});
