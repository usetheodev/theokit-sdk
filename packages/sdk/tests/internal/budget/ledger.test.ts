/**
 * Phase 5 (T5.1) — ledger + calendar-window tests + EC-6 GC mutex + EC-15.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  startOfDayUtc,
  startOfWeekUtc,
  windowStartMs,
} from "../../../src/internal/budget/calendar-window.js";
import {
  __evictNowForTests,
  __getLogCountForTests,
  __injectLogForTests,
  __resetLedgerForTests,
  charge,
  spentIn,
} from "../../../src/internal/budget/ledger.js";

describe("calendar-window", () => {
  it("startOfDayUtc returns 00:00:00 UTC of current day", () => {
    const now = new Date(Date.UTC(2026, 4, 27, 15, 30, 45, 123));
    const start = startOfDayUtc(now);
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(start.getUTCSeconds()).toBe(0);
    expect(start.getUTCMilliseconds()).toBe(0);
    expect(start.getUTCDate()).toBe(27);
  });

  it("startOfWeekUtc returns Monday 00:00 UTC of current week", () => {
    // 2026-05-27 is Wednesday (UTC) — Monday is 2026-05-25
    const wed = new Date(Date.UTC(2026, 4, 27, 15, 0, 0));
    const monday = startOfWeekUtc(wed);
    expect(monday.getUTCDate()).toBe(25);
    expect(monday.getUTCDay()).toBe(1); // Monday
    expect(monday.getUTCHours()).toBe(0);
  });

  it("startOfWeekUtc handles Sunday correctly (week ends on Sunday → 6 days from monday)", () => {
    const sun = new Date(Date.UTC(2026, 4, 31, 10, 0, 0)); // 2026-05-31 is Sunday
    const monday = startOfWeekUtc(sun);
    expect(monday.getUTCDate()).toBe(25);
  });

  it("windowStartMs 1h is relative (now - 60min)", () => {
    const now = new Date();
    const start = windowStartMs("1h", now);
    expect(start).toBe(now.getTime() - 60 * 60 * 1000);
  });

  it("windowStartMs 1d is UTC midnight", () => {
    const now = new Date(Date.UTC(2026, 4, 27, 12, 0, 0));
    const start = windowStartMs("1d", now);
    expect(new Date(start).toISOString()).toBe("2026-05-27T00:00:00.000Z");
  });
});

describe("ledger — charge + spentIn", () => {
  beforeEach(() => __resetLedgerForTests());
  afterEach(() => __resetLedgerForTests());

  it("charge accumulates", async () => {
    await charge("test", 1.5);
    await charge("test", 0.25);
    expect(spentIn("test", "1h")).toBeCloseTo(1.75, 6);
  });

  it("spentIn filters by window", async () => {
    __injectLogForTests("test", Date.now() - 2 * 60 * 60 * 1000, 5);
    __injectLogForTests("test", Date.now() - 30 * 60 * 1000, 1);
    expect(spentIn("test", "1h")).toBeCloseTo(1, 6);
    // 1d window (UTC midnight) — both logs should be included unless the
    // 2h-old log happens to be before today's UTC midnight. We test a
    // case where it's clearly today by injecting close to now.
    __injectLogForTests("test2", Date.now() - 5 * 60 * 1000, 0.5);
    __injectLogForTests("test2", Date.now() - 10 * 60 * 1000, 0.25);
    expect(spentIn("test2", "1h")).toBeCloseTo(0.75, 6);
  });

  it("spentIn returns 0 for unknown budget", () => {
    expect(spentIn("never-charged", "1d")).toBe(0);
  });

  it("EC-15: charge() uses charge-time timestamp for attribution", async () => {
    // Charge now; ensure window math uses Date.now() at charge time
    const t0 = Date.now();
    await charge("ec15", 1);
    const logs = __getLogCountForTests("ec15");
    expect(logs).toBe(1);
    // Spent should reflect charge in 1h window
    expect(spentIn("ec15", "1h")).toBe(1);
    // ... and not in arbitrary past timestamp
    const future = new Date(t0 + 2 * 60 * 60 * 1000);
    expect(spentIn("ec15", "1h", future)).toBe(0); // outside window
  });

  it("EC-6: GC + charge in same mutex (concurrent safe)", async () => {
    // Inject many old entries to trigger GC condition
    for (let i = 0; i < 5; i++) {
      __injectLogForTests("gc-test", Date.now() - 366 * 24 * 60 * 60 * 1000, 0.01);
    }
    // Force GC
    await __evictNowForTests();
    expect(__getLogCountForTests("gc-test")).toBe(0);
    // Now do concurrent charges
    await Promise.all(Array.from({ length: 100 }, () => charge("gc-test", 0.01)));
    expect(__getLogCountForTests("gc-test")).toBe(100);
    expect(spentIn("gc-test", "1h")).toBeCloseTo(1, 4);
  });

  it("ignores zero or negative charges", async () => {
    await charge("test", 0);
    await charge("test", -1);
    expect(__getLogCountForTests("test")).toBe(0);
  });
});
