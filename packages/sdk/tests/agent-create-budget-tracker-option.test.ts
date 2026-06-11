/**
 * Type-level test for the `budgetTracker?` option on `Agent.create`
 * (SDK 2.0 Phase 2 / T2.1 — incremental wiring).
 *
 * Verifies:
 *   - The option exists in `AgentOptions`.
 *   - Accepts a `BudgetTracker` instance (from `createCounterBudgetTracker`
 *     OR any conforming impl).
 *   - Rejects non-tracker shapes (TypeScript catches mismatch).
 *
 * Runtime wiring is NOT exercised yet — the agent loop still uses the
 * legacy internal Budget. Pinning the type surface unblocks consumers to
 * adopt the API today + lets the runtime wiring land in a follow-up
 * iteration without breaking the public type.
 */

import { type AgentOptions, type BudgetTracker, createCounterBudgetTracker } from "@theokit/sdk";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("Agent.create budgetTracker option (Phase 2 type wiring)", () => {
  it("test_agent_options_has_budget_tracker_field", () => {
    expectTypeOf<AgentOptions["budgetTracker"]>().toEqualTypeOf<BudgetTracker | undefined>();
  });

  it("test_agent_options_accepts_counter_tracker", () => {
    const tracker = createCounterBudgetTracker({ maxTokens: 1000 });
    const opts: Partial<AgentOptions> = { budgetTracker: tracker };
    expect(opts.budgetTracker).toBeDefined();
    expect(typeof opts.budgetTracker?.track).toBe("function");
  });

  it("test_agent_options_accepts_inline_tracker_shape", () => {
    const opts: Partial<AgentOptions> = {
      budgetTracker: {
        track: () => undefined,
        check: () => ({ allowed: true }),
        getTotal: () => ({ tokens: 0 }),
      },
    };
    expect(opts.budgetTracker).toBeDefined();
  });

  it("test_agent_options_rejects_invalid_tracker_at_compile_time", () => {
    // @ts-expect-error — missing track / check / getTotal methods.
    const _bad: Partial<AgentOptions> = { budgetTracker: { foo: 1 } };
    void _bad;
  });

  it("test_agent_options_budget_tracker_is_optional", () => {
    // Should compile without budgetTracker — pure type assertion.
    const opts: Partial<AgentOptions> = {};
    expect(opts.budgetTracker).toBeUndefined();
  });
});
