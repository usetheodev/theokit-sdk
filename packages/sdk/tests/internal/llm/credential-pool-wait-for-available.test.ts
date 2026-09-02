/**
 * T3.9 — Reconnect storm prevention via `CredentialPool.waitForAvailable`.
 *
 * Pre-T3.9 the pool only exposed `hasAvailable()` (instantaneous probe).
 * Concurrent callers that observed `null` from `select()` had no way to
 * back off cooperatively — they all threw `CredentialPoolExhaustedError`
 * the moment cooldown hit, then the caller's outer retry hammered the
 * pool again as soon as the first cooldown expired. Classic reconnect
 * storm.
 *
 * `waitForAvailable(signal, opts)` polls with full-jitter exponential
 * backoff (AWS Brooker 2015) so concurrent waiters stagger when the
 * earliest cooldown expires. The injected `sleeper` seam keeps these
 * tests deterministic without `vi.useFakeTimers()` — that path was the
 * blocker that deferred T3.4 wiring; T3.9 uses dependency injection
 * instead.
 */

import { describe, expect, it } from "vitest";
import { CredentialPool, newPooledCredential } from "../../../src/internal/llm/credential-pool.js";

function entry(token: string, priority = 0): ReturnType<typeof newPooledCredential> {
  return newPooledCredential({
    provider: "openai",
    accessToken: token,
    priority,
    source: "env:OPENAI_API_KEY",
  });
}

describe("T3.9 — CredentialPool.waitForAvailable", () => {
  it("returns true immediately when at least one entry is healthy", async () => {
    const pool = new CredentialPool("openai", [entry("k1"), entry("k2", 1)]);
    const sleeps: number[] = [];
    const sleeper = async (ms: number) => {
      sleeps.push(ms);
    };

    const ok = await pool.waitForAvailable(new AbortController().signal, {
      maxWaitMs: 5_000,
      sleeper,
    });

    expect(ok).toBe(true);
    expect(sleeps).toEqual([]);
  });

  it("returns false immediately when signal is already aborted", async () => {
    const pool = new CredentialPool("openai", [entry("k1")]);
    const ac = new AbortController();
    ac.abort();
    const sleeps: number[] = [];
    const sleeper = async (ms: number) => {
      sleeps.push(ms);
    };

    const ok = await pool.waitForAvailable(ac.signal, { maxWaitMs: 5_000, sleeper });

    expect(ok).toBe(false);
    expect(sleeps).toEqual([]);
  });

  it("polls with full-jitter sleeps when all entries are in cooldown, then returns true once one auto-heals", async () => {
    const pool = new CredentialPool("openai", [entry("k1")]);
    // Mark the only entry exhausted with a short cooldown.
    await pool.markExhaustedAndRotate({ entryId: pool.list()[0]!.id, statusCode: 429 });
    expect(pool.hasAvailable()).toBe(false);

    let sleepCalls = 0;
    const sleeper = async (ms: number, _signal: AbortSignal) => {
      sleepCalls++;
      // Simulate cooldown expiring on the third sleep by manipulating the
      // entry's `lastErrorResetAt` so `availableEntries()` auto-heals on
      // the next probe.
      if (sleepCalls === 3) {
        const all = pool.list();
        // Mutate via the frozen-view escape: same reference, set reset to past.
        (all[0] as { lastErrorResetAt?: number }).lastErrorResetAt = Date.now() - 1;
      }
      expect(ms).toBeGreaterThanOrEqual(0);
    };

    const ok = await pool.waitForAvailable(new AbortController().signal, {
      maxWaitMs: 60_000,
      sleeper,
    });

    expect(ok).toBe(true);
    expect(sleepCalls).toBe(3);
  });

  it("returns false when maxWaitMs elapses without any entry healing", async () => {
    const pool = new CredentialPool("openai", [entry("k1")]);
    await pool.markExhaustedAndRotate({
      entryId: pool.list()[0]!.id,
      statusCode: 429,
      resetAtMs: Date.now() + 999_999_999,
    });

    // A VIRTUAL clock, advanced by the sleeper. The file's opening docblock says the injected
    // `sleeper` "keeps these tests deterministic without vi.useFakeTimers()", and this case was the
    // one that abandoned it: it set `maxWaitMs: 5` and let the loop's deadline check read real
    // wall-clock, with a comment in the committed file admitting the workaround ("we can't easily
    // ... spec is wall-clock based"). A replaced sleeper was never enough on its own — the deadline
    // is the other half — so `waitForAvailable` takes a `now` seam beside it.
    let virtualNow = 1_000_000;
    let sleepCalls = 0;
    let totalSlept = 0;
    const sleeper = async (ms: number) => {
      sleepCalls += 1;
      totalSlept += ms;
      // The sleep ACTUALLY passes, as far as the loop can tell. A jitter of 0 would otherwise spin
      // forever against a clock nothing advances, so the floor is what guarantees termination.
      virtualNow += Math.max(ms, 1);
    };

    const ok = await pool.waitForAvailable(new AbortController().signal, {
      maxWaitMs: 5_000,
      sleeper,
      now: () => virtualNow,
    });

    expect(ok, "no entry healed, so the wait must report failure").toBe(false);
    // `expect(totalSlept).toBeGreaterThanOrEqual(0)` stood here and is true of every number the
    // accumulator can hold, including the zero it holds when the loop never runs.
    expect(sleepCalls, "the loop must actually have waited before giving up").toBeGreaterThan(0);
    expect(totalSlept, "and the waiting must be bounded by the budget").toBeLessThanOrEqual(5_000);
  });

  it("returns false promptly when signal aborts mid-wait", async () => {
    const pool = new CredentialPool("openai", [entry("k1")]);
    await pool.markExhaustedAndRotate({ entryId: pool.list()[0]!.id, statusCode: 429 });

    const ac = new AbortController();
    let sleepCalls = 0;
    const sleeper = async (_ms: number) => {
      sleepCalls++;
      if (sleepCalls === 2) {
        ac.abort();
      }
    };

    const ok = await pool.waitForAvailable(ac.signal, { maxWaitMs: 60_000, sleeper });

    expect(ok).toBe(false);
    // We must have observed the abort within a couple of iterations.
    expect(sleepCalls).toBeGreaterThanOrEqual(1);
    expect(sleepCalls).toBeLessThanOrEqual(3);
  });
});
