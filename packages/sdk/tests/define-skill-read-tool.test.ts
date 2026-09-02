import { describe, expect, it } from "vitest";

import { Skill } from "../src/create-skill.js";
import { SkillReadTool } from "../src/define-skill-read-tool.js";

/**
 * SE23 — `SkillReadTool`: an OPT-IN `skill_read` tool that gives the model
 * on-demand access to a skill's body + references. Never auto-injected — the
 * consumer adds it to `tools` (bring-your-own-tools).
 */

const skills = [
  Skill.create({
    name: "release",
    description: "Release checklist",
    instructions: "Run the release checklist end to end.",
    references: { "changelog-format.md": "Keep a Changelog." },
  }),
  Skill.create({
    name: "summarize",
    description: "Summarize text",
    instructions: "Produce a 2-sentence summary.",
  }),
];

describe("SE23 — SkillReadTool", () => {
  it("returns a valid CustomTool named skill_read", () => {
    const tool = SkillReadTool.create(skills);
    expect(tool.name).toBe("skill_read");
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.inputSchema).toMatchObject({ type: "object" });
    expect(typeof tool.handler).toBe("function");
  });

  it("returns a skill's instructions AND references by name (SE21)", async () => {
    const tool = SkillReadTool.create(skills);
    const out = await tool.handler({ name: "release" });
    expect(out).toContain("Run the release checklist end to end.");
    expect(out).toContain("changelog-format.md");
    expect(out).toContain("Keep a Changelog.");
  });

  it("returns instructions with no References section when the skill has none", async () => {
    const tool = SkillReadTool.create(skills);
    const out = await tool.handler({ name: "summarize" });
    expect(out).toContain("Produce a 2-sentence summary.");
    expect(out).not.toContain("## References");
  });

  it("returns a typed not-found result for an unknown name — no throw (Rule 8)", async () => {
    const tool = SkillReadTool.create(skills);
    const out = await tool.handler({ name: "does-not-exist" });
    expect(out).toContain("not found");
    // lists the available skills so the model can recover
    expect(out).toContain("release");
    expect(out).toContain("summarize");
  });

  it("throws on malformed input (missing name) — trust-boundary validation", () => {
    const tool = SkillReadTool.create(skills);
    // Measured: ZodError — the `name` field is absent, so the issue names the expected type.
    expect(() => tool.handler({} as Record<string, unknown>)).toThrow(/"expected": "string"/);
  });

  it("throws on malformed input (empty name) — the min(1) boundary", () => {
    const tool = SkillReadTool.create(skills);
    // Measured: ZodError again, and a DIFFERENT issue shape — the value is present and empty, so the
    // issue reports the origin rather than the expected type. Getting these two the wrong way round
    // is exactly what a bare `toThrow()` cannot tell you.
    expect(() => tool.handler({ name: "" })).toThrow(/"origin": "string"/);
  });

  it("fails fast at construction on a duplicate skill name (Rule 8)", () => {
    const dupes = [
      Skill.create({ name: "dup", description: "first", instructions: "a" }),
      Skill.create({ name: "dup", description: "second", instructions: "b" }),
    ];
    expect(() => SkillReadTool.create(dupes)).toThrow(/duplicate skill name "dup"/);
  });

  it("reports (none) available when the factory is given an empty skill set", async () => {
    const tool = SkillReadTool.create([]);
    const out = await tool.handler({ name: "anything" });
    expect(out).toContain("not found");
    expect(out).toContain("(none)");
  });
});
