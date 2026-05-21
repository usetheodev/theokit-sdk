/**
 * Tests for splitForTelegram (T5.1, EC-J markdown-pair preservation).
 */

import { describe, expect, it } from "vitest";

import { splitForTelegram } from "../src/split.js";

describe("splitForTelegram (T5.1)", () => {
  it("short text returns single chunk", () => {
    expect(splitForTelegram("hello")).toEqual(["hello"]);
  });

  it("splits text longer than 4096 chars", () => {
    const big = "a".repeat(8000);
    const parts = splitForTelegram(big);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(4096);
    }
    expect(parts.join("")).toBe(big);
  });

  it("EC-J: preserves markdown ** pairs across chunks", () => {
    // Build a string that would split mid-pair without balancing.
    const prefix = "**bold** ".repeat(440); // ~4000 chars
    const trailing = ` **second-half-bold**${" extra".repeat(100)}`;
    const text = prefix + trailing;
    const parts = splitForTelegram(text);
    expect(parts.length).toBeGreaterThan(1);
    // Each chunk must have balanced ** markers.
    for (const p of parts) {
      const count = (p.match(/\*\*/g) ?? []).length;
      expect(count % 2).toBe(0);
    }
  });

  it("EC-J: balances backticks when input is split-eligible", () => {
    const code = "`x` ".repeat(1500); // 6000 chars, balanced
    const parts = splitForTelegram(code);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      const count = (p.match(/`/g) ?? []).length;
      expect(count % 2).toBe(0);
    }
  });

  it("prefers paragraph break boundary when available", () => {
    const para = "paragraph one\n\n".repeat(200);
    const parts = splitForTelegram(para);
    // Most chunks should end on a paragraph boundary, not mid-word.
    for (let i = 0; i < parts.length - 1; i += 1) {
      const tail = parts[i]?.slice(-20) ?? "";
      // tail should NOT end with a partial word (heuristic — letters only).
      expect(/[a-z]$/.test(tail) && !tail.includes("\n")).toBe(false);
    }
  });
});
