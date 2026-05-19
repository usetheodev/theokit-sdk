/**
 * Adversarial property tests for IterationBudget (T5.2).
 * 3 properties × 200 runs = 600+ random inputs.
 */

import fc from "fast-check";
import { describe, it } from "vitest";

import { IterationBudget } from "../../../src/internal/runtime/budget.js";

describe("IterationBudget — property invariants (T5.2)", () => {
  it("compression cap is never exceeded", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 1, max: 5 }), (n, cap) => {
        const budget = new IterationBudget({ maxIterations: 100, maxCompressions: cap });
        let allowed = 0;
        for (let i = 0; i < n; i++) {
          if (budget.recordCompression().allowed) allowed++;
        }
        return allowed <= cap;
      }),
      { numRuns: 200 },
    );
  });

  it("shouldContinue is monotonic — once false, stays false", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (max) => {
        const budget = new IterationBudget({ maxIterations: max, allowGraceCall: false });
        // Exhaust budget.
        for (let i = 0; i < max; i++) budget.consume();
        // First call to shouldContinue() returns false.
        const first = budget.shouldContinue();
        // Subsequent calls — even with more consume — stay false.
        budget.consume();
        budget.consume();
        const second = budget.shouldContinue();
        return first === false && second === false;
      }),
      { numRuns: 200 },
    );
  });

  it("consume never produces negative remaining", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.array(fc.oneof(fc.integer({ min: -5, max: 10 }), fc.constantFrom(Number.NaN, 0)), {
          maxLength: 30,
        }),
        (max, amounts) => {
          const budget = new IterationBudget({ maxIterations: max });
          for (const amt of amounts) budget.consume(amt);
          return budget.remaining >= 0;
        },
      ),
      { numRuns: 200 },
    );
  });
});
