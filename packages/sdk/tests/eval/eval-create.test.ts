/**
 * `Eval.create` validation tests (Zod refinements).
 *
 * Covers D202 (static class shape), EC-3 (concurrency validation),
 * and basic happy path. Real run() tests live in `eval-run.test.ts`
 * (require a fixture or real agent).
 */

import { describe, expect, it } from "vitest";

import { Eval } from "../../src/eval.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// This file passed `cwd: process.cwd()`, which during a test run is the package itself, so
// every agent it created persisted a real session into packages/sdk/.theokit/. The helper
// makes process.cwd() report a throwaway directory for this file only.
useTempCwd();

const baseOpts = {
  name: "smoke",
  dataset: [{ input: "x" }],
  scorers: [() => ({ score: 1 })],
  agent: {
    apiKey: "theo_test_dummy",
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
  },
} as const;

describe("Eval.create (D202)", () => {
  it("creates an Eval instance with valid options", () => {
    const e = Eval.create(baseOpts);
    expect(e).toBeInstanceOf(Eval);
  });

  it("rejects empty name", () => {
    expect(() => Eval.create({ ...baseOpts, name: "" })).toThrow(/name/);
  });

  it("rejects empty scorers array", () => {
    expect(() => Eval.create({ ...baseOpts, scorers: [] })).toThrow(/scorers/);
  });

  it("EC-3: rejects concurrency 0", () => {
    expect(() => Eval.create({ ...baseOpts, concurrency: 0 })).toThrow(/concurrency/);
  });

  it("EC-3: rejects concurrency -1", () => {
    expect(() => Eval.create({ ...baseOpts, concurrency: -1 })).toThrow(/concurrency/);
  });

  it("EC-3: rejects concurrency Infinity (not an integer)", () => {
    expect(() => Eval.create({ ...baseOpts, concurrency: Number.POSITIVE_INFINITY })).toThrow(
      /concurrency/,
    );
  });

  it("EC-3: rejects concurrency > 64", () => {
    expect(() => Eval.create({ ...baseOpts, concurrency: 100 })).toThrow(/concurrency/);
  });

  it("accepts valid concurrency 4", () => {
    expect(() => Eval.create({ ...baseOpts, concurrency: 4 })).not.toThrow();
  });

  it("accepts factory dataset", () => {
    function* gen(): Generator<{ input: string }> {
      yield { input: "x" };
    }
    expect(() => Eval.create({ ...baseOpts, dataset: gen as never })).not.toThrow();
  });

  it("rejects invalid dataset shape (number)", () => {
    expect(() => Eval.create({ ...baseOpts, dataset: 42 as never })).toThrow(/dataset/);
  });
});
