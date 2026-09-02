import { afterEach, describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import { createBudget, deleteBudget } from "../../../src/internal/budget/registry.js";

/**
 * `BudgetScope` declares `"agent" | "call" | "process"` and `scope` is a REQUIRED field, so every
 * caller must pick from a union two-thirds of which is unbuilt. Measured 2026-09-02: nothing outside
 * the registry reads `scope` — `buildHandle` copies it onto the handle and the tracker never consults
 * it — so `scope: "agent"` was accepted and silently ignored.
 *
 * A caller asking for per-agent accounting got process-wide accounting with no signal. That is worse
 * than the missing feature: a cost control that reports the wrong number is trusted while being
 * wrong, which is the failure `rules/error-handling.md` § 2 exists to prevent.
 *
 * That no test in this suite needed changing when the guard landed is itself the evidence: nothing
 * was exercising the two unimplemented values.
 */
describe("a budget refuses a scope the SDK does not implement", () => {
  afterEach(() => {
    deleteBudget("scope-guard-fixture");
  });

  const limits = [{ window: "1d" as const, limitUsd: 10 }];

  it.each(["agent", "call"] as const)("refuses scope %p with a typed error", (scope) => {
    expect(() => createBudget({ name: "scope-guard-fixture", scope, limits })).toThrow(
      ConfigurationError,
    );
    expect(() => createBudget({ name: "scope-guard-fixture", scope, limits })).toThrow(
      /not implemented/,
    );
  });

  it("names the code so a caller can branch on it", () => {
    try {
      createBudget({ name: "scope-guard-fixture", scope: "agent", limits });
      expect.unreachable("the guard did not fire");
    } catch (err) {
      expect((err as ConfigurationError).code).toBe("unimplemented_budget_scope");
    }
  });

  it("accepts the one scope that IS implemented", () => {
    expect(createBudget({ name: "scope-guard-fixture", scope: "process", limits }).scope).toBe(
      "process",
    );
  });
});
