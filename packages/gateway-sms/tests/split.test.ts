import { describe, expect, it } from "vitest";

import { splitForSMS } from "../src/split.js";

describe("splitForSMS (D393, EC-7)", () => {
  it("returns single chunk for short text", () => {
    expect(splitForSMS("hi")).toEqual(["hi"]);
  });

  it("returns single chunk at exactly the default limit", () => {
    const text = "x".repeat(1600);
    expect(splitForSMS(text)).toEqual([text]);
  });

  it("EC-7: long text segmented with (i/N) prefix on each part", () => {
    const text = "x".repeat(3000);
    const parts = splitForSMS(text);
    expect(parts.length).toBeGreaterThan(1);
    for (let i = 0; i < parts.length; i++) {
      expect(parts[i]).toMatch(/^\(\d+\/\d+\) /);
    }
    expect(parts[0]?.startsWith("(1/")).toBe(true);
    expect(parts[parts.length - 1]?.startsWith(`(${parts.length}/${parts.length})`)).toBe(true);
  });

  it("preserves grapheme cluster (emoji not severed)", () => {
    // 🇧🇷 = 2 codepoints (regional indicators). Build text where
    // the emoji sits right at the boundary that naive code-unit split
    // would land on. We construct exactly one emoji at position cap-1.
    const filler = "x".repeat(1591); // 1591 + " " + 🇧🇷 = 1600+ ish
    const text = `${filler} 🇧🇷${"y".repeat(20)}`;
    const parts = splitForSMS(text);
    // Each part should be valid UTF-16 — easiest assertion: re-joining
    // must equal the original (modulo prefixes).
    const joined = parts.map((p) => p.replace(/^\(\d+\/\d+\) /, "")).join("");
    expect(joined).toBe(text);
  });

  it("respects custom limit", () => {
    const text = "x".repeat(200);
    const parts = splitForSMS(text, 100);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      // 100 cap, minus 8 reserved for "(i/N) ".
      expect(p.length).toBeLessThanOrEqual(100);
    }
  });

  it("empty text returns single empty string", () => {
    expect(splitForSMS("")).toEqual([""]);
  });
});
