/**
 * A discovered skill can become an inline one without a second parser.
 *
 * `SkillsSettings.inline` requires `instructions`, and `discoverSkills` returns only frontmatter
 * plus `source` — so the route was to open the file and split the frontmatter by hand, which is a
 * second implementation of this module's own convention and would fail SILENTLY if the format
 * moved. Reported by the `theocode` session, needing an operator's `~/.theokit/skills/` through
 * the SDK's own parser.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverSkills, loadSkillInstructions } from "../src/skills.js";

let dir: string;

function writeSkill(name: string, contents: string): void {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), contents);
}

describe("loadSkillInstructions", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "theokit-skill-body-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the body and NOT the frontmatter", async () => {
    writeSkill("probe", "---\nname: probe\ndescription: A probe.\n---\n\nThe body.\n");

    const [skill] = await discoverSkills(dir);
    const body = await loadSkillInstructions(skill!);

    expect(body).toBe("The body.");
    // The half that matters: hand-rolling this is what puts frontmatter into the instructions, and
    // nothing downstream would say so.
    expect(body, "frontmatter must not leak into the instructions").not.toContain("description:");
  });

  it("leaves the catalog shape alone — `Skill` still carries no body", async () => {
    writeSkill("probe", "---\nname: probe\ndescription: A probe.\n---\n\nThe body.\n");

    const [skill] = await discoverSkills(dir);

    // The written contract this selector exists to avoid widening.
    expect(skill).not.toHaveProperty("instructions");
    expect(Object.keys(skill!).sort()).toEqual(["description", "name", "source"]);
  });

  it("yields an empty string for a skill that is all frontmatter", async () => {
    writeSkill("empty", "---\nname: empty\ndescription: Nothing after this.\n---\n");

    const [skill] = await discoverSkills(dir);

    expect(await loadSkillInstructions(skill!)).toBe("");
  });

  it("throws when the source is unreadable, rather than answering with an empty body", async () => {
    writeSkill("gone", "---\nname: gone\ndescription: A probe.\n---\n\nBody.\n");
    const [skill] = await discoverSkills(dir);
    rmSync(join(dir, "gone"), { recursive: true, force: true });

    // Discovery skips what it cannot read; a caller naming ONE skill asked about that skill, and an
    // empty string would answer a different question.
    await expect(loadSkillInstructions(skill!)).rejects.toThrow();
  });
});
