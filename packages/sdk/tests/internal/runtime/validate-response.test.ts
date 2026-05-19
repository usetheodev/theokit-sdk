/**
 * Tests for validateResponse (T2.2, ADR D93).
 */

import { describe, expect, it } from "vitest";

import { validateResponse } from "../../../src/internal/runtime/validate-response.js";

describe("validateResponse (T2.2)", () => {
  it("content present, no tool calls → ok", () => {
    const r = validateResponse({ content: "answer", toolCalls: [] });
    expect(r.ok).toBe(true);
  });

  it("tool calls present, empty content → ok", () => {
    const r = validateResponse({ content: "", toolCalls: [{ name: "search" }] });
    expect(r.ok).toBe(true);
  });

  it("both empty → not ok (bailout)", () => {
    const r = validateResponse({ content: "", toolCalls: [] });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("empty response");
  });

  it("whitespace-only content treated as empty", () => {
    const r = validateResponse({ content: "\n  \t  ", toolCalls: [] });
    expect(r.ok).toBe(false);
  });

  it("returns reason on failure", () => {
    const r = validateResponse({ content: "", toolCalls: [] });
    expect(r.reason).toBeDefined();
    expect(r.reason).toContain("model bailout");
  });
});
