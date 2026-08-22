/**
 * B-056 — `tests/helpers/poll-until.ts` unit coverage.
 *
 * This helper has no I/O and no seam to mock: it is pure control flow over
 * a caller-supplied predicate and the wall clock. Coverage here is a direct
 * exercise of the real function, not a mock of a dependency.
 *
 * ## Mutation counter-proof (executed manually against the production file)
 *
 * | Mutation in `poll-until.ts` | Test that dies (executed; all 3 confirmed) |
 * |---|---|
 * | `while (!condition())` → `while (false)` | All 4 tests fail: the loop body (including the deadline throw) never runs, so `pollUntil` resolves `undefined` immediately in every case — including the two that expect a rejection. |
 * | `if (Date.now() >= deadline)` → `if (false)` | The 2 tests that expect a timeout-driven rejection instead hang until vitest's own test timeout fires (`Test timed out in 20000ms`) — a real failure, just a slower one, because nothing inside `pollUntil` can ever throw. |
 * | `const deadline = Date.now() + deadlineMs` → `const deadline = Date.now()` | `polls until the condition flips true, then resolves` — a condition that is false on iteration 1 and true on iteration 3 now throws on iteration 2, because the deadline was already spent at construction. |
 */
import { describe, expect, it } from "vitest";

import { pollUntil } from "./helpers/poll-until.js";

describe("pollUntil", () => {
  it("resolves immediately when the condition is already true", async () => {
    let calls = 0;
    await pollUntil(() => {
      calls += 1;
      return true;
    });
    expect(calls).toBe(1);
  });

  it("polls until the condition flips true, then resolves", async () => {
    let calls = 0;
    const condition = () => {
      calls += 1;
      return calls >= 3;
    };
    await pollUntil(condition, { intervalMs: 5, deadlineMs: 2_000 });
    expect(calls).toBe(3);
  });

  it("throws naming the deadline when the condition never becomes true", async () => {
    await expect(pollUntil(() => false, { intervalMs: 5, deadlineMs: 50 })).rejects.toThrowError(
      /pollUntil: condition not met within 50ms/,
    );
  });

  it("throws the caller-supplied message instead of the default when given one", async () => {
    await expect(
      pollUntil(() => false, {
        intervalMs: 5,
        deadlineMs: 30,
        message: "waited for the widget to spin up",
      }),
    ).rejects.toThrowError(/waited for the widget to spin up/);
  });
});
