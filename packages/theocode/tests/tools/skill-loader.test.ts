import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillTool } from "../../src/tools/skill-loader.js";

describe("createSkillTool", () => {
  let skillsDir: string;

  beforeEach(() => {
    skillsDir = join(tmpdir(), `theocode-skills-test-${Date.now()}`);
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "code-review.md"), "# Code Review\nReview all changes.");
    writeFileSync(join(skillsDir, "refactor.md"), "# Refactor\nImprove code structure.");
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  it("lists available skills", () => {
    const tool = createSkillTool({ skillsDir });

    const result = JSON.parse(tool.handler({ action: "list" }));

    expect(result.ok).toBe(true);
    expect(result.skills).toContain("code-review");
    expect(result.skills).toContain("refactor");
  });

  it("loads a specific skill by name", () => {
    const tool = createSkillTool({ skillsDir });

    const result = JSON.parse(tool.handler({ action: "load", name: "code-review" }));

    expect(result.ok).toBe(true);
    expect(result.name).toBe("code-review");
    expect(result.content).toContain("# Code Review");
  });

  it("returns not_found for missing skill", () => {
    const tool = createSkillTool({ skillsDir });

    const result = JSON.parse(tool.handler({ action: "load", name: "nonexistent" }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });

  it("rejects path traversal attempts", () => {
    const tool = createSkillTool({ skillsDir });

    const result = JSON.parse(tool.handler({ action: "load", name: "../etc/passwd" }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("path_traversal");
  });

  it("EC-1: rejects symlinks", () => {
    const target = join(skillsDir, "code-review.md");
    const link = join(skillsDir, "link-skill.md");
    symlinkSync(target, link);

    const tool = createSkillTool({ skillsDir });

    const result = JSON.parse(tool.handler({ action: "load", name: "link-skill" }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("symlink_rejected");
  });

  it("returns empty list for nonexistent directory", () => {
    const tool = createSkillTool({ skillsDir: join(skillsDir, "does-not-exist") });

    const result = JSON.parse(tool.handler({ action: "list" }));

    expect(result.ok).toBe(true);
    expect(result.skills).toEqual([]);
  });
});
