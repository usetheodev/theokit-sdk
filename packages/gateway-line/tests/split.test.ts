import { describe, expect, it } from "vitest";

import { splitForLine } from "../src/split.js";

describe("splitForLine (D411, EC-7)", () => {
  it("short text returns single chunk", () => {
    expect(splitForLine("hi")).toEqual(["hi"]);
  });

  it("text exactly at the default limit (5000) returns single chunk", () => {
    const t = "x".repeat(5000);
    expect(splitForLine(t)).toEqual([t]);
  });

  it("text over the limit segments correctly", () => {
    const t = "x".repeat(12_000);
    const parts = splitForLine(t);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(5000);
    expect(parts.join("")).toBe(t);
  });

  it("respects custom limit", () => {
    const parts = splitForLine("x".repeat(100), 30);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(30);
  });

  it("preserves grapheme clusters (emoji not severed)", () => {
    const filler = "x".repeat(4995);
    const text = `${filler}🇧🇷abc`; // emoji could sit on the boundary
    const parts = splitForLine(text);
    expect(parts.join("")).toBe(text);
  });

  it("empty string returns single empty chunk", () => {
    expect(splitForLine("")).toEqual([""]);
  });
});
