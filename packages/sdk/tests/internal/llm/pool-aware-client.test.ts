/**
 * Tests for PoolAwareLlmClient (T3.1, ADRs D125-D127).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationError,
  CredentialPoolExhaustedError,
  NetworkError,
  RateLimitError,
} from "../../../src/errors.js";
import { CredentialPool, newPooledCredential } from "../../../src/internal/llm/credential-pool.js";
import {
  classifyAndDecide,
  PoolAwareLlmClient,
  parseRetryAfterMs,
} from "../../../src/internal/llm/pool-aware-client.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmRequest,
} from "../../../src/internal/llm/types.js";

function poolOf(
  tokens: string[],
  strategy: "fill_first" | "round_robin" = "fill_first",
): CredentialPool {
  return new CredentialPool(
    "openrouter",
    tokens.map((t, i) =>
      newPooledCredential({
        provider: "openrouter",
        accessToken: t,
        priority: i,
        source: "manual",
      }),
    ),
    strategy,
  );
}

interface FakeClientScript {
  // Per-call: emit either a stream OR throw on first .next()
  onCall: (
    apiKey: string,
    callNumber: number,
  ) => "ok" | RateLimitError | AuthenticationError | NetworkError;
}

function buildFakeFactory(script: FakeClientScript): (apiKey: string) => LlmClient {
  let callNumber = 0;
  return (apiKey: string): LlmClient => {
    callNumber += 1;
    const thisCall = callNumber;
    return {
      name: `fake:${apiKey}`,
      async *stream(
        _req: LlmRequest,
        _signal: AbortSignal,
      ): AsyncGenerator<LlmEvent, LlmFinish, void> {
        const verdict = script.onCall(apiKey, thisCall);
        if (verdict !== "ok") throw verdict;
        yield { type: "text_delta", text: `hello from ${apiKey}` };
        return { stopReason: "end_turn", text: `hello from ${apiKey}`, toolCalls: [] };
      },
    };
  };
}

async function drain(
  gen: AsyncGenerator<LlmEvent, LlmFinish, void>,
): Promise<{ events: LlmEvent[]; finish: LlmFinish }> {
  const events: LlmEvent[] = [];
  while (true) {
    const r = await gen.next();
    if (r.done === true) return { events, finish: r.value };
    events.push(r.value);
  }
}

describe("PoolAwareLlmClient (T3.1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes through on first-attempt success", async () => {
    const pool = poolOf(["k1", "k2"]);
    const factory = buildFakeFactory({ onCall: () => "ok" });
    const client = new PoolAwareLlmClient(pool, factory);
    const { finish } = await drain(client.stream({} as LlmRequest, new AbortController().signal));
    expect(finish.text).toContain("k1");
  });

  it("retries same key on first 429", async () => {
    const pool = poolOf(["k1"]);
    let attemptsForK1 = 0;
    const factory = buildFakeFactory({
      onCall: (key) => {
        if (key === "k1" && attemptsForK1 === 0) {
          attemptsForK1 += 1;
          return new RateLimitError("429", {
            metadata: {
              provider: "openrouter",
              endpoint: "/v1",
              code: "rate_limit",
              statusCode: 429,
            },
          });
        }
        return "ok";
      },
    });
    const client = new PoolAwareLlmClient(pool, factory);
    const { finish } = await drain(client.stream({} as LlmRequest, new AbortController().signal));
    expect(finish.text).toContain("k1"); // retried same key, succeeded
  });

  it("rotates on second consecutive 429", async () => {
    const pool = poolOf(["k1", "k2"]);
    const factory = buildFakeFactory({
      onCall: (key) => {
        if (key === "k1") {
          return new RateLimitError("429", {
            metadata: {
              provider: "openrouter",
              endpoint: "/v1",
              code: "rate_limit",
              statusCode: 429,
            },
          });
        }
        return "ok";
      },
    });
    const client = new PoolAwareLlmClient(pool, factory);
    const { finish } = await drain(client.stream({} as LlmRequest, new AbortController().signal));
    expect(finish.text).toContain("k2"); // rotated to k2
  });

  it("rotates immediately on 402 billing", async () => {
    const pool = poolOf(["k1", "k2"]);
    let k1Calls = 0;
    const factory = buildFakeFactory({
      onCall: (key) => {
        if (key === "k1") {
          k1Calls += 1;
          return new RateLimitError("402", {
            metadata: {
              provider: "openrouter",
              endpoint: "/v1",
              code: "rate_limit",
              statusCode: 402,
            },
          });
        }
        return "ok";
      },
    });
    const client = new PoolAwareLlmClient(pool, factory);
    const { finish } = await drain(client.stream({} as LlmRequest, new AbortController().signal));
    expect(k1Calls).toBe(1); // no retry on 402
    expect(finish.text).toContain("k2");
  });

  it("rotates on 401 auth failure", async () => {
    const pool = poolOf(["k1", "k2"]);
    const factory = buildFakeFactory({
      onCall: (key) => {
        if (key === "k1") {
          return new AuthenticationError("401", {
            metadata: {
              provider: "openrouter",
              endpoint: "/v1",
              code: "auth_failed",
              statusCode: 401,
            },
          });
        }
        return "ok";
      },
    });
    const client = new PoolAwareLlmClient(pool, factory);
    const { finish } = await drain(client.stream({} as LlmRequest, new AbortController().signal));
    expect(finish.text).toContain("k2");
  });

  it("throws CredentialPoolExhaustedError when all entries dry", async () => {
    const pool = poolOf(["k1"]);
    const factory = buildFakeFactory({
      onCall: () =>
        new RateLimitError("429", {
          metadata: {
            provider: "openrouter",
            endpoint: "/v1",
            code: "rate_limit",
            statusCode: 429,
          },
        }),
    });
    const client = new PoolAwareLlmClient(pool, factory);
    await expect(
      drain(client.stream({} as LlmRequest, new AbortController().signal)),
    ).rejects.toThrow(CredentialPoolExhaustedError);
  });

  it("propagates NetworkError without rotating", async () => {
    const pool = poolOf(["k1", "k2"]);
    let k2Used = false;
    const factory = buildFakeFactory({
      onCall: (key) => {
        if (key === "k2") k2Used = true;
        return new NetworkError("connection reset", {
          metadata: { provider: "openrouter", endpoint: "/v1", code: "network" },
        });
      },
    });
    const client = new PoolAwareLlmClient(pool, factory);
    await expect(
      drain(client.stream({} as LlmRequest, new AbortController().signal)),
    ).rejects.toThrow(NetworkError);
    expect(k2Used).toBe(false); // didn't rotate
  });

  it("honors retry-after header (seconds)", async () => {
    const pool = poolOf(["k1", "k2"]);
    const factory = buildFakeFactory({
      onCall: (key) => {
        if (key === "k1") {
          return new RateLimitError("429", {
            metadata: {
              provider: "openrouter",
              endpoint: "/v1",
              code: "rate_limit",
              statusCode: 429,
              retryAfter: 30, // 30 seconds
            },
          });
        }
        return "ok";
      },
    });
    const client = new PoolAwareLlmClient(pool, factory);
    await drain(client.stream({} as LlmRequest, new AbortController().signal));
    // k1 should be in cooldown for ~30s
    const k1 = pool.list().find((e) => e.accessToken === "k1");
    expect(k1?.lastStatus).toBe("exhausted");
    const expectedReset = Date.now() + 30 * 1000;
    expect(k1?.lastErrorResetAt).toBeGreaterThanOrEqual(expectedReset - 100);
    expect(k1?.lastErrorResetAt).toBeLessThanOrEqual(expectedReset + 100);
  });

  it("no rotation after first event yielded (mid-stream 429 propagates)", async () => {
    const pool = poolOf(["k1", "k2"]);
    const factory = (apiKey: string): LlmClient => ({
      name: `fake:${apiKey}`,
      async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
        yield { type: "text_delta", text: "starting..." };
        throw new RateLimitError("mid-stream 429", {
          metadata: {
            provider: "openrouter",
            endpoint: "/v1",
            code: "rate_limit",
            statusCode: 429,
          },
        });
      },
    });
    const client = new PoolAwareLlmClient(pool, factory);
    await expect(
      drain(client.stream({} as LlmRequest, new AbortController().signal)),
    ).rejects.toThrow(RateLimitError);
  });

  it("aborts on signal between retries", async () => {
    const pool = poolOf(["k1", "k2"]);
    const controller = new AbortController();
    const factory = buildFakeFactory({
      onCall: (key) => {
        if (key === "k1") {
          controller.abort(new Error("user cancelled"));
          return new RateLimitError("429", {
            metadata: {
              provider: "openrouter",
              endpoint: "/v1",
              code: "rate_limit",
              statusCode: 429,
            },
          });
        }
        return "ok";
      },
    });
    const client = new PoolAwareLlmClient(pool, factory);
    await expect(drain(client.stream({} as LlmRequest, controller.signal))).rejects.toThrow();
  });

  it("CredentialPoolExhaustedError has metadata", async () => {
    const pool = poolOf(["k1"]);
    const factory = buildFakeFactory({
      onCall: () =>
        new RateLimitError("429", {
          metadata: {
            provider: "openrouter",
            endpoint: "/v1",
            code: "rate_limit",
            statusCode: 429,
            retryAfter: 60,
          },
        }),
    });
    const client = new PoolAwareLlmClient(pool, factory);
    try {
      await drain(client.stream({} as LlmRequest, new AbortController().signal));
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialPoolExhaustedError);
      expect((err as CredentialPoolExhaustedError).provider).toBe("openrouter");
      expect((err as CredentialPoolExhaustedError).nextRetryAt).toBeGreaterThan(Date.now());
    }
  });

  // EC-A: persistence failure during rotate must not abort the stream
  it("continues when persist fails during rotate (EC-A)", async () => {
    const pool = poolOf(["k1", "k2"]);
    const stderrSpy = vi.spyOn(process.stderr, "write");
    // Monkey-patch markExhaustedAndRotate to throw on first invocation.
    const original = pool.markExhaustedAndRotate.bind(pool);
    let invoked = 0;
    pool.markExhaustedAndRotate = async (args) => {
      invoked += 1;
      if (invoked === 1) {
        throw new Error("simulated disk full");
      }
      return original(args);
    };
    const factory = buildFakeFactory({
      onCall: (key) => {
        if (key === "k1") {
          return new RateLimitError("402", {
            metadata: {
              provider: "openrouter",
              endpoint: "/v1",
              code: "rate_limit",
              statusCode: 402,
            },
          });
        }
        return "ok";
      },
    });
    const client = new PoolAwareLlmClient(pool, factory);
    // Even though markExhaustedAndRotate threw, the stream should continue.
    // Note: because rotate threw, pool state isn't updated → k1 still picked next.
    // BUT the wrapper falls through to the next loop iteration and re-selects.
    // Since fill_first picks k1 again (still "ok"), it hits 402 again, tries to
    // rotate (now original works), and rotates to k2.
    const { finish } = await drain(client.stream({} as LlmRequest, new AbortController().signal));
    expect(finish.text).toContain("k2");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("persist failed"));
    stderrSpy.mockRestore();
  });

  // EC-D: buildClient throw propagates without rotating
  it("propagates buildClient errors without rotating (EC-D)", async () => {
    const pool = poolOf(["k1", "k2"]);
    const factory = (_apiKey: string): LlmClient => {
      throw new Error("invalid baseUrl");
    };
    const client = new PoolAwareLlmClient(pool, factory);
    await expect(
      drain(client.stream({} as LlmRequest, new AbortController().signal)),
    ).rejects.toThrow("invalid baseUrl");
    // k1 should NOT be marked exhausted — build failures aren't credential failures.
    expect(pool.list()[0]?.lastStatus).toBe("ok");
  });
});

describe("classifyAndDecide (pure helper)", () => {
  function rate(status: number): RateLimitError {
    return new RateLimitError("rl", {
      metadata: { provider: "x", endpoint: "/v1", code: "rate_limit", statusCode: status },
    });
  }
  function auth(): AuthenticationError {
    return new AuthenticationError("auth", {
      metadata: { provider: "x", endpoint: "/v1", code: "auth_failed", statusCode: 401 },
    });
  }
  function net(): NetworkError {
    return new NetworkError("net", {
      metadata: { provider: "x", endpoint: "/v1", code: "network" },
    });
  }

  it("429 + hasRetried=false → retry", () => {
    expect(classifyAndDecide(rate(429), false)).toBe("retry");
  });
  it("429 + hasRetried=true → rotate", () => {
    expect(classifyAndDecide(rate(429), true)).toBe("rotate");
  });
  it("402 → rotate (no retry)", () => {
    expect(classifyAndDecide(rate(402), false)).toBe("rotate");
  });
  it("401 → rotate", () => {
    expect(classifyAndDecide(auth(), false)).toBe("rotate");
  });
  it("NetworkError → propagate", () => {
    expect(classifyAndDecide(net(), false)).toBe("propagate");
  });
});

describe("parseRetryAfterMs (pure helper)", () => {
  it("returns Date.now() + seconds for numeric retryAfter", () => {
    const before = Date.now();
    const err = new RateLimitError("rl", {
      metadata: { provider: "x", endpoint: "/v1", code: "rate_limit", retryAfter: 5 },
    });
    const parsed = parseRetryAfterMs(err);
    expect(parsed).toBeGreaterThanOrEqual(before + 5000 - 50);
    expect(parsed).toBeLessThanOrEqual(before + 5000 + 50);
  });
  it("returns undefined when retryAfter missing", () => {
    const err = new RateLimitError("rl", {
      metadata: { provider: "x", endpoint: "/v1", code: "rate_limit" },
    });
    expect(parseRetryAfterMs(err)).toBeUndefined();
  });
  it("returns undefined when retryAfter is zero or negative", () => {
    const err = new RateLimitError("rl", {
      metadata: { provider: "x", endpoint: "/v1", code: "rate_limit", retryAfter: 0 },
    });
    expect(parseRetryAfterMs(err)).toBeUndefined();
  });
});
