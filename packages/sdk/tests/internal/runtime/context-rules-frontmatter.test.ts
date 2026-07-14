import { describe, expect, it } from "vitest";

import {
  parseRules,
  type RulesFrontmatter,
  shouldActivateRule,
} from "../../../src/internal/runtime/context/context-rules-frontmatter.js";

describe("parseRules — .theokit/rules/*.md frontmatter", () => {
  it("extracts paths, globs, and alwaysApply from frontmatter", () => {
    const md = [
      "---",
      "description: API rules",
      "paths:",
      "  - src/api/**/*.ts",
      "globs:",
      '  - "src/models/*.ts"',
      "alwaysApply: false",
      "---",
      "All endpoints must validate input.",
    ].join("\n");

    const parsed = parseRules(md);

    expect(parsed).toBeDefined();
    expect(parsed?.frontmatter.description).toBe("API rules");
    expect(parsed?.frontmatter.paths).toEqual(["src/api/**/*.ts"]);
    expect(parsed?.frontmatter.globs).toEqual(["src/models/*.ts"]);
    expect(parsed?.frontmatter.alwaysApply).toBe(false);
    expect(parsed?.body.trim()).toBe("All endpoints must validate input.");
  });

  it("treats a file with no frontmatter as an unconditional rule (alwaysApply)", () => {
    const parsed = parseRules("Just a rule body, no frontmatter.");
    expect(parsed?.frontmatter.alwaysApply).toBe(true);
    expect(parsed?.body).toBe("Just a rule body, no frontmatter.");
  });

  it("parses the enabled flag", () => {
    const md = ["---", "enabled: false", "paths:", "  - src/x.ts", "---", "body"].join("\n");
    expect(parseRules(md)?.frontmatter.enabled).toBe(false);
  });

  it("returns undefined when a frontmatter line has no colon (malformed)", () => {
    const md = ["---", "no-colon-line-here", "---", "body"].join("\n");
    expect(parseRules(md)).toBeUndefined();
  });

  it("returns undefined when frontmatter fails schema validation", () => {
    // `paths` must be an array of strings; a scalar fails the Zod schema.
    const md = ["---", "paths: not-an-array", "---", "body"].join("\n");
    expect(parseRules(md)).toBeUndefined();
  });
});

describe("shouldActivateRule — path-scoped activation", () => {
  const scoped = (fm: Partial<RulesFrontmatter>): RulesFrontmatter => ({ ...fm });

  it("activates unconditionally when alwaysApply is true (even with empty scope)", () => {
    expect(shouldActivateRule(scoped({ alwaysApply: true }), [])).toBe(true);
  });

  it("does NOT activate a scoped rule when no in-scope paths are provided", () => {
    expect(shouldActivateRule(scoped({ paths: ["src/api/**"] }), [])).toBe(false);
    expect(shouldActivateRule(scoped({ globs: ["src/api/**"] }), [])).toBe(false);
  });

  it("activates when a globs pattern matches an in-scope path", () => {
    expect(shouldActivateRule(scoped({ globs: ["src/api/**/*.ts"] }), ["src/api/users.ts"])).toBe(
      true,
    );
  });

  it("activates when a paths pattern matches an in-scope path (Claude Code parity)", () => {
    expect(shouldActivateRule(scoped({ paths: ["src/api/**/*.ts"] }), ["src/api/users.ts"])).toBe(
      true,
    );
  });

  it("does NOT activate when the in-scope path does not match", () => {
    expect(shouldActivateRule(scoped({ paths: ["src/api/**"] }), ["src/ui/button.tsx"])).toBe(
      false,
    );
  });

  it("never activates a disabled rule, even with alwaysApply", () => {
    expect(shouldActivateRule(scoped({ enabled: false, alwaysApply: true }), [])).toBe(false);
  });

  it("returns false for a rule with neither scope nor alwaysApply", () => {
    expect(shouldActivateRule(scoped({ description: "orphan" }), ["src/api/x.ts"])).toBe(false);
  });
});
