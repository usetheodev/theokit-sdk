import { describe, expect, it } from "vitest";

import { AuthenticationError, RateLimitError } from "../src/errors.js";
import {
  isRetriableError,
  MAX_ATTEMPTS,
  RetryingLlmClient,
} from "../src/internal/llm/retrying-client.js";
import type { LlmClient, LlmEvent, LlmFinish } from "../src/internal/llm/types.js";

/**
 * M93 T1.1 — the single-key path gains the retry only the two-key path had.
 *
 * `buildPoolOrSingle` gives circuit breaker, backoff and `Retry-After` when there are **>= 2** keys; with one,
 * returns the raw transport. A consumer resolving exactly one credential — the common case — never
 * had retry: a 429 after eight tool calls kills the whole turn.
 *
 * The tests inject a fake client that fails N times and counts attempts. No real credential is
 * a provider is required — the lesson M92 paid to learn, after the opposite was declared
 * unmeasurable.
 */
const failingClient = (errors: unknown[]): { client: LlmClient; attempts: () => number } => {
  let n = 0;
  const client: LlmClient = {
    name: "falso",
    // eslint-disable-next-line @typescript-eslint/require-await
    // biome-ignore lint/correctness/useYield: a transport that ONLY fails — not emitting is the point
    async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
      const error = errors[n];
      n += 1;
      if (error !== undefined) throw error;
      return { stopReason: "stop", text: "", toolCalls: [] } as unknown as LlmFinish;
    },
  };
  return { client, attempts: () => n };
};

const drenar = async (c: LlmClient): Promise<unknown> => {
  const gen = c.stream({} as never, new AbortController().signal);
  let passo = await gen.next();
  while (passo.done !== true) passo = await gen.next();
  return passo.value;
};

const rate429 = (): RateLimitError =>
  new RateLimitError("429", { metadata: { statusCode: 429 } as never });

describe("M93 — RetryingLlmClient", () => {
  it("a 429 is RETRIED up to the ceiling", async () => {
    const { client, attempts } = failingClient([rate429(), rate429(), rate429()]);
    const comRetry = new RetryingLlmClient(client, { rng: () => 0 });
    await expect(drenar(comRetry)).rejects.toBeInstanceOf(RateLimitError);
    expect(attempts()).toBe(MAX_ATTEMPTS);
  });

  it("a 401 is NOT retried — retry only makes a permanent error worse", async () => {
    const auth = new AuthenticationError("401");
    const { client, attempts } = failingClient([auth, auth, auth]);
    const comRetry = new RetryingLlmClient(client, { rng: () => 0 });
    await expect(drenar(comRetry)).rejects.toBeInstanceOf(AuthenticationError);
    expect(attempts()).toBe(1);
  });

  it("success on the SECOND attempt does not call a third", async () => {
    const { client, attempts } = failingClient([rate429()]);
    const comRetry = new RetryingLlmClient(client, { rng: () => 0 });
    await drenar(comRetry);
    expect(attempts()).toBe(2);
  });

  it("402 (billing) is NOT transient — a quota does not resolve in milliseconds", () => {
    const billing = new RateLimitError("402", { metadata: { statusCode: 402 } as never });
    expect(isRetriableError(billing)).toBe(false);
  });

  it("429 E transitorio", () => {
    expect(isRetriableError(rate429())).toBe(true);
  });

  it("a non-failing client passes through with no extra attempt", async () => {
    const { client, attempts } = failingClient([]);
    const comRetry = new RetryingLlmClient(client, { rng: () => 0 });
    await drenar(comRetry);
    expect(attempts()).toBe(1);
  });

  it("o nome do client interno atravessa — o decorator e transparente", () => {
    const { client } = failingClient([]);
    expect(new RetryingLlmClient(client).name).toBe("falso");
  });
});
