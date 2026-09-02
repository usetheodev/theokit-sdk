/**
 * D14 — Fault injection via `THEOKIT_TEST_RESPONSE_OVERRIDE` env var.
 *
 * Chaos-test determinism: replaces a real provider hit with a response
 * synthesized from JSON in an env var. Gated by `NODE_ENV=test` so
 * prevent accidental use in production (FAANG fail-safe).
 *
 * Mandatory BDD coverage:
 *   - Gate: NODE_ENV != "test" → noop (no fault injection enabled)
 *   - Gate: env var absent / empty → noop
 *   - Gate: invalid JSON -> one-shot stderr warn + noop (graceful)
 *   - Active: status 200 + text content → yield text_delta + stop end_turn
 *   - Active: status 429 → throw RateLimitError com providerId
 *   - Active: status 401 → throw AuthenticationError
 *   - Active: status 500 → throw NetworkError (server_error)
 *   - Active: status 400 → throw ConfigurationError
 *   - Idempotent: multiple calls with the same override produce the same output
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AuthenticationError,
  ConfigurationError,
  NetworkError,
  RateLimitError,
} from "../../src/errors.js";
import {
  _resetFaultInjectionWarnings,
  maybeWrapWithFaultInjection,
} from "../../src/internal/llm/fault-injection.js";
import type { LlmClient, LlmRequest } from "../../src/internal/llm/types.js";

class StubRealClient implements LlmClient {
  readonly name: string;
  public callCount = 0;
  constructor(name: string) {
    this.name = name;
  }
  async *stream(_request: LlmRequest, _signal: AbortSignal) {
    this.callCount += 1;
    yield { type: "text_delta" as const, text: "REAL_LLM_CALLED" };
    return {
      stopReason: "end_turn" as const,
      text: "REAL_LLM_CALLED",
      toolCalls: [],
      inputTokens: 1,
      outputTokens: 1,
    };
  }
}

const REQUEST: LlmRequest = {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

function consumeAll(
  client: LlmClient,
): Promise<{ events: unknown[]; finish: unknown | undefined; error: unknown | undefined }> {
  return (async () => {
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
  })();
}

describe("D14 — fault injection gate", () => {
  let originalNodeEnv: string | undefined;
  let originalOverride: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalOverride = process.env.THEOKIT_TEST_RESPONSE_OVERRIDE;
    delete process.env.NODE_ENV;
    delete process.env.THEOKIT_TEST_RESPONSE_OVERRIDE;
    _resetFaultInjectionWarnings();
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalOverride === undefined) delete process.env.THEOKIT_TEST_RESPONSE_OVERRIDE;
    else process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = originalOverride;
    _resetFaultInjectionWarnings();
  });

  it("returns the real client unchanged when NODE_ENV is not test", async () => {
    // Given: env var set but NODE_ENV is production
    process.env.NODE_ENV = "production";
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = '{"status":429,"body":{"error":{"code":"x"}}}';
    const real = new StubRealClient("openai");
    // When: wrap and call
    const wrapped = maybeWrapWithFaultInjection(real);
    const { events, error } = await consumeAll(wrapped);
    // Then: real client was called (fault injection NOT activated)
    expect(real.callCount).toBe(1);
    expect(error).toBeUndefined();
    expect(events.length).toBeGreaterThan(0);
  });

  it("returns the real client unchanged when env var is unset", async () => {
    process.env.NODE_ENV = "test";
    const real = new StubRealClient("openai");
    const wrapped = maybeWrapWithFaultInjection(real);
    await consumeAll(wrapped);
    expect(real.callCount).toBe(1);
  });

  it("returns the real client unchanged when env var is empty string", async () => {
    process.env.NODE_ENV = "test";
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = "";
    const real = new StubRealClient("openai");
    const wrapped = maybeWrapWithFaultInjection(real);
    await consumeAll(wrapped);
    expect(real.callCount).toBe(1);
  });

  it("falls back to real client + one-shot stderr warn when JSON is invalid", async () => {
    process.env.NODE_ENV = "test";
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = "{not valid json";
    const real = new StubRealClient("openai");
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      const wrapped = maybeWrapWithFaultInjection(real);
      await consumeAll(wrapped);
      // Second call should NOT re-warn (one-shot)
      await consumeAll(wrapped);
    } finally {
      process.stderr.write = origWrite;
    }
    expect(real.callCount).toBe(2); // real client always called when injection inactive
    const warnLines = stderrChunks.filter((c) => c.includes("THEOKIT_TEST_RESPONSE_OVERRIDE"));
    expect(warnLines.length).toBe(1);
  });
});

describe("D14 — fault injection active (status 200, text response)", () => {
  let originalNodeEnv: string | undefined;
  let originalOverride: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalOverride = process.env.THEOKIT_TEST_RESPONSE_OVERRIDE;
    process.env.NODE_ENV = "test";
    _resetFaultInjectionWarnings();
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalOverride === undefined) delete process.env.THEOKIT_TEST_RESPONSE_OVERRIDE;
    else process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = originalOverride;
    _resetFaultInjectionWarnings();
  });

  it("yields a text_delta from body.choices[0].message.content + stop end_turn", async () => {
    // Given: 200 OK with OpenAI-shaped response body
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = JSON.stringify({
      status: 200,
      body: {
        choices: [{ message: { content: "hello from override" } }],
      },
    });
    const real = new StubRealClient("openai");
    // When: stream
    const wrapped = maybeWrapWithFaultInjection(real);
    const { events, finish } = await consumeAll(wrapped);
    // Then: real client NOT called; deterministic events
    expect(real.callCount).toBe(0);
    // theokit#144: one event, not two — the injected stream no longer echoes a trailing `stop`
    // event nobody read. The stop reason is asserted on the finish value below.
    expect(events).toHaveLength(1);
    const textEvent = events.find(
      (e): e is { type: "text_delta"; text: string } =>
        typeof e === "object" && e !== null && (e as { type?: string }).type === "text_delta",
    );
    expect(textEvent?.text).toBe("hello from override");
    expect((finish as { stopReason: string }).stopReason).toBe("end_turn");
    expect((finish as { text: string }).text).toBe("hello from override");
  });

  it("accepts plain string body as text response", async () => {
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = JSON.stringify({
      status: 200,
      body: "raw text body",
    });
    const real = new StubRealClient("openai");
    const wrapped = maybeWrapWithFaultInjection(real);
    const { events, finish } = await consumeAll(wrapped);
    expect(real.callCount).toBe(0);
    const textEvent = events.find(
      (e): e is { type: "text_delta"; text: string } =>
        typeof e === "object" && e !== null && (e as { type?: string }).type === "text_delta",
    );
    expect(textEvent?.text).toBe("raw text body");
    expect((finish as { text: string }).text).toBe("raw text body");
  });
});

describe("D14 — fault injection active (error statuses → typed errors)", () => {
  let originalNodeEnv: string | undefined;
  let originalOverride: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalOverride = process.env.THEOKIT_TEST_RESPONSE_OVERRIDE;
    process.env.NODE_ENV = "test";
    _resetFaultInjectionWarnings();
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalOverride === undefined) delete process.env.THEOKIT_TEST_RESPONSE_OVERRIDE;
    else process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = originalOverride;
    _resetFaultInjectionWarnings();
  });

  it("throws RateLimitError on status 429", async () => {
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = JSON.stringify({
      status: 429,
      body: { error: { code: "rate_limit_exceeded", message: "Rate limit hit; retry in 60s" } },
    });
    const real = new StubRealClient("openai");
    const wrapped = maybeWrapWithFaultInjection(real);
    const { error } = await consumeAll(wrapped);
    expect(real.callCount).toBe(0);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as Error).message).toMatch(/rate.?limit|429/i);
  });

  it("throws AuthenticationError on status 401", async () => {
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = JSON.stringify({
      status: 401,
      body: { error: { code: "invalid_api_key" } },
    });
    const real = new StubRealClient("openai");
    const wrapped = maybeWrapWithFaultInjection(real);
    const { error } = await consumeAll(wrapped);
    expect(error).toBeInstanceOf(AuthenticationError);
  });

  it("throws NetworkError on status 500", async () => {
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = JSON.stringify({
      status: 500,
      body: { error: { code: "internal_error" } },
    });
    const real = new StubRealClient("openai");
    const wrapped = maybeWrapWithFaultInjection(real);
    const { error } = await consumeAll(wrapped);
    expect(error).toBeInstanceOf(NetworkError);
  });

  it("throws ConfigurationError on status 400", async () => {
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = JSON.stringify({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    const real = new StubRealClient("openai");
    const wrapped = maybeWrapWithFaultInjection(real);
    const { error } = await consumeAll(wrapped);
    expect(error).toBeInstanceOf(ConfigurationError);
  });

  it("idempotent — second consume with same override yields identical output", async () => {
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = JSON.stringify({
      status: 200,
      body: { choices: [{ message: { content: "deterministic" } }] },
    });
    const real = new StubRealClient("openai");
    const wrapped = maybeWrapWithFaultInjection(real);
    const first = await consumeAll(wrapped);
    const second = await consumeAll(wrapped);
    expect((first.finish as { text: string }).text).toBe((second.finish as { text: string }).text);
    expect(real.callCount).toBe(0);
  });

  it("preserves the underlying client.name for telemetry", () => {
    process.env.THEOKIT_TEST_RESPONSE_OVERRIDE = JSON.stringify({
      status: 200,
      body: "x",
    });
    const real = new StubRealClient("openrouter");
    const wrapped = maybeWrapWithFaultInjection(real);
    expect(wrapped.name).toBe("openrouter");
  });
});
