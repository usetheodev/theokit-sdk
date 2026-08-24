/**
 * T3.4 — exponential backoff + full jitter for the credential-pool retry.
 *
 * Pre-T3.4 the pool retried 429 immediately on the same key (no sleep).
 * Under coordinated load (5 keys × global quota), the retry burned through
 * the entire pool in <1ms and surfaced as `CredentialPoolExhaustedError`
 * when a 1-2s wait would have cleared the rate-limit window.
 *
 * Tests cover the canonical AWS Brooker 2015 "full jitter" properties:
 *  - Retry-After hint always wins when in-range.
 *  - Backoff doubles per attempt (ceiling = base * 2^attempt).
 *  - Random jitter spreads sleep in [0, ceiling] (NOT deterministic).
 *  - Cap never exceeded.
 *  - sleepWithAbort resolves early on abort.
 */

import { describe, expect, it } from "vitest";

import { computeBackoffMs, sleepWithAbort } from "../../../src/internal/llm/retry.js";

describe("T3.4 — computeBackoffMs", () => {
  it("returns the Retry-After hint clamped to [base, cap]", () => {
    const v = computeBackoffMs({ attempt: 0, retryAfterMs: 1500 });
    expect(v).toBe(1500);
  });

  it("clamps Retry-After below base up to baseMs", () => {
    const v = computeBackoffMs({ attempt: 3, retryAfterMs: 50, baseMs: 500 });
    expect(v).toBe(500);
  });

  it("clamps Retry-After above cap down to capMs", () => {
    const v = computeBackoffMs({ attempt: 0, retryAfterMs: 999_999, capMs: 32_000 });
    expect(v).toBe(32_000);
  });

  it("doubles the ceiling per attempt when no Retry-After hint", () => {
    // attempt=0 → ceiling 500; attempt=1 → 1000; attempt=4 → 8000.
    const rng = () => 1; // forces max value
    expect(computeBackoffMs({ attempt: 0, baseMs: 500, rng })).toBe(500);
    expect(computeBackoffMs({ attempt: 1, baseMs: 500, rng })).toBe(1000);
    expect(computeBackoffMs({ attempt: 4, baseMs: 500, rng })).toBe(8000);
  });

  it("never exceeds capMs even at high attempt count", () => {
    const rng = () => 1;
    const v = computeBackoffMs({ attempt: 20, baseMs: 500, capMs: 32_000, rng });
    expect(v).toBeLessThanOrEqual(32_000);
  });

  it("jitter spreads — N samples are NOT all the same (full jitter)", () => {
    const samples = new Set<number>();
    for (let i = 0; i < 50; i += 1) {
      samples.add(computeBackoffMs({ attempt: 4, baseMs: 500 }));
    }
    // With 50 samples across [0, 8000] the chance of all duplicates is
    // astronomically small — assert at least 20 distinct values.
    expect(samples.size).toBeGreaterThanOrEqual(20);
  });

  it("simulates 5-keys-all-429 backoff sequence honoring Retry-After", () => {
    const sequence: number[] = [];
    const keyRetryAfter = [600, 1000, 500, 1200, 800];
    for (let i = 0; i < keyRetryAfter.length; i += 1) {
      sequence.push(computeBackoffMs({ attempt: i, retryAfterMs: keyRetryAfter[i] }));
    }
    // Each is exactly the Retry-After since all are within [500, 32000].
    expect(sequence).toEqual([600, 1000, 500, 1200, 800]);
  });
});

describe("T3.4 — sleepWithAbort", () => {
  it("resolves after the requested duration", async () => {
    const start = Date.now();
    await sleepWithAbort(50, new AbortController().signal);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it("resolves early when the signal aborts", async () => {
    const controller = new AbortController();
    const start = Date.now();
    const sleeping = sleepWithAbort(5_000, controller.signal);
    setTimeout(() => controller.abort(), 30);
    await sleeping;
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("resolves without ever arming a timer when the signal is already aborted", async () => {
    // B-081. This asserted `Date.now() - start < 50`. The 50ms was not a property of the code — the
    // code returns `Promise.resolve()` on the pre-aborted branch (retry.ts:70) and never touches a
    // timer, so the honest budget is "zero macrotasks", not "some milliseconds". A 50ms window is
    // both too generous (a regression that armed a 10ms timer would still pass) and too tight (one
    // scheduling slice on a saturated host reddens it while the code is correct), and either way
    // the failure would say nothing about the branch it is named for.
    //
    // Racing the sleep against a `setImmediate` marker asserts the real contract: a microtask-queue
    // resolution always beats the check phase, so the sleep can only lose this race by scheduling
    // work on the event loop — which is exactly the regression worth catching.
    const controller = new AbortController();
    controller.abort();

    const winner = await Promise.race([
      sleepWithAbort(5_000, controller.signal).then(() => "the sleep resolved"),
      new Promise<string>((resolve) =>
        setImmediate(() => resolve("a macrotask turn elapsed first")),
      ),
    ]);

    expect(winner, "a pre-aborted sleep must resolve on the microtask queue, not via a timer").toBe(
      "the sleep resolved",
    );
  });
});
