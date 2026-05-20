/**
 * Tests for context-mdc-parser.ts (T3.1).
 */

import { describe, expect, it } from "vitest";

import { parseMdc, shouldActivate } from "../../../src/internal/runtime/context-mdc-parser.js";

describe("parseMdc + shouldActivate (T3.1)", () => {
  it("alwaysApply: true always activates", () => {
    const r = parseMdc("---\nalwaysApply: true\n---\nrule body");
    expect(r?.frontmatter.alwaysApply).toBe(true);
    expect(shouldActivate(r!.frontmatter, [])).toBe(true);
    expect(shouldActivate(r!.frontmatter, ["src/a.ts"])).toBe(true);
  });

  it("alwaysApply false with matching glob activates (EC-19)", () => {
    const r = parseMdc('---\nalwaysApply: false\nglobs: ["**/*.ts"]\n---\nbody');
    expect(shouldActivate(r!.frontmatter, ["src/a.ts"])).toBe(true);
  });

  it("alwaysApply false with no matching glob skipped", () => {
    const r = parseMdc('---\nalwaysApply: false\nglobs: ["**/*.py"]\n---\nbody');
    expect(shouldActivate(r!.frontmatter, ["src/a.ts"])).toBe(false);
  });

  // EC-I + EC-20: v1 semantic
  it("EC-I: empty touched_files → only alwaysApply: true activates", () => {
    const withGlobs = parseMdc('---\nalwaysApply: false\nglobs: ["**/*.ts"]\n---\nbody');
    expect(shouldActivate(withGlobs!.frontmatter, [])).toBe(false);
    const alwaysOn = parseMdc("---\nalwaysApply: true\n---\nbody");
    expect(shouldActivate(alwaysOn!.frontmatter, [])).toBe(true);
  });

  // EC-18: no frontmatter
  it("EC-18: no frontmatter treated as alwaysApply: true", () => {
    const r = parseMdc("just markdown, no frontmatter");
    expect(r?.frontmatter.alwaysApply).toBe(true);
    expect(r?.body).toBe("just markdown, no frontmatter");
    expect(shouldActivate(r!.frontmatter, [])).toBe(true);
  });

  // EC-21: malformed YAML — line without colon
  it("EC-21: malformed YAML returns undefined", () => {
    const r = parseMdc("---\nno_colon_just_a_bare_token_here\n---\nbody");
    expect(r).toBeUndefined();
  });

  it("overlapping globs both activate (EC-22)", () => {
    const r1 = parseMdc('---\nalwaysApply: false\nglobs: ["**/*.ts"]\n---\nA');
    const r2 = parseMdc('---\nalwaysApply: false\nglobs: ["src/*.ts"]\n---\nB');
    expect(shouldActivate(r1!.frontmatter, ["src/a.ts"])).toBe(true);
    expect(shouldActivate(r2!.frontmatter, ["src/a.ts"])).toBe(true);
  });

  it("returns body separated from frontmatter", () => {
    const r = parseMdc("---\ndescription: foo\nalwaysApply: true\n---\nactual rule text");
    expect(r?.body).toBe("actual rule text");
    expect(r?.frontmatter.description).toBe("foo");
  });
});
