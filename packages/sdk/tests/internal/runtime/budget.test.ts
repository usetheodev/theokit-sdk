/**
 * Tests for IterationBudget (T2.1, ADRs D90-D91).
 */

import { describe, expect, it } from "vitest";

import { IterationBudget } from "../../../src/internal/runtime/budget.js";

describe("IterationBudget (T2.1)", () => {
  it("remaining starts at max", () => {
    const budget = new IterationBudget({ maxIterations: 10 });
    expect(budget.remaining).toBe(10);
    expect(budget.total).toBe(10);
  });

  it("consume decrements remaining", () => {
    const budget = new IterationBudget({ maxIterations: 5 });
    budget.consume();
    expect(budget.remaining).toBe(4);
    budget.consume(2);
    expect(budget.remaining).toBe(2);
  });

  it("consume(0) is no-op", () => {
    const budget = new IterationBudget({ maxIterations: 5 });
    budget.consume(0);
    expect(budget.remaining).toBe(5);
  });

  it("EC-4: consume(NaN) treated as no-op", () => {
    const budget = new IterationBudget({ maxIterations: 5 });
    budget.consume(Number.NaN);
    expect(budget.remaining).toBe(5);
  });

  it("consume(negative) treated as no-op", () => {
    const budget = new IterationBudget({ maxIterations: 5 });
    budget.consume(-3);
    expect(budget.remaining).toBe(5);
  });

  it("3 compressions allowed, 4th denied", () => {
    const budget = new IterationBudget({ maxIterations: 10, maxCompressions: 3 });
    expect(budget.recordCompression().allowed).toBe(true);
    expect(budget.recordCompression().allowed).toBe(true);
    expect(budget.recordCompression().allowed).toBe(true);
    const fourth = budget.recordCompression();
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toContain("compression cap reached");
  });

  it("shouldContinue while remaining positive", () => {
    const budget = new IterationBudget({ maxIterations: 3 });
    expect(budget.shouldContinue()).toBe(true);
    budget.consume();
    expect(budget.shouldContinue()).toBe(true);
    budget.consume();
    expect(budget.shouldContinue()).toBe(true);
    budget.consume();
    // remaining === 0 — grace permits one more
    expect(budget.shouldContinue()).toBe(true);
  });

  it("shouldContinue grace when exhausted", () => {
    const budget = new IterationBudget({ maxIterations: 1 });
    budget.consume();
    expect(budget.remaining).toBe(0);
    expect(budget.shouldContinue()).toBe(true); // grace
  });

  it("shouldContinue false after grace used", () => {
    const budget = new IterationBudget({ maxIterations: 1 });
    budget.consume();
    budget.useGraceCall();
    expect(budget.shouldContinue()).toBe(false);
  });

  it("disable grace via option", () => {
    const budget = new IterationBudget({ maxIterations: 1, allowGraceCall: false });
    budget.consume();
    expect(budget.shouldContinue()).toBe(false);
  });

  it("compression attempts count visible", () => {
    const budget = new IterationBudget();
    expect(budget.compressionAttempts).toBe(0);
    budget.recordCompression();
    expect(budget.compressionAttempts).toBe(1);
    budget.recordCompression();
    expect(budget.compressionAttempts).toBe(2);
  });

  it("useGraceCall idempotent", () => {
    const budget = new IterationBudget({ maxIterations: 1 });
    budget.consume();
    budget.useGraceCall();
    budget.useGraceCall(); // 2x ok
    expect(budget.graceCallUsed).toBe(true);
  });
});
