/**
 * `splitForWhatsApp` tests (T4.2 + EC-8 + UTF-16 surrogate guard).
 */

import { describe, expect, it } from "vitest";

import { splitForWhatsApp } from "../src/split.js";

describe("splitForWhatsApp", () => {
  it("test_split_under_limit_returns_single_part", () => {
    const out = splitForWhatsApp("short message");
    expect(out).toEqual(["short message"]);
  });

  it("test_split_breaks_at_double_newline_preferentially", () => {
    const para1 = "a".repeat(3000);
    const para2 = "b".repeat(3000);
    const text = `${para1}\n\n${para2}`;
    const out = splitForWhatsApp(text);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(para1);
    expect(out[1]).toBe(para2);
  });

  it("test_split_breaks_at_single_newline_when_no_double", () => {
    const part1 = "a".repeat(3000);
    const part2 = "b".repeat(2000);
    const text = `${part1}\n${part2}`;
    const out = splitForWhatsApp(text);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]).toBe(part1);
  });

  it("test_split_hard_cut_at_4096_when_no_boundary", () => {
    const text = "a".repeat(10_000);
    const out = splitForWhatsApp(text);
    for (const part of out) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
    expect(out.join("")).toBe(text);
  });

  it("test_split_preserves_surrogate_pairs — no broken emoji at boundary", () => {
    // Pad with regular chars, then put an emoji exactly at the 4096-th char position.
    // 4094 'a' + 😀 (2 UTF-16 code units) = position 4094+2=4096, which is fine.
    // We test: 4095 'a' + 😀 → splitter should not cut between high/low surrogate.
    const text = "a".repeat(4095) + "😀" + "b".repeat(100);
    const out = splitForWhatsApp(text);
    // Each part should not start with a low surrogate (orphan).
    for (const part of out) {
      const firstCode = part.charCodeAt(0);
      expect(firstCode >= 0xdc00 && firstCode <= 0xdfff).toBe(false);
    }
  });

  it("test_split_filters_empty_parts (EC-8) — consecutive newlines", () => {
    // Short input with only whitespace produces empty out.
    expect(splitForWhatsApp("\n\n\n\n")).toEqual([]);
    expect(splitForWhatsApp("   ")).toEqual([]);
  });

  it("preserves non-empty single short text", () => {
    expect(splitForWhatsApp("hi")).toEqual(["hi"]);
  });
});
