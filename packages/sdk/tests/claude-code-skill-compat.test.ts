import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SkillsManager } from "../src/internal/runtime/skills/skills-manager.js";

/*
 * Skills authored for the Claude Code CLI.
 *
 * Format was never the problem: measured 2026-08-26, `SkillFrontmatter` requires exactly `name` and
 * `description`, which is what the CLI writes into every `SKILL.md`. The directory was — nothing
 * looked in `.claude/skills`, so a repository set up for the CLI presented zero skills here.
 */
describe("skills declared under .claude", () => {
  let cwd: string;

  const writeSkill = (root: string, name: string, body: string): void => {
    mkdirSync(join(cwd, root, "skills", name), { recursive: true });
    writeFileSync(
      join(cwd, root, "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${body}\n---\nBody.\n`,
    );
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cc-skill-compat-"));
  });

  it("test_a_skill_under_dot_claude_is_discovered", async () => {
    writeSkill(".claude", "cli-skill", "from .claude.");
    const mgr = new SkillsManager(cwd, undefined, true);
    await mgr.refresh();
    expect((await mgr.list()).map((s) => s.name)).toEqual(["cli-skill"]);
  });

  it("test_skills_from_both_directories_are_merged", async () => {
    writeSkill(".theokit", "theokit-skill", "from .theokit.");
    writeSkill(".claude", "cli-skill", "from .claude.");
    const mgr = new SkillsManager(cwd, undefined, true);
    await mgr.refresh();
    expect((await mgr.list()).map((s) => s.name).sort()).toEqual(["cli-skill", "theokit-skill"]);
  });

  it("test_the_explicit_namespace_wins_when_both_declare_the_same_skill", async () => {
    writeSkill(".theokit", "shared", "FROM THEOKIT.");
    writeSkill(".claude", "shared", "from claude.");
    const mgr = new SkillsManager(cwd, undefined, true);
    await mgr.refresh();
    expect((await mgr.list()).find((s) => s.name === "shared")?.description).toBe("FROM THEOKIT.");
  });

  // The accepted case in the other direction (rules/testing.md § 4.2): an explicit skillsDir must
  // still mean exactly that one directory, or M22's override silently gained a second source.
  it("test_an_explicit_skills_dir_is_still_the_only_source", async () => {
    writeSkill(".claude", "cli-skill", "must not appear.");
    mkdirSync(join(cwd, "custom", "only-here"), { recursive: true });
    writeFileSync(
      join(cwd, "custom", "only-here", "SKILL.md"),
      "---\nname: only-here\ndescription: the only one.\n---\nBody.\n",
    );
    const mgr = new SkillsManager(cwd, undefined, true, join(cwd, "custom"));
    await mgr.refresh();
    expect((await mgr.list()).map((s) => s.name)).toEqual(["only-here"]);
  });
});
