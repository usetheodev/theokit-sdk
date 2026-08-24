import { expect, it } from "vitest";
import { escapeLikePattern } from "../../../src/internal/memory/escape-like-pattern.js";

/**
 * `js/incomplete-sanitization` #14/#15. The cases that matter are the ones containing the escape
 * character itself — the two the previous implementation got wrong.
 */

it("wraps a plain query in wildcards and changes nothing else", () => {
  expect(escapeLikePattern("plain")).toBe("%plain%");
});

it("escapes the LIKE wildcards a user typed", () => {
  expect(escapeLikePattern("50%")).toBe("%50\\%%");
  expect(escapeLikePattern("a_b")).toBe("%a\\_b%");
});

it("escapes the escape character itself, so it cannot consume the next escape", () => {
  // The defect: `x\%y` used to produce `%x\\%y%`, where the inserted backslash was spent
  // escaping the user's backslash and the `%` was left live — a wildcard the caller never
  // wrote, turning a literal search into a scan.
  expect(escapeLikePattern("x\\%y")).toBe("%x\\\\\\%y%");
  expect(escapeLikePattern("back\\slash")).toBe("%back\\\\slash%");
});

it("leaves no unescaped wildcard anywhere inside the user's portion", () => {
  // The property, rather than one example: strip every escaped pair, and nothing that LIKE
  // treats as a wildcard may remain between the outer `%` delimiters.
  for (const query of ["x\\%y", "100%_", "\\\\", "a%b_c\\d", "\\%\\_"]) {
    const inner = escapeLikePattern(query).slice(1, -1);

    const withoutEscapedPairs = inner.replace(/\\[\\%_]/g, "");

    expect(
      withoutEscapedPairs,
      `unescaped wildcard survived for ${JSON.stringify(query)}`,
    ).not.toMatch(/[%_]/);
  }
});
