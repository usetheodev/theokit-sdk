/**
 * D206 — Eval telemetry helpers. Validates the OTel-unavailable safe path
 * (no-op) and basic span lifecycle when @opentelemetry/api is loadable.
 */

import { describe, expect, it } from "vitest";

import {
  __resetEvalOtelCacheForTests,
  startEvalRunSpan,
} from "../../src/internal/eval/telemetry.js";

describe("startEvalRunSpan (D206)", () => {
  it("returns a usable handle even without OTel installed", () => {
    __resetEvalOtelCacheForTests();
    const span = startEvalRunSpan({
      name: "no-otel-test",
      id: "test-id",
      rows: 5,
      concurrency: 4,
    });
    // Either OTel is present (real span) or absent (no-op). Either way the
    // contract is: setAttribute + end NEVER throw.
    expect(() => span.setAttribute("k", "v")).not.toThrow();
    expect(() => span.setAttribute("n", 42)).not.toThrow();
    expect(() => span.end()).not.toThrow();
  });

  it("end() is idempotent", () => {
    __resetEvalOtelCacheForTests();
    const span = startEvalRunSpan({ name: "idem", id: "x", rows: 0, concurrency: 1 });
    expect(() => span.end()).not.toThrow();
    expect(() => span.end()).not.toThrow();
  });

  it("accepts various attribute value types", () => {
    __resetEvalOtelCacheForTests();
    const span = startEvalRunSpan({ name: "attrs", id: "x", rows: 1, concurrency: 1 });
    expect(() => span.setAttribute("string-attr", "hello")).not.toThrow();
    expect(() => span.setAttribute("number-attr", 3.14)).not.toThrow();
    expect(() => span.setAttribute("bool-attr", true)).not.toThrow();
    span.end();
  });
});
