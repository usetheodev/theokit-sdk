import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildSkillsBlock, discoverSkills } from "../src/skills.js";

/**
 * M4-1 — integration: the public `@theokit/sdk/skills` subpath discovers skills
 * from an arbitrary dir and renders the `<skills>` block, and the subpath is
 * declared in package.json so Node ESM/CJS can resolve it.
 */
const FIXTURE_SKILLS = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/repos/project-with-skills/.theokit/skills",
);

describe("skills wiring (M4-1)", () => {
  it("test_skills_subpath_discovers_fixture_and_builds_block", async () => {
    expect(typeof discoverSkills).toBe("function");
    expect(typeof buildSkillsBlock).toBe("function");

    const skills = await discoverSkills(FIXTURE_SKILLS);
    expect(skills.map((s) => s.name).sort()).toEqual(["code-review", "test-architect"]);

    const block = buildSkillsBlock(skills.sort((a, b) => a.name.localeCompare(b.name)));
    expect(block).toContain("<skills>");
    expect(block).toContain("code-review:");
    expect(block).toContain("test-architect:");
  });

  it("test_skills_subpath_declared_in_package_json", () => {
    const pkgPath = join(fileURLToPath(new URL(".", import.meta.url)), "../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      exports: Record<
        string,
        { import: { types: string; default: string }; require: { types: string; default: string } }
      >;
    };
    const entry = pkg.exports["./skills"];
    if (entry === undefined) throw new Error("package.json is missing the ./skills export");
    expect(entry.import.types).toBe("./dist/skills.d.ts");
    expect(entry.import.default).toBe("./dist/skills.js");
    expect(entry.require.types).toBe("./dist/skills.d.cts");
    expect(entry.require.default).toBe("./dist/skills.cjs");
  });
});
