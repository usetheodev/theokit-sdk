import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { Skill } from "../../src/create-skill.js";
import { SkillsManager } from "../../src/internal/runtime/skills/skills-manager.js";
import { removeTempDirRobust } from "../helpers/temp-workspace.js";

/**
 * M22 — inline `Skill.create()` + custom `skillsDir`. Inline skills need no SKILL.md; a custom dir
 * replaces the default `.theokit/skills` root. Both surface via the SkillsManager `list()` (the
 * same list the `<skills>` block is built from), so they compose with the M13 enabled-name resolver.
 */

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(
    join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nDo the thing.\n`,
  );
}

describe("M22 — Skill", () => {
  it("builds an inline skill with a synthetic source + carried instructions", () => {
    const skill = Skill.create({
      name: "summarize",
      description: "Summarize text concisely",
      instructions: "Read the text and produce a 2-sentence summary.",
    });
    expect(skill).toEqual({
      name: "summarize",
      description: "Summarize text concisely",
      source: "inline://summarize",
      instructions: "Read the text and produce a 2-sentence summary.",
    });
  });

  it("fails fast on an empty name or description", () => {
    expect(() => Skill.create({ name: "", description: "d", instructions: "i" })).toThrow(/name/);
    expect(() => Skill.create({ name: "n", description: "", instructions: "i" })).toThrow(
      /description/,
    );
  });

  it("carries an optional references map on the inline skill (SE21)", () => {
    const skill = Skill.create({
      name: "release",
      description: "Release checklist",
      instructions: "Run the checklist.",
      references: { "changelog-format.md": "# Changelog Format\nKeep a Changelog." },
    });
    expect(skill.references).toEqual({
      "changelog-format.md": "# Changelog Format\nKeep a Changelog.",
    });
  });

  it("omits references when not provided (back-compat)", () => {
    const skill = Skill.create({ name: "x", description: "d", instructions: "i" });
    expect(skill.references).toBeUndefined();
  });
});

describe("M22 — SkillsManager inline + skillsDir", () => {
  it("surfaces inline skills via list() even without a project skills dir", async () => {
    const inline = [
      Skill.create({
        name: "code-skill",
        description: "A code-defined skill",
        instructions: "...",
      }),
    ];
    const mgr = new SkillsManager("/nonexistent", undefined, false, undefined, inline);
    await mgr.initialize();
    const list = await mgr.list();
    expect(list.map((s) => s.name)).toEqual(["code-skill"]);
  });

  it("discovers skills from a CUSTOM skillsDir instead of .theokit/skills", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m22-skills-"));
    const __dirCleanup1 = dir;
    onTestFinished(async () => {
      await removeTempDirRobust(__dirCleanup1);
    });
    await writeSkill(dir, "research", "Research a topic");
    const mgr = new SkillsManager("/unused-cwd", undefined, true, dir);
    await mgr.initialize();
    const list = await mgr.list();
    expect(list.map((s) => s.name)).toContain("research");
  });

  it("merges inline over discovered — inline wins on a name conflict", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m22-skills-"));
    const __dirCleanup2 = dir;
    onTestFinished(async () => {
      await removeTempDirRobust(__dirCleanup2);
    });
    await writeSkill(dir, "shared", "the FILE version");
    const inline = [
      Skill.create({ name: "shared", description: "the INLINE version", instructions: "x" }),
    ];
    const mgr = new SkillsManager("/unused-cwd", undefined, true, dir, inline);
    await mgr.initialize();
    const list = await mgr.list();
    const shared = list.filter((s) => s.name === "shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]?.description).toBe("the INLINE version");
  });
});

describe("SE20 — SkillsManager.get(name) (full body)", () => {
  it("returns an inline skill's carried instructions", async () => {
    const inline = [
      Skill.create({
        name: "summarize",
        description: "Summarize",
        instructions: "Do a 2-line summary.",
      }),
    ];
    const mgr = new SkillsManager("/nonexistent", undefined, false, undefined, inline);
    await mgr.initialize();

    const skill = await mgr.get("summarize");
    expect(skill).toEqual({
      name: "summarize",
      description: "Summarize",
      instructions: "Do a 2-line summary.",
    });
  });

  it("reads a filesystem skill's body from its SKILL.md (frontmatter stripped)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "se20-skills-"));
    const __dirCleanup3 = dir;
    onTestFinished(async () => {
      await removeTempDirRobust(__dirCleanup3);
    });
    await writeSkill(dir, "research", "Research a topic");
    const mgr = new SkillsManager("/unused-cwd", undefined, true, dir);
    await mgr.initialize();

    const skill = await mgr.get("research");
    expect(skill?.name).toBe("research");
    expect(skill?.description).toBe("Research a topic");
    expect(skill?.instructions).toContain("Do the thing."); // the body, not the frontmatter
    expect(skill?.instructions).not.toContain("---"); // frontmatter stripped
  });

  it("returns undefined for an unknown skill name", async () => {
    const mgr = new SkillsManager("/nonexistent", undefined, false, undefined, []);
    await mgr.initialize();
    await expect(mgr.get("nope")).resolves.toBeUndefined();
  });

  it("surfaces an inline skill's references via get() (SE21)", async () => {
    const inline = [
      Skill.create({
        name: "release",
        description: "Release",
        instructions: "Run it.",
        references: { "format.md": "spec" },
      }),
    ];
    const mgr = new SkillsManager("/nonexistent", undefined, false, undefined, inline);
    await mgr.initialize();

    const skill = await mgr.get("release");
    expect(skill?.references).toEqual({ "format.md": "spec" });
  });
});
