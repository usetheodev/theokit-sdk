import { describe, expect, it } from "vitest";

import { AuthenticationError, NetworkError, RateLimitError } from "../../../src/errors.js";
import { FallbackLlmClient } from "../../../src/internal/llm/fallback-client.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmRequest,
} from "../../../src/internal/llm/types.js";

/**
 * Behaviour gate for the failover-on-error wrapper. Pure unit-level tests —
 * each fake client is a tiny async generator that either yields canned events
 * or throws a `NetworkError` from its first `.next()`.
 */

function clientThatYields(name: string, events: LlmEvent[], finish: LlmFinish): LlmClient {
  return {
    name,
    async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
      for (const ev of events) yield ev;
      return finish;
    },
  };
}

function generatorThatRejectsFirstNext(
  build: () => Error,
): AsyncGenerator<LlmEvent, LlmFinish, void> {
  const reject = (): Promise<never> => Promise.reject(build());
  const gen: AsyncGenerator<LlmEvent, LlmFinish, void> = {
    next: reject,
    return: () => Promise.resolve({ done: true, value: undefined as unknown as LlmFinish }),
    throw: reject,
    [Symbol.asyncIterator]() {
      return this;
    },
    [Symbol.asyncDispose]: () => Promise.resolve(),
  };
  return gen;
}

function clientThatHandshakeFails(name: string, status = 401): LlmClient {
  return {
    name,
    stream: () =>
      generatorThatRejectsFirstNext(
        () => new NetworkError(`stub ${name} returned ${status}`, { code: `${name}_http_error` }),
      ),
  };
}

function clientThatYieldsThenThrows(name: string): LlmClient {
  return {
    name,
    async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
      yield { type: "text_delta", text: "partial" };
      throw new NetworkError(`mid-stream failure from ${name}`, { code: "mid_stream_error" });
    },
  };
}

async function collect(
  client: LlmClient,
  signal: AbortSignal,
): Promise<{ events: LlmEvent[]; finish?: LlmFinish; error?: unknown }> {
  const events: LlmEvent[] = [];
  const request: LlmRequest = { model: "x", messages: [] };
  try {
    const gen = client.stream(request, signal);
    while (true) {
      const n = await gen.next();
      if (n.done === true) {
        return { events, finish: n.value };
      }
      events.push(n.value);
    }
  } catch (cause) {
    return { events, error: cause };
  }
}

const baseFinish: LlmFinish = { stopReason: "end_turn", text: "ok", toolCalls: [] };

