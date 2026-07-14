/**
 * Direct unit tests for the shared glob compiler (context-glob.ts) — the
 * load-bearing primitive behind path-scoped rule activation. Pins the DoD
 * edge cases (`**` collapse-to-zero-dirs, `*` single-segment, `?` single
 * non-separator char) so a future refactor of the regex cannot silently break
 * them with the rest of the suite still green.
 */

import { describe, expect, it } from "vitest";

import { anyGlobMatches, globToRegex } from "../../../src/internal/runtime/context/context-glob.js";

const m = (glob: string, path: string): boolean => globToRegex(glob).test(path);

describe("globToRegex", () => {
  it("collapses **/ so `dir/**/*.ext` matches a top-level file under dir", () => {
    expect(m("src/**/*.ts", "src/foo.ts")).toBe(true); // zero intermediate dirs
    expect(m("src/**/*.ts", "src/a/b/foo.ts")).toBe(true); // multiple dirs
    expect(m("**/*.ts", "foo.ts")).toBe(true); // leading **/ at root
    expect(m("**/*.ts", "a/b/foo.ts")).toBe(true);
  });

  it("does not match across the wrong directory or extension", () => {
    expect(m("src/api/**/*.ts", "src/ui/button.tsx")).toBe(false);
    expect(m("src/**/*.ts", "src/foo.tsx")).toBe(false);
    expect(m("src/api/**", "src/ui/x.ts")).toBe(false);
  });

  it("`*` matches a single path segment and does NOT cross `/`", () => {
    expect(m("src/*.ts", "src/foo.ts")).toBe(true);
    expect(m("src/*.ts", "src/sub/foo.ts")).toBe(false); // * must not cross /
    expect(m("src/models/*.ts", "src/models/user.ts")).toBe(true);
    expect(m("src/models/*.ts", "src/models/sub/user.ts")).toBe(false);
  });

  it("`?` matches exactly one non-separator character", () => {
    expect(m("a?c.ts", "abc.ts")).toBe(true);
    expect(m("a?c.ts", "a/c.ts")).toBe(false); // must not cross /
    expect(m("a?c.ts", "ac.ts")).toBe(false); // requires exactly one char
  });

  it("bare `**` matches any depth", () => {
    expect(m("src/**", "src/a")).toBe(true);
    expect(m("src/**", "src/a/b/c.ts")).toBe(true);
    expect(m("**", "anything/at/all.ts")).toBe(true);
  });

  it("escapes regex metacharacters in literal segments", () => {
    expect(m("src/a.b.ts", "src/a.b.ts")).toBe(true);
    expect(m("src/a.b.ts", "src/axbxts")).toBe(false); // dots are literal, not `.`
  });
});

describe("anyGlobMatches", () => {
  it("is false for empty patterns or empty paths", () => {
    expect(anyGlobMatches([], ["src/foo.ts"])).toBe(false);
    expect(anyGlobMatches(["src/**"], [])).toBe(false);
    expect(anyGlobMatches([], [])).toBe(false);
  });

  it("is true when any pattern matches any path", () => {
    expect(anyGlobMatches(["docs/**", "src/api/**/*.ts"], ["src/api/users.ts"])).toBe(true);
    expect(anyGlobMatches(["src/api/**/*.ts"], ["README.md", "src/api/users.ts"])).toBe(true);
  });

  it("is false when no pattern matches any path", () => {
    expect(anyGlobMatches(["src/api/**/*.ts"], ["src/ui/button.tsx", "README.md"])).toBe(false);
  });
});
