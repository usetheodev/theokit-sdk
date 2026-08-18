/**
 * Phase 5 (T5.2) — Budget public facade tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Budget } from "../src/budget.js";
import { BudgetExceededError, ConfigurationError } from "../src/errors.js";
import { chargeAndCheckThresholds, preflightCheck } from "../src/internal/budget/enforcement.js";
import { __resetLedgerForTests } from "../src/internal/budget/ledger.js";
import { __resetRegistryForTests } from "../src/internal/budget/registry.js";

describe("Budget — facade (D375)", () => {
  beforeEach(() => {
    __resetRegistryForTests();
    __resetLedgerForTests();
  });
  afterEach(() => {
    __resetRegistryForTests();
    __resetLedgerForTests();
  });

  it("static class constructor throws", () => {
    expect(() => new (Budget as unknown as new () => unknown)()).toThrow(
      /Budget is static; do not instantiate/,
    );
  });

  it("Budget.create returns a handle", () => {
    const h = Budget.create({
      name: "test",
      scope: "process",
      limits: [{ window: "1d", limitUsd: 5 }],
    });
    expect(h.name).toBe("test");
    expect(h.mode).toBe("warn"); // default
    expect(h.scope).toBe("process");
    expect(h.limits.length).toBe(1);
  });

  it("EC-16: duplicate Budget.create throws ConfigurationError", () => {
    Budget.create({ name: "dup", scope: "process", limits: [{ window: "1d", limitUsd: 1 }] });
    expect(() =>
      Budget.create({ name: "dup", scope: "process", limits: [{ window: "1d", limitUsd: 1 }] }),
    ).toThrow(ConfigurationError);
  });

  it("EC-7: empty name throws ConfigurationError", () => {
    expect(() => Budget.create({ name: "", scope: "process", limits: [] })).toThrow(
      ConfigurationError,
    );
  });

  it("EC-7: invalid name grammar throws ConfigurationError", () => {
    expect(() => Budget.create({ name: "Foo/Bar", scope: "process", limits: [] })).toThrow(
      ConfigurationError,
    );
    expect(() =>
      Budget.create({ name: "_starts-with-underscore", scope: "process", limits: [] }),
    ).toThrow(ConfigurationError);
    expect(() => Budget.create({ name: "UPPERCASE", scope: "process", limits: [] })).toThrow(
      ConfigurationError,
    );
  });

  it("Budget.list returns active", () => {
    Budget.create({ name: "b1", scope: "process", limits: [] });
    Budget.create({ name: "b2", scope: "process", limits: [] });
    expect(Budget.list().length).toBe(2);
  });

  it("Budget.get unknown returns undefined", () => {
    expect(Budget.get("missing")).toBeUndefined();
  });

  it("Budget.delete idempotent", () => {
    Budget.create({ name: "del", scope: "process", limits: [] });
    expect(Budget.delete("del")).toBe(true);
    expect(Budget.delete("del")).toBe(false);
    expect(Budget.delete("never-existed")).toBe(false);
  });

  it("Budget.snapshot returns spend per window", async () => {
    Budget.create({
      name: "snap",
      scope: "process",
      limits: [{ window: "1d", limitUsd: 10 }],
    });
    await chargeAndCheckThresholds("snap", 2.5);
    const snap = Budget.snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]?.name).toBe("snap");
    expect(snap[0]?.spentUsd).toBeCloseTo(2.5, 4);
    expect(snap[0]?.ratio).toBeCloseTo(0.25, 4);
  });

  it("BudgetHandle.spentIn + remainingIn snapshot live ledger", async () => {
    const h = Budget.create({
      name: "live",
      scope: "process",
      limits: [{ window: "1d", limitUsd: 10 }],
    });
    await chargeAndCheckThresholds("live", 3);
    expect(h.spentIn("1d")).toBeCloseTo(3, 4);
    expect(h.remainingIn("1d")).toBeCloseTo(7, 4);
  });
});

describe("Budget — 3 modes (D383)", () => {
  beforeEach(() => {
    __resetRegistryForTests();
    __resetLedgerForTests();
  });

  it("audit mode never throws, only charges", async () => {
    Budget.create({
      name: "audit",
      scope: "process",
      mode: "audit",
      limits: [{ window: "1d", limitUsd: 1 }],
    });
    await chargeAndCheckThresholds("audit", 5); // far exceeds
    expect(Budget.get("audit")?.spentIn("1d")).toBeCloseTo(5, 4);
    // No throw
  });

  it("warn mode: onThreshold callback fires at 80%", async () => {
    const events: number[] = [];
    Budget.create({
      name: "warn-80",
      scope: "process",
      mode: "warn",
      limits: [{ window: "1d", limitUsd: 10 }],
      onThreshold: (e) => {
        events.push(e.threshold);
      },
    });
    await chargeAndCheckThresholds("warn-80", 8.5); // 85%
    expect(events).toContain(0.8);
  });

  it("warn mode: onThreshold fires at 95%", async () => {
    const events: number[] = [];
    Budget.create({
      name: "warn-95",
      scope: "process",
      mode: "warn",
      limits: [{ window: "1d", limitUsd: 10 }],
      onThreshold: (e) => {
        events.push(e.threshold);
      },
    });
    await chargeAndCheckThresholds("warn-95", 9.7); // 97%
    expect(events).toContain(0.95);
  });

  it("warn mode: onExceed callback fires at 100% but does NOT throw", async () => {
    const events: number[] = [];
    Budget.create({
      name: "warn-100",
      scope: "process",
      mode: "warn",
      limits: [{ window: "1d", limitUsd: 1 }],
      onExceed: (e) => {
        events.push(e.spentUsd);
      },
    });
    await chargeAndCheckThresholds("warn-100", 1.5); // exceeds
    expect(events.length).toBe(1);
    // No throw
  });

  it("block mode: preflightCheck throws BEFORE LLM when would exceed", () => {
    Budget.create({
      name: "block",
      scope: "process",
      mode: "block",
      limits: [{ window: "1d", limitUsd: 1 }],
    });
    expect(() => preflightCheck("block", 2)).toThrow(BudgetExceededError);
  });

  it("block mode: preflightCheck does NOT throw when within limit", () => {
    Budget.create({
      name: "block-ok",
      scope: "process",
      mode: "block",
      limits: [{ window: "1d", limitUsd: 10 }],
    });
    expect(() => preflightCheck("block-ok", 1)).not.toThrow();
  });
});

describe("Budget — EC-7/8/9/18/19/20 edge cases", () => {
  beforeEach(() => {
    __resetRegistryForTests();
    __resetLedgerForTests();
  });

  it("EC-18: zero limit + block mode blocks everything", () => {
    Budget.create({
      name: "kill-switch",
      scope: "process",
      mode: "block",
      limits: [{ window: "1d", limitUsd: 0 }],
    });
    expect(() => preflightCheck("kill-switch", 0.001)).toThrow(BudgetExceededError);
  });

  it("EC-19: empty limits[] charges but never enforces", async () => {
    Budget.create({ name: "info-only", scope: "process", limits: [] });
    // preflight doesn't throw with empty limits
    expect(() => preflightCheck("info-only", 100)).not.toThrow();
    // charge works
    await chargeAndCheckThresholds("info-only", 50);
    expect(Budget.get("info-only")?.spentIn("1d")).toBeCloseTo(50, 4);
  });

  it("EC-20: charge to deleted budget = silent no-op (no throw)", async () => {
    Budget.create({ name: "deleted", scope: "process", limits: [{ window: "1d", limitUsd: 1 }] });
    Budget.delete("deleted");
    // No throw
    await chargeAndCheckThresholds("deleted", 0.5);
  });

  it("EC-8: onThreshold callback throws — does not break run", async () => {
    let invoked = false;
    Budget.create({
      name: "broken-cb",
      scope: "process",
      mode: "warn",
      limits: [{ window: "1d", limitUsd: 10 }],
      onThreshold: () => {
        invoked = true;
        throw new Error("sentry call failed");
      },
    });
    // No throw
    await chargeAndCheckThresholds("broken-cb", 8.5);
    expect(invoked).toBe(true);
  });

  it("EC-8: onExceed callback throws — does not break run", async () => {
    // B-005. The body ended at the bare `await` with `// No throw` as its only claim. Measured: a
    // regression that stops calling `onExceed` altogether leaves this test green, so the throw it is
    // named for was never exercised. The sibling above already uses the `invoked` flag; this one
    // needed it too, plus proof the charge survived the throwing callback.
    let invoked = false;
    Budget.create({
      name: "broken-exceed",
      scope: "process",
      mode: "warn",
      limits: [{ window: "1d", limitUsd: 1 }],
      onExceed: () => {
        invoked = true;
        throw new Error("sentry call failed");
      },
    });

    await expect(
      chargeAndCheckThresholds("broken-exceed", 1.5),
      "a throwing onExceed must not propagate into the caller",
    ).resolves.toBeUndefined();

    expect(invoked, "the throwing callback must actually have fired").toBe(true);
    expect(
      Budget.snapshot().find((e) => e.name === "broken-exceed")?.spentUsd,
      "and the charge must still have been applied — that is what 'does not break run' means",
    ).toBeCloseTo(1.5, 5);
  });

  it("Stacked limits: ANY exceeded triggers block (D384)", () => {
    Budget.create({
      name: "stacked",
      scope: "process",
      mode: "block",
      limits: [
        { window: "1d", limitUsd: 1 },
        { window: "30d", limitUsd: 100 },
      ],
    });
    // Within 30d limit, but would exceed 1d limit
    expect(() => preflightCheck("stacked", 2)).toThrow(BudgetExceededError);
  });

  it("EC-9 concurrency: 100 concurrent charges respect total", async () => {
    Budget.create({
      name: "concurrent",
      scope: "process",
      mode: "warn",
      limits: [{ window: "1d", limitUsd: 100 }],
    });
    await Promise.all(
      Array.from({ length: 100 }, () => chargeAndCheckThresholds("concurrent", 0.1)),
    );
    expect(Budget.get("concurrent")?.spentIn("1d")).toBeCloseTo(10, 4);
  });
});
