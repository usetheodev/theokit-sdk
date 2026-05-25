/**
 * Tests for splitForSlack — boundaries, paragraph/word breaks, surrogate guard (EC-4).
 */

import { describe, expect, it } from "vitest";
import { splitForSlack } from "../src/split.js";

describe("splitForSlack", () => {
  it("returns a single chunk for short text", () => {
    expect(splitForSlack("hello")).toEqual(["hello"]);
  });

  it("returns one chunk at exactly 4000 chars", () => {
    const text = "a".repeat(4000);
    expect(splitForSlack(text)).toEqual([text]);
  });

  it("splits text over 4000 chars into 2+ chunks", () => {
    const text = "a".repeat(4001);
    const chunks = splitForSlack(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
  });

  it("prefers paragraph break (\\n\\n)", () => {
    const a = "a".repeat(3000);
    const b = "b".repeat(2000);
    const chunks = splitForSlack(`${a}\n\n${b}`);
    expect(chunks[0]).toBe(a);
    expect(chunks[1]).toBe(b);
  });

  it("falls back to line break (\\n)", () => {
    const a = "a".repeat(3500);
    const b = "b".repeat(1000);
    const chunks = splitForSlack(`${a}\n${b}`);
    expect(chunks[0]?.startsWith("a")).toBe(true);
    expect(chunks[chunks.length - 1]?.endsWith("b")).toBe(true);
  });

  it("falls back to word break (space)", () => {
    const segment = "word ".repeat(900); // ~4500 chars
    const chunks = splitForSlack(segment);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
  });

  it("each chunk is under 4000 chars", () => {
    const text = "lorem ipsum dolor sit amet ".repeat(500);
    const chunks = splitForSlack(text);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
  });

  it("EC-4: avoids cutting inside a UTF-16 surrogate pair (emoji)", () => {
    const prefix = "a".repeat(3998);
    const text = `${prefix}🎉${"b".repeat(100)}`;
    const chunks = splitForSlack(text);
    for (const c of chunks) assertNoLoneSurrogate(c);
  });
});

/** Assert every high surrogate in `c` is followed by a low surrogate. */
function assertNoLoneSurrogate(c: string): void {
  for (let i = 0; i < c.length; i += 1) {
    const code = c.charCodeAt(i);
    if (code < 0xd800 || code > 0xdbff) continue;
    const next = c.charCodeAt(i + 1);
    expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
  }
}
