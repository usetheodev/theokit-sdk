/**
 * Tests for stripThinkBlocks (T1.2, ADR D96).
 */

import { describe, expect, it } from "vitest";

import { stripThinkBlocks } from "../../../src/internal/tool-dispatch/strip-think.js";

describe("stripThinkBlocks (T1.2)", () => {
  it("no-op when content has no think blocks", () => {
    const r = stripThinkBlocks("Just an answer.");
    expect(r.visible).toBe("Just an answer.");
    expect(r.thinking).toBeNull();
  });

  it("strips single block, extracts thinking", () => {
    const r = stripThinkBlocks("<think>reasoning here</think>Actual answer.");
    expect(r.visible).toBe("Actual answer.");
    expect(r.thinking).toBe("reasoning here");
  });

  it("joins multiple blocks into single thinking", () => {
    const r = stripThinkBlocks("<think>step 1</think>part 1<think>step 2</think>part 2");
    expect(r.visible).toBe("part 1part 2");
    expect(r.thinking).toContain("step 1");
    expect(r.thinking).toContain("step 2");
  });

  it("empty string input", () => {
    const r = stripThinkBlocks("");
    expect(r.visible).toBe("");
    expect(r.thinking).toBeNull();
  });

  it("unclosed block preserved (fail-open)", () => {
    const r = stripThinkBlocks("<think>incomplete");
    expect(r.visible).toBe("<think>incomplete");
    expect(r.thinking).toBeNull();
  });

  it("case-sensitive: <THINK> does not match", () => {
    const r = stripThinkBlocks("<THINK>uppercase</THINK>visible");
    expect(r.visible).toBe("<THINK>uppercase</THINK>visible");
    expect(r.thinking).toBeNull();
  });
});
