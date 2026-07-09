import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createSkill } from "../../src/create-skill.js";
import { SkillsManager } from "../../src/internal/runtime/skills/skills-manager.js";

/**
 * M22 — inline `createSkill()` + custom `skillsDir`. Inline skills need no SKILL.md; a custom dir
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

describe("M22 — createSkill", () => {
  it("builds an inline skill with a synthetic source + carried instructions", () => {
    const skill = createSkill({
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
    expect(() => createSkill({ name: "", description: "d", instructions: "i" })).toThrow(/name/);
    expect(() => createSkill({ name: "n", description: "", instructions: "i" })).toThrow(
      /description/,
    );
  });
});

describe("M22 — SkillsManager inline + skillsDir", () => {
  it("surfaces inline skills via list() even without a project skills dir", async () => {
    const inline = [
      createSkill({ name: "code-skill", description: "A code-defined skill", instructions: "..." }),
    ];
    const mgr = new SkillsManager("/nonexistent", undefined, false, undefined, inline);
    await mgr.initialize();
    const list = await mgr.list();
    expect(list.map((s) => s.name)).toEqual(["code-skill"]);
  });

  it("discovers skills from a CUSTOM skillsDir instead of .theokit/skills", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m22-skills-"));
    await writeSkill(dir, "research", "Research a topic");
    const mgr = new SkillsManager("/unused-cwd", undefined, true, dir);
    await mgr.initialize();
    const list = await mgr.list();
    expect(list.map((s) => s.name)).toContain("research");
  });

  it("merges inline over discovered — inline wins on a name conflict", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m22-skills-"));
    await writeSkill(dir, "shared", "the FILE version");
    const inline = [
      createSkill({ name: "shared", description: "the INLINE version", instructions: "x" }),
    ];
    const mgr = new SkillsManager("/unused-cwd", undefined, true, dir, inline);
    await mgr.initialize();
    const list = await mgr.list();
    const shared = list.filter((s) => s.name === "shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]?.description).toBe("the INLINE version");
  });
});
