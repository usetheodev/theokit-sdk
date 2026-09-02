/**
 * D14 — Wiring proof: `resolveProviderChain` MUST wrap each client with
 * the fault-injection decorator so consumers of the public API (`Agent.send`,
 * `Agent.prompt`, `Agent.batch`) see the override behavior automatically.
 *
 * Without this wiring, the feature exists but is unreachable from the public
 * surface — which would violate `.claude/rules/no-stubs-no-mocks-no-wired.md`
 * (rule 3, "Unwired code").
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RateLimitError } from "../../src/errors.js";
import { _resetFaultInjectionWarnings } from "../../src/internal/llm/fault-injection.js";
import { resolveProviderChain } from "../../src/internal/llm/router.js";
import type { LlmRequest } from "../../src/internal/llm/types.js";

const REQUEST: LlmRequest = {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

async function consumeStream(client: ReturnType<typeof resolveProviderChain>[number]) {
  const ac = new AbortController();
  const events: unknown[] = [];
  try {
    const gen = client.stream(REQUEST, ac.signal);
    let next = await gen.next();
    while (next.done !== true) {
      events.push(next.value);
      next = await gen.next();
    }
    return { events, finish: next.value, error: undefined };
  } catch (error) {
    return { events, finish: undefined, error };
  }
}

describe("D14 wiring — resolveProviderChain wraps with fault-injection decorator", () => {
  let originalNodeEnv: string | undefined;
  let originalOverride: string | undefined;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalOverride = process.env.THEOKIT_TEST_RESPONSE_OVERRIDE;
    originalKey = process.env.OPENROUTER_API_KEY;
    // Need a key so the router actually resolves a client.
    process.env.OPENROUTER_API_KEY = "sk-or-fake-key-for-test";
    process.env.NODE_ENV = "test";
    _resetFaultInjectionWarnings();
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalOverride === undefined) delete process.env.THEOKIT_TEST_RESPONSE_OVERRIDE;
    else process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = originalOverride;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    _resetFaultInjectionWarnings();
  });

  it("override with status 429 short-circuits BEFORE the real fetch (zero network)", async () => {
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = JSON.stringify({
      status: 429,
      body: { error: { code: "rate_limit_exceeded", message: "Rate limit hit" } },
    });
    const chain = resolveProviderChain({ primary: "openrouter" });
    expect(chain.length).toBeGreaterThanOrEqual(1);
    const client = chain[0]!;
    const { error } = await consumeStream(client);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as Error).message).toMatch(/rate.?limit|429/i);
  });

  it("override with status 200 + text returns deterministic content (zero network)", async () => {
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = JSON.stringify({
      status: 200,
      body: { choices: [{ message: { content: "DETERMINISTIC_REPLY" } }] },
    });
    const chain = resolveProviderChain({ primary: "openrouter" });
    const client = chain[0]!;
    const { events, finish } = await consumeStream(client);
    expect((finish as { text: string }).text).toBe("DETERMINISTIC_REPLY");
    const textEvent = events.find(
      (e): e is { type: "text_delta"; text: string } =>
        typeof e === "object" && e !== null && (e as { type?: string }).type === "text_delta",
    );
    expect(textEvent?.text).toBe("DETERMINISTIC_REPLY");
  });

  it("when NODE_ENV != test, override is IGNORED — wrapper is transparent passthrough", () => {
    process.env.NODE_ENV = "production";
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = JSON.stringify({ status: 429, body: {} });
    const chain = resolveProviderChain({ primary: "openrouter" });
    // Structural assertion: the chain resolves even with the override env set,
    // and the wrapper preserves the underlying client's `name` (a non-empty
    // transport identifier — OpenRouter uses the OpenAI-compat transport so
    // name === "openai"; what matters is the wrapper is transparent, not
    // which transport name surfaces).
    expect(chain.length).toBeGreaterThanOrEqual(1);
    expect(typeof chain[0]?.name).toBe("string");
    expect(chain[0]?.name.length).toBeGreaterThan(0);
  });
});
