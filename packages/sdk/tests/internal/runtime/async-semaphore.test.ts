/**
 * Tests for AsyncSemaphore (T1.1, ADR D135).
 */

import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import { createSemaphore } from "../../../src/internal/concurrency/async-semaphore.js";
import { pollUntil } from "../../helpers/poll-until.js";

describe("AsyncSemaphore (T1.1)", () => {
  it("one permit serializes two acquires", async () => {
    const sem = createSemaphore(1);
    const order: number[] = [];
    const r1 = await sem.acquire();
    const p2 = (async () => {
      const r2 = await sem.acquire();
      order.push(2);
      r2();
    })();
    // Wait for p2 to actually be queued — `pending()` is the real signal
    // (1 held by r1 + 1 queued by p2), not a fixed tick that merely tends
    // to be enough time (B-056).
    await pollUntil(() => sem.pending() === 2, {
      deadlineMs: 1_000,
      message: "p2 never reached the queue (sem.pending() stayed below 2)",
    });
    order.push(1);
    r1();
    await p2;
    expect(order).toEqual([1, 2]);
  });

  it("n permits run n concurrently", async () => {
    const sem = createSemaphore(3);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    const r3 = await sem.acquire();
    expect(sem.inFlight()).toBe(3);
    r1();
    r2();
    r3();
    expect(sem.inFlight()).toBe(0);
  });

  it("fifo order under load", async () => {
    const sem = createSemaphore(1);
    const order: number[] = [];
    const r1 = await sem.acquire();
    const p2 = (async () => {
      const r = await sem.acquire();
      order.push(2);
      r();
    })();
    const p3 = (async () => {
      const r = await sem.acquire();
      order.push(3);
      r();
    })();
    const p4 = (async () => {
      const r = await sem.acquire();
      order.push(4);
      r();
    })();
    await pollUntil(() => sem.pending() === 4, {
      deadlineMs: 1_000,
      message: "p2/p3/p4 never all reached the queue (sem.pending() stayed below 4)",
    });
    r1();
    await Promise.all([p2, p3, p4]);
    expect(order).toEqual([2, 3, 4]);
  });

  it("release idempotent (multiple calls)", async () => {
    const sem = createSemaphore(1);
    const r = await sem.acquire();
    r();
    r();
    r();
    expect(sem.inFlight()).toBe(0);
    const r2 = await sem.acquire();
    expect(sem.inFlight()).toBe(1);
    r2();
  });

  it("throws on zero permits", () => {
    expect(() => createSemaphore(0)).toThrow(ConfigurationError);
  });

  it("throws on negative permits", () => {
    expect(() => createSemaphore(-1)).toThrow(ConfigurationError);
  });

  it("throws on non-integer permits", () => {
    expect(() => createSemaphore(2.5)).toThrow(ConfigurationError);
  });

  it("inFlight reflects active permits", async () => {
    const sem = createSemaphore(5);
    expect(sem.inFlight()).toBe(0);
    const r = await sem.acquire();
    expect(sem.inFlight()).toBe(1);
    r();
    expect(sem.inFlight()).toBe(0);
  });

  it("pending includes queued waiters and in-flight", async () => {
    const sem = createSemaphore(1);
    const r1 = await sem.acquire();
    // Queue 3 waiters
    const ps = [sem.acquire(), sem.acquire(), sem.acquire()];
    // Wait for all 3 to be queued — poll the real state instead of a fixed sleep.
    await pollUntil(() => sem.pending() === 4, { deadlineMs: 1_000 });
    expect(sem.pending()).toBe(4); // 1 active + 3 waiting
    r1();
    await Promise.all(ps.map((p) => p.then((rel) => rel())));
    expect(sem.pending()).toBe(0);
  });
});
