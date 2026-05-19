/**
 * Tests for the judge verdict parser (T2.1, ADRs D120-D121).
 *
 * `parseVerdict` is a pure function: prefix match `DONE:` / `CONTINUE:` /
 * `SKIPPED:`, then trim the reason. Anything else fails-safe to
 * `continue` with `parseFailed: true`.
 */

import { describe, expect, it } from "vitest";

import { parseVerdict } from "../../../src/internal/judge/parse-verdict.js";

describe("parseVerdict (T2.1)", () => {
  it("DONE: prefix returns verdict=done, parseFailed=false", () => {
    const r = parseVerdict("DONE: tests pass");
    expect(r.verdict).toBe("done");
    expect(r.reason).toBe("tests pass");
    expect(r.parseFailed).toBe(false);
  });

  it("CONTINUE: prefix returns verdict=continue", () => {
    const r = parseVerdict("CONTINUE: need to fix the third test");
    expect(r.verdict).toBe("continue");
    expect(r.reason).toBe("need to fix the third test");
    expect(r.parseFailed).toBe(false);
  });

  it("SKIPPED: prefix returns verdict=skipped", () => {
    const r = parseVerdict("SKIPPED: not applicable");
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("not applicable");
    expect(r.parseFailed).toBe(false);
  });

  it("trims trailing whitespace from reason", () => {
    const r = parseVerdict("DONE:   ok  \n");
    expect(r.reason).toBe("ok");
  });

  it("malformed input returns parseFailed=true, fail-safe continue", () => {
    const r = parseVerdict("I think we're getting there.");
    expect(r.verdict).toBe("continue");
    expect(r.parseFailed).toBe(true);
    expect(r.reason).toMatch(/malformed/i);
  });

  it("empty string returns parseFailed=true", () => {
    const r = parseVerdict("");
    expect(r.parseFailed).toBe(true);
  });

  it("case-sensitive prefix: 'done:' (lowercase) is parseFailed", () => {
    const r = parseVerdict("done: ok");
    expect(r.parseFailed).toBe(true);
  });

  it("multi-colon reason preserves the suffix", () => {
    const r = parseVerdict("DONE: foo: bar");
    expect(r.verdict).toBe("done");
    expect(r.reason).toBe("foo: bar");
  });

  // EC-E (edge-case review): trim() handles BOM but NOT zero-width space
  it("leading BOM (U+FEFF) IS handled by .trim() → parseFailed=false", () => {
    // ECMAScript spec: U+FEFF is in WhiteSpace; .trim() removes it.
    const r = parseVerdict("﻿DONE: ok");
    expect(r.parseFailed).toBe(false);
    expect(r.verdict).toBe("done");
  });

  it("leading zero-width space (U+200B) is NOT trimmed → parseFailed=true", () => {
    // U+200B is in Unicode category Cf (Format), NOT WhiteSpace; .trim()
    // does not remove it. Documents the limitation for LLMs that emit ZWSP.
    const r = parseVerdict("​DONE: ok");
    expect(r.parseFailed).toBe(true);
  });
});
