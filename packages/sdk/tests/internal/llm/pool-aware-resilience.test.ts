/**
 * M2 #60 — RED-first: the pool 429 path must back off with full jitter before
 * retrying (no <1ms burn), and a circuit breaker must open after N consecutive
 * terminal failures and fail fast until a cooldown elapses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError, RateLimitError } from "../../../src/errors.js";
import { CredentialPool, newPooledCredential } from "../../../src/internal/llm/credential-pool.js";
import { PoolAwareLlmClient } from "../../../src/internal/llm/pool-aware-client.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmRequest,
} from "../../../src/internal/llm/types.js";
import { CircuitBreaker } from "../../../src/internal/runtime/retry/circuit-breaker.js";

function poolOf(tokens: string[]): CredentialPool {
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
    "fill_first",
  );
}

function rate429(): RateLimitError {
  return new RateLimitError("429", {
    metadata: { provider: "openrouter", endpoint: "/v1", code: "rate_limit", statusCode: 429 },
  });
}

function okFactory(
  script: (key: string, call: number) => "ok" | RateLimitError,
): (apiKey: string) => LlmClient {
  let call = 0;
  return (apiKey: string): LlmClient => {
    call += 1;
    const thisCall = call;
    return {
      name: `fake:${apiKey}`,
      async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
        const verdict = script(apiKey, thisCall);
        if (verdict !== "ok") throw verdict;
        yield { type: "text_delta", text: `hi ${apiKey}` };
        return { stopReason: "end_turn", text: `hi ${apiKey}`, toolCalls: [] };
      },
    };
  };
}

async function drain(gen: AsyncGenerator<LlmEvent, LlmFinish, void>): Promise<LlmFinish> {
  while (true) {
    const r = await gen.next();
    if (r.done === true) return r.value;
  }
}

describe("M2 #60 — pool 429 full-jitter backoff", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sleeps a full-jitter backoff before retrying the same key (no immediate re-hit)", async () => {
    const pool = poolOf(["k1"]);
    // k1: 429 on the first call, ok on the retry.
    const factory = okFactory((_key, call) => (call === 1 ? rate429() : "ok"));
    // deterministic rng → backoff = floor(0.5 * min(cap, base*2^0)) with base 400 → 200ms.
    const client = new PoolAwareLlmClient(pool, factory, 30_000, {
      backoffBaseMs: 400,
      rng: () => 0.5,
    });
    const p = drain(client.stream({} as LlmRequest, new AbortController().signal));
    // Before the backoff elapses the retry must NOT have fired: still pending.
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(100); // < 200ms backoff
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(300); // now past the 200ms backoff
    const finish = await p;
    expect(finish.text).toContain("k1");
  });

  it("SE2 — invokes onRateLimit before backing off a 429 retry", async () => {
    const pool = poolOf(["k1"]);
    const factory = okFactory((_key, call) => (call === 1 ? rate429() : "ok"));
    const calls: Array<{ attempt: number; retryAfterMs?: number }> = [];
    const client = new PoolAwareLlmClient(pool, factory, 30_000, {
      backoffBaseMs: 400,
      rng: () => 0.5,
      onRateLimit: (info) => calls.push(info),
    });
    await vi.advanceTimersByTimeAsync(0);
    const p = drain(client.stream({} as LlmRequest, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(500); // past the 200ms backoff → retry completes
    await p;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.attempt).toBe(1);
  });
});

// The breaker is exercised via the NetworkError → "propagate" path: a NetworkError
// propagates WITHOUT marking the pool key exhausted, so the pool stays available
// across attempts and the breaker (not pool exhaustion) is the unit under test.
function netFail(): NetworkError {
  return new NetworkError("connection reset", {
    metadata: { provider: "openrouter", endpoint: "/v1", code: "network" },
  });
}

describe("M2 #60 — circuit breaker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens after N consecutive terminal failures and fails fast without hitting the transport", async () => {
    const pool = poolOf(["k1"]);
    let transportCalls = 0;
    const factory = (apiKey: string): LlmClient => ({
      name: `fake:${apiKey}`,
      // biome-ignore lint/correctness/useYield: intentional throw-before-yield to model a pre-stream failure.
      async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
        transportCalls += 1;
        throw netFail();
      },
    });
    const breaker = new CircuitBreaker({ maxTimeouts: 2, cooldownMs: 30_000, now: () => 0 });
    const client = new PoolAwareLlmClient(pool, factory, 0, { backoffBaseMs: 0, breaker });

    // First two calls fail terminally (each records a breaker failure).
    for (let i = 0; i < 2; i++) {
      await expect(
        drain(client.stream({} as LlmRequest, new AbortController().signal)),
      ).rejects.toThrow(NetworkError);
    }
    const callsBeforeOpen = transportCalls;
    // Breaker is now open → the third call fails fast with circuit_open, no transport hit.
    await expect(
      drain(client.stream({} as LlmRequest, new AbortController().signal)),
    ).rejects.toThrow(/circuit/i);
    expect(transportCalls).toBe(callsBeforeOpen); // transport not called while open
  });

  it("allows a probe after the cooldown elapses (half-open)", async () => {
    const pool = poolOf(["k1"]);
    let phase: "fail" | "ok" = "fail";
    let transportCalls = 0;
    const factory = (apiKey: string): LlmClient => ({
      name: `fake:${apiKey}`,
      async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
        transportCalls += 1;
        if (phase === "fail") throw netFail();
        yield { type: "text_delta", text: `hi ${apiKey}` };
        return { stopReason: "end_turn", text: `hi ${apiKey}`, toolCalls: [] };
      },
    });
    let clock = 0;
    const breaker = new CircuitBreaker({ maxTimeouts: 1, cooldownMs: 10_000, now: () => clock });
    const client = new PoolAwareLlmClient(pool, factory, 0, { backoffBaseMs: 0, breaker });

    await expect(
      drain(client.stream({} as LlmRequest, new AbortController().signal)),
    ).rejects.toThrow(NetworkError);
    const openCalls = transportCalls;
    // Open now: a call during cooldown fails fast (no transport hit).
    await expect(
      drain(client.stream({} as LlmRequest, new AbortController().signal)),
    ).rejects.toThrow(/circuit/i);
    expect(transportCalls).toBe(openCalls);
    // Advance the breaker clock past cooldown; provider now healthy → probe succeeds.
    clock = 20_000;
    phase = "ok";
    const finish = await drain(client.stream({} as LlmRequest, new AbortController().signal));
    expect(finish.text).toContain("k1");
  });
});

describe("M2 #60 — circuit_open is a typed NetworkError", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("throws NetworkError code=circuit_open when the breaker is open", async () => {
    const pool = poolOf(["k1"]);
    const factory = (apiKey: string): LlmClient => ({
      name: `fake:${apiKey}`,
      // biome-ignore lint/correctness/useYield: intentional throw-before-yield to model a pre-stream failure.
      async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
        throw netFail();
      },
    });
    const breaker = new CircuitBreaker({ maxTimeouts: 1, cooldownMs: 60_000, now: () => 0 });
    const client = new PoolAwareLlmClient(pool, factory, 0, { backoffBaseMs: 0, breaker });
    await expect(
      drain(client.stream({} as LlmRequest, new AbortController().signal)),
    ).rejects.toThrow(NetworkError);
    try {
      await drain(client.stream({} as LlmRequest, new AbortController().signal));
      expect.fail("should have thrown circuit_open");
    } catch (err) {
      expect(err).toBeInstanceOf(NetworkError);
      expect((err as NetworkError).code).toBe("circuit_open");
    }
  });
});
