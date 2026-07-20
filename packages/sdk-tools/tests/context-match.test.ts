import { describe, expect, it } from "vitest";
import { ContextMatchError, replaceUnique } from "../src/internal/context-match.js";

describe("replaceUnique — context-tolerant single-occurrence matcher", () => {
  it("replaces a unique exact byte-substring match", () => {
    expect(replaceUnique("a\nfoo\nb", "foo", "bar")).toBe("a\nbar\nb");
  });

  it("throws 'ambiguous' when the exact target appears more than once", () => {
    try {
      replaceUnique("foo\nfoo", "foo", "bar");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContextMatchError);
      expect((e as ContextMatchError).reason).toBe("ambiguous");
    }
  });

  it("catches a self-OVERLAPPING ambiguous match (re-scan from first+1)", () => {
    // `aa` occurs at indices 0 and 1 in `aaa` — overlap-safe ambiguity detection.
    expect(() => replaceUnique("aaa", "aa", "X")).toThrow(ContextMatchError);
  });

  it("falls back to rstrip when only trailing whitespace differs", () => {
    // pattern has no trailing spaces; source line does → exact fails, rstrip rung matches.
    expect(replaceUnique("keep\n  code()  \nkeep", "  code()", "  fixed()")).toContain("fixed()");
  });

  it("falls back to trim when leading+trailing whitespace differs", () => {
    expect(replaceUnique("a\n    x = 1\nb", "x = 1", "x = 2")).toBe("a\n    x = 2\nb");
  });

  it("falls back to unicode-normalize (typographic dash/quote → ASCII)", () => {
    // source uses an en-dash + curly quote; pattern is ASCII.
    const src = "a\nconst s = ‘hi’ – ok\nb";
    const out = replaceUnique(src, "const s = 'hi' - ok", "const s = 'bye'");
    expect(out).toContain("const s = 'bye'");
  });

  it("throws 'not_found' when no rung matches", () => {
    try {
      replaceUnique("a\nb\nc", "nonexistent", "x");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ContextMatchError).reason).toBe("not_found");
    }
  });

  it("throws 'empty' for an empty find (indexOf('') footgun)", () => {
    try {
      replaceUnique("abc", "", "x");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ContextMatchError).reason).toBe("empty");
    }
  });

  it("preserves CRLF line endings on the replaced region", () => {
    const crlf = "a\r\nfoo\r\nb\r\n";
    const out = replaceUnique(crlf, "foo", "bar");
    expect(out).toContain("bar\r\n");
    expect(out).not.toContain("bar\nb"); // no stray LF-only line introduced
  });
});
