import { describe, expect, it } from "vitest";
import { isOverflow, usableTokens } from "../../src/session/overflow.js";

describe("overflow detection", () => {
  it("returns true when tokens exceed budget", () => {
    // 9000 tokens, 10000 context, 2000 buffer -> usable = 8000, 9000 >= 8000
    expect(isOverflow(9000, 10000, 2000)).toBe(true);
  });

  it("returns false when tokens are under budget", () => {
    // 5000 tokens, 10000 context, 2000 buffer -> usable = 8000, 5000 < 8000
    expect(isOverflow(5000, 10000, 2000)).toBe(false);
  });

  it("returns true at exact boundary", () => {
    // tokens = contextWindow - buffer -> overflow
    expect(isOverflow(8000, 10000, 2000)).toBe(true);
  });

  it("returns false when contextWindow is 0 (unknown model)", () => {
    expect(isOverflow(5000, 0, 2000)).toBe(false);
  });

  it("usableTokens returns correct value", () => {
    expect(usableTokens(10000, 2000)).toBe(8000);
  });

  it("usableTokens never returns negative", () => {
    expect(usableTokens(100, 5000)).toBe(0);
  });
});
