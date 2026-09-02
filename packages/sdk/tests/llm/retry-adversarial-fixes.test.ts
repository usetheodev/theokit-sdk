/**
 * M93 — the fixes from adversarial review.
 *
 * Every test here kills a mutant the review measured SURVIVING the original suite:
 * B1 (partial stream replay), H3 (regex over text), H4 (double counting), M2 (Retry-After,
 * sleep and abort guard all removable without failing anything).
 */
import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  ConfigurationError,
  CredentialPoolExhaustedError,
  NetworkError,
  RateLimitError,
} from "../../src/errors.js";
import { isRetriableError, RetryingLlmClient } from "../../src/internal/llm/retrying-client.js";
import type { LlmClient, LlmEvent, LlmRequest } from "../../src/internal/llm/types.js";

/** `ErrorMetadata` requires provider/endpoint/code; only the status matters for these tests. */
const META = (statusCode: number) => ({
  provider: "fake",
  endpoint: "/v1/x",
  code: "rate_limit" as const,
  statusCode,
});

const EVENT = (t: string): LlmEvent => ({ type: "text_delta", text: t }) as unknown as LlmEvent;

/** A transport that emits `before` and then fails, counting attempts. */
function transportFailingAfterEmit(before: string[], error: unknown) {
  const state = { attempts: 0 };
  const client: LlmClient = {
    name: "fake",
    async *stream(_r: LlmRequest, _s: AbortSignal) {
      state.attempts++;
      for (const t of before) yield EVENT(t);
      throw error;
    },
  };
  return { client, state };
}

async function collect(c: LlmClient, signal = new AbortController().signal) {
  const output: string[] = [];
  try {
    for await (const e of c.stream({} as LlmRequest, signal)) {
      output.push((e as unknown as { text: string }).text);
    }
  } catch {
    /* the final error is not what this helper measures */
  }
  return output;
}

describe("M93/B1 — a partially consumed stream is NOT retried", () => {
  it("fails AFTER emitting -> a single attempt, no duplicated token", async () => {
    const { client, state } = transportFailingAfterEmit(
      ["tok1", "tok2"],
      new NetworkError("socket hang up"),
    );
    const output = await collect(new RetryingLlmClient(client, { rng: () => 0 }));
    expect(state.attempts).toBe(1);
    expect(output).toEqual(["tok1", "tok2"]);
  });

  it("failing BEFORE emitting -> retries normally", async () => {
    const { client, state } = transportFailingAfterEmit([], new NetworkError("ECONNRESET"));
    await collect(new RetryingLlmClient(client, { rng: () => 0 }));
    expect(state.attempts).toBe(3);
  });
});

describe("M93/H3 — structured classification, never by text", () => {
  it("a network error with port 443 in the message IS transient when it is a NetworkError", () => {
    // The old regex (`/\b4\d\d\b/`) matched the PORT and excluded precisely these.
    expect(isRetriableError(new NetworkError("connect ECONNREFUSED 127.0.0.1:443"))).toBe(true);
    expect(isRetriableError(new NetworkError("https://api.x:443/v1 failed, ETIMEDOUT"))).toBe(true);
    expect(isRetriableError(new NetworkError("upstream timeout after 450 ms"))).toBe(true);
  });

  it("a foreign (non-SDK) error is NOT transient — the isTransientError contract", () => {
    // "wrap a foreign error in the appropriate SDK error first" — `errors.ts:429`. The transport
    // is what types it; a raw Error arriving here is a transport bug, not a retry case.
    expect(isRetriableError(new Error("connect ECONNREFUSED 127.0.0.1:443"))).toBe(false);
  });

  it("401 and 400 remain non-transient", () => {
    expect(isRetriableError(new AuthenticationError("bad key"))).toBe(false);
    expect(isRetriableError(new ConfigurationError("bad model"))).toBe(false);
  });
});

describe("M93/H4 — the retry does not re-run what the pool already exhausted", () => {
  it("CredentialPoolExhaustedError is not transient", () => {
    expect(
      isRetriableError(new CredentialPoolExhaustedError("all keys exhausted", { provider: "x" })),
    ).toBe(false);
  });

  it("an open circuit is not transient — the breaker exists IN ORDER TO fail fast", () => {
    expect(
      isRetriableError(new NetworkError("anthropic circuit open", { code: "circuit_open" })),
    ).toBe(false);
  });

  it("401 remains non-transient", () => {
    expect(isRetriableError(new AuthenticationError("bad key"))).toBe(false);
  });

  it("402 (billing) remains non-transient", () => {
    expect(isRetriableError(new RateLimitError("payment required", { metadata: META(402) }))).toBe(
      false,
    );
  });
});

describe("M93/M2 — the mutants that used to survive", () => {
  it("the backoff genuinely WAITS — removing the sleep fails here", async () => {
    vi.useFakeTimers();
    try {
      const { client } = transportFailingAfterEmit([], new NetworkError("ECONNRESET"));
      // non-zero rng: without it `computeBackoffMs` returns 0 and the sleep becomes a no-op —
      // which is exactly why the "remove the sleep" mutant survived the original suite.
      const target = new RetryingLlmClient(client, { rng: () => 1 });
      let finished = false;
      const p = collect(target).then(() => {
        finished = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(finished, "finished without waiting out the backoff").toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      await p;
      expect(finished).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the provider's Retry-After is honored — M93 DoD", async () => {
    vi.useFakeTimers();
    try {
      const error = new RateLimitError("slow down", { metadata: { ...META(429), retryAfter: 30 } });
      const { client, state } = transportFailingAfterEmit([], error);
      const p = collect(new RetryingLlmClient(client, { rng: () => 0 }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(state.attempts, "reexecutou before do Retry-After de 30 s").toBe(1);
      await vi.advanceTimersByTimeAsync(120_000);
      await p;
      expect(state.attempts).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a signal already aborted on entry does not call the transport", async () => {
    const { client, state } = transportFailingAfterEmit([], new NetworkError("x"));
    const ac = new AbortController();
    ac.abort(new Error("cancelled by the user"));
    await expect(collect(new RetryingLlmClient(client), ac.signal)).resolves.toEqual([]);
    expect(state.attempts).toBe(0);
  });
});
