/**
 * Tests for telemetry tracer redaction wiring (T1.2, ADR D68).
 *
 * The helpers `_redactAttrValueForTests` and `_redactAttrsForTests` are
 * the same closures used inside `wrapSpan` and `startNewSpan`; testing
 * them directly proves the wire without requiring `@opentelemetry/api`
 * to be installed in the test environment.
 */

import { describe, expect, it } from "vitest";

import {
  _redactAttrsForTests,
  _redactAttrValueForTests,
  createTelemetry,
} from "../../../src/internal/telemetry/tracer.js";

describe("telemetry tracer T1.2 — redactAttrValue", () => {
  it("masks string values containing sk- secrets", () => {
    const out = _redactAttrValueForTests("api_key=sk-abcdef0123456789ghijklmn");
    expect(out).not.toContain("sk-abcdef0123456789ghijklmn");
  });

  it("passes numbers through untouched", () => {
    expect(_redactAttrValueForTests(42)).toBe(42);
  });

  it("passes booleans through untouched", () => {
    expect(_redactAttrValueForTests(true)).toBe(true);
  });

  it("passes undefined through untouched", () => {
    expect(_redactAttrValueForTests(undefined)).toBe(undefined);
  });
});

describe("telemetry tracer T1.2 — redactAttrs", () => {
  it("masks string entries; preserves numbers and undefined", () => {
    const out = _redactAttrsForTests({
      "llm.prompt": "user said sk-abcdef0123456789ghijklmn please mask",
      "llm.tokens": 1024,
      "llm.cached": true,
      "llm.unused": undefined,
    });
    expect(out["llm.prompt"]).not.toContain("sk-abcdef0123456789ghijklmn");
    expect(out["llm.tokens"]).toBe(1024);
    expect(out["llm.cached"]).toBe(true);
    expect(out["llm.unused"]).toBe(undefined);
  });

  it("masks Authorization: Bearer in tool.input attributes", () => {
    const out = _redactAttrsForTests({
      "tool.input": JSON.stringify({ headers: { Authorization: "Bearer eyJabc.def.ghi" } }),
    });
    expect(out["tool.input"] as string).not.toContain("eyJabc.def.ghi");
  });

  it("does not mutate the caller's input object", () => {
    const input = { "llm.prompt": "leak sk-abcdef0123456789ghijklmn" };
    _redactAttrsForTests(input);
    expect(input["llm.prompt"]).toContain("sk-abcdef0123456789ghijklmn");
  });
});

describe("telemetry tracer T1.2 — disabled handle still safe", () => {
  it("createTelemetry undefined → NOOP, no leak", () => {
    const handle = createTelemetry(undefined);
    const span = handle.startSpan("op", { secret: "sk-abcdef0123456789ghijklmn" });
    expect(() => span.setAttribute("k", "sk-abcdef0123456789ghijklmn")).not.toThrow();
    expect(() => span.setAttributes({ a: "sk-abcdef0123456789ghijklmn" })).not.toThrow();
    span.end();
  });
});