describe("FallbackLlmClient", () => {
  it("uses the primary when the primary succeeds", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const primary: LlmClient = {
      name: "primary",
      async *stream() {
        primaryCalls += 1;
        yield { type: "text_delta", text: "P" };
        return baseFinish;
      },
    };
    const fallback: LlmClient = {
      name: "fallback",
      async *stream() {
        fallbackCalls += 1;
        yield { type: "text_delta", text: "F" };
        return baseFinish;
      },
    };
    const wrapped = new FallbackLlmClient([primary, fallback]);
    const r = await collect(wrapped, new AbortController().signal);
    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(0);
    expect(r.events.map((e) => (e.type === "text_delta" ? e.text : ""))).toEqual(["P"]);
  });

  it("falls back to the next client when the primary handshake throws NetworkError", async () => {
    let fallbackCalls = 0;
    const primary = clientThatHandshakeFails("primary");
    const fallback: LlmClient = {
      name: "fallback",
      async *stream() {
        fallbackCalls += 1;
        yield { type: "text_delta", text: "F" };
        return baseFinish;
      },
    };
    const wrapped = new FallbackLlmClient([primary, fallback]);
    const r = await collect(wrapped, new AbortController().signal);
    expect(fallbackCalls).toBe(1);
    expect(r.events.map((e) => (e.type === "text_delta" ? e.text : ""))).toEqual(["F"]);
    expect(r.error).toBeUndefined();
  });

  it("does NOT fall back when the primary fails mid-stream", async () => {
    let fallbackCalls = 0;
    const primary = clientThatYieldsThenThrows("primary");
    const fallback: LlmClient = {
      name: "fallback",
      async *stream() {
        fallbackCalls += 1;
        yield { type: "text_delta", text: "F" };
        return baseFinish;
      },
    };
    const wrapped = new FallbackLlmClient([primary, fallback]);
    const r = await collect(wrapped, new AbortController().signal);
    expect(fallbackCalls).toBe(0);
    expect(r.events.map((e) => (e.type === "text_delta" ? e.text : ""))).toEqual(["partial"]);
    expect(r.error).toBeInstanceOf(NetworkError);
  });

  it("rethrows the LAST NetworkError when every client in the chain fails", async () => {
    const primary = clientThatHandshakeFails("primary", 401);
    const fallback = clientThatHandshakeFails("fallback", 500);
    const wrapped = new FallbackLlmClient([primary, fallback]);
    const r = await collect(wrapped, new AbortController().signal);
    expect(r.error).toBeInstanceOf(NetworkError);
    expect((r.error as NetworkError).message).toContain("500");
  });

  // EC-4 from edge-case review: router aggregate failure should surface
  // the LAST provider's metadata so debugging is not a black box.
  it("EC-4: aggregate failure surfaces metadata of the last provider tried", async () => {
    // Primary throws RateLimitError (mapped 429), fallback throws
    // AuthenticationError (mapped 401). Last error = AuthenticationError.
    const primary: LlmClient = {
      name: "primary",
      stream: () =>
        generatorThatRejectsFirstNext(
          () =>
            new RateLimitError("primary rate limited", {
              code: "openai_rate_limit",
              metadata: {
                provider: "openai",
                endpoint: "/v1/chat/completions",
                code: "rate_limit",
                statusCode: 429,
                retryAfter: 60,
              },
            }),
        ),
    };
    const fallback: LlmClient = {
      name: "fallback",
      stream: () =>
        generatorThatRejectsFirstNext(
          () =>
            new AuthenticationError("fallback bad key", {
              code: "anthropic_auth_failed",
              metadata: {
                provider: "anthropic",
                endpoint: "/v1/messages",
                code: "auth_failed",
                statusCode: 401,
              },
            }),
        ),
    };
    const wrapped = new FallbackLlmClient([primary, fallback]);
    const r = await collect(wrapped, new AbortController().signal);
    expect(r.error).toBeInstanceOf(AuthenticationError);
    expect((r.error as AuthenticationError).metadata?.provider).toBe("anthropic");
    expect((r.error as AuthenticationError).metadata?.code).toBe("auth_failed");
  });

  it("falls back when primary throws RateLimitError (post-T2.1 mapper refinement)", async () => {
    let fallbackCalls = 0;
    const primary: LlmClient = {
      name: "primary",
      stream: () =>
        generatorThatRejectsFirstNext(
          () => new RateLimitError("primary 429", { code: "primary_rate_limit" }),
        ),
    };
    const fallback: LlmClient = {
      name: "fallback",
      async *stream() {
        fallbackCalls += 1;
        yield { type: "text_delta", text: "F" };
        return baseFinish;
      },
    };
    const wrapped = new FallbackLlmClient([primary, fallback]);
    const r = await collect(wrapped, new AbortController().signal);
    expect(fallbackCalls).toBe(1);
    expect(r.error).toBeUndefined();
  });

  it("falls back when primary throws AuthenticationError (post-T2.1 mapper refinement)", async () => {
    let fallbackCalls = 0;
    const primary: LlmClient = {
      name: "primary",
      stream: () =>
        generatorThatRejectsFirstNext(
          () => new AuthenticationError("primary 401", { code: "primary_auth_failed" }),
        ),
    };
    const fallback: LlmClient = {
      name: "fallback",
      async *stream() {
        fallbackCalls += 1;
        yield { type: "text_delta", text: "F" };
        return baseFinish;
      },
    };
    const wrapped = new FallbackLlmClient([primary, fallback]);
    const r = await collect(wrapped, new AbortController().signal);
    expect(fallbackCalls).toBe(1);
    expect(r.error).toBeUndefined();
  });

  it("skips the fallback HTTP call when the abort signal is already aborted (EC-3)", async () => {
    let fallbackCalls = 0;
    const controller = new AbortController();
    const abortAndFail = (): AsyncGenerator<LlmEvent, LlmFinish, void> =>
      generatorThatRejectsFirstNext(() => {
        controller.abort();
        return new NetworkError("primary 401", { code: "primary_401" });
      });
    const fallback: LlmClient = {
      name: "fallback",
      async *stream() {
        fallbackCalls += 1;
        yield { type: "text_delta", text: "F" };
        return baseFinish;
      },
    };
    const wrapped = new FallbackLlmClient([
      { name: "fail-and-abort", stream: () => abortAndFail() },
      fallback,
    ]);
    const r = await collect(wrapped, controller.signal);
    expect(fallbackCalls).toBe(0);
    expect(r.error).toBeInstanceOf(Error);
  });

  it("exposes a single client unchanged when the chain has length 1", async () => {
    const single = clientThatYields("only", [{ type: "text_delta", text: "Z" }], baseFinish);
    const wrapped = new FallbackLlmClient([single]);
    const r = await collect(wrapped, new AbortController().signal);
    expect(r.events.map((e) => (e.type === "text_delta" ? e.text : ""))).toEqual(["Z"]);
    expect(r.error).toBeUndefined();
  });
});
