import { describe, expect, it, vi } from "vitest";

import { AuthenticationError, RateLimitError } from "../src/errors.js";
import { withRetry } from "../src/retry.js";

/**
 * M0-3 (plan m0-foundation-expose-primitives, T4.1) — generic `withRetry`.
 *
 * Contract (sealed by these tests):
 *   - retries transient failures with exponential backoff (deterministic via
 *     injected `sleep` + `rng` — no real timers)
 *   - default `isRetryable` is `isTransientError`
 *   - rethrows non-retryable errors immediately (no sleep)
 *   - propagates an aborted sleep without re-invoking `fn`
 */
describe("withRetry", () => {
  it("test_withRetry_succeeds_first_attempt_no_sleep", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => "ok");
    expect(await withRetry(fn, { sleep })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("test_withRetry_retries_until_success", async () => {
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new RateLimitError("rate limited");
        return calls;
      },
      { sleep: async () => {}, retries: 5 },
    );
    expect(value).toBe(3);
  });

  it("test_withRetry_uses_injected_sleep_with_backoff", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new RateLimitError("rate limited");
        return "done";
      },
      {
        retries: 5,
        initialDelayMs: 100,
        backoffMultiplier: 2,
        rng: () => 1,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(sleeps).toEqual([100, 200]);
  });

  it("test_withRetry_rethrows_non_retryable_immediately", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => {
      throw new AuthenticationError("bad key");
    });
    await expect(withRetry(fn, { sleep })).rejects.toBeInstanceOf(AuthenticationError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("test_withRetry_default_isRetryable_uses_isTransientError", async () => {
    // RateLimitError is transient -> retried; AuthenticationError is not.
    let rlCalls = 0;
    await expect(
      withRetry(
        async () => {
          rlCalls += 1;
          throw new RateLimitError("rl");
        },
        { retries: 2, sleep: async () => {} },
      ),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(rlCalls).toBe(3); // 1 + 2 retries

    let authCalls = 0;
    await expect(
      withRetry(
        async () => {
          authCalls += 1;
          throw new AuthenticationError("auth");
        },
        { retries: 2, sleep: async () => {} },
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(authCalls).toBe(1); // not retried
  });

  it("test_withRetry_aborts_mid_sleep", async () => {
    const fn = vi.fn(async () => {
      throw new RateLimitError("rl");
    });
    await expect(
      withRetry(fn, {
        retries: 5,
        sleep: async () => {
          throw new Error("aborted");
        },
      }),
    ).rejects.toThrow("aborted");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
