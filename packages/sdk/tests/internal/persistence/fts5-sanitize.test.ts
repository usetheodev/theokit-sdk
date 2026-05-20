/**
 * RED tests for T5.1 — `sanitizeFts5Query` 6-step + `containsCjk` detection.
 */

import { describe, expect, it } from "vitest";

import { containsCjk, sanitizeFts5Query } from "../../../src/internal/persistence/fts5-sanitize.js";

describe("sanitizeFts5Query", () => {
  it("returns empty for empty input", () => {
    expect(sanitizeFts5Query("")).toBe("");
  });

  it("preserves quoted phrases", () => {
    expect(sanitizeFts5Query('"hello world" foo')).toBe('"hello world" foo');
  });

  it("strips unmatched bracket characters", () => {
    expect(sanitizeFts5Query("foo[bar")).toMatch(/^foo\s+bar$/);
    expect(sanitizeFts5Query("foo(bar")).toMatch(/^foo\s+bar$/);
    expect(sanitizeFts5Query("^special")).toMatch(/^special$/);
  });

  it("collapses repeated asterisks", () => {
    expect(sanitizeFts5Query("auth***")).toBe("auth*");
  });

  it("strips dangling AND at start", () => {
    expect(sanitizeFts5Query("AND foo")).toBe("foo");
  });

  it("strips dangling OR at end", () => {
    expect(sanitizeFts5Query("foo OR")).toBe("foo");
  });

  it("auto-quotes hyphenated identifier", () => {
    expect(sanitizeFts5Query("error-code")).toBe('"error-code"');
  });

  it("auto-quotes dotted version", () => {
    expect(sanitizeFts5Query("v2.3.1")).toBe('"v2.3.1"');
  });

  it("auto-quotes underscored identifier", () => {
    expect(sanitizeFts5Query("auth_token")).toBe('"auth_token"');
  });

  it("EC-3: returns empty when input is only specials (caller must short-circuit)", () => {
    expect(sanitizeFts5Query("[[[")).toBe("");
    expect(sanitizeFts5Query("()()")).toBe("");
    expect(sanitizeFts5Query("^^^")).toBe("");
  });

  it("is idempotent (sanitize(sanitize(x)) === sanitize(x))", () => {
    const inputs = ["error-code", '"hello world"', "auth_token v2.3.1", "foo*bar"];
    for (const input of inputs) {
      const once = sanitizeFts5Query(input);
      const twice = sanitizeFts5Query(once);
      expect(twice).toBe(once);
    }
  });
});

describe("containsCjk", () => {
  it("detects Chinese (CJK Unified)", () => {
    expect(containsCjk("大别山")).toBe(true);
  });

  it("detects Japanese Hiragana", () => {
    expect(containsCjk("こんにちは")).toBe(true);
  });

  it("detects Japanese Katakana", () => {
    expect(containsCjk("カタカナ")).toBe(true);
  });

  it("detects Korean Hangul", () => {
    expect(containsCjk("안녕하세요")).toBe(true);
  });

  it("rejects pure Latin", () => {
    expect(containsCjk("hello")).toBe(false);
  });

  it("rejects accented Latin", () => {
    expect(containsCjk("éxito")).toBe(false);
    expect(containsCjk("café")).toBe(false);
  });

  it("returns true when CJK mixed with Latin", () => {
    expect(containsCjk("error 大別山")).toBe(true);
  });

  it("returns false on empty string", () => {
    expect(containsCjk("")).toBe(false);
  });
});
