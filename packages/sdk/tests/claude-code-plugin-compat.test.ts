import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PluginsManager } from "../src/internal/runtime/plugin-loader/plugins-manager.js";
import { SkillsManager } from "../src/internal/runtime/skills/skills-manager.js";
import { loadSubagents } from "../src/internal/runtime/skills/subagents-loader.js";

/*
 * Plugins written for the Claude Code CLI.
 *
 * Measured 2026-08-26 against an installed one. A CLI plugin is a BUNDLE: its manifest sits at
 * `<plugin>/.claude-plugin/plugin.json`, and what it contributes are the `skills/`, `agents/`,
 * `commands/` and `hooks/` directories beside it. This SDK's own plugin concept is a JS `entry`
 * point, so the manifest parsed here (zod strips the unknown keys) and then did nothing at all:
 * `name` and `version` survived, and the seven agents and three skills the plugin exists to provide
 * were invisible.
 *
 * The manifest agreeing was never the point. A plugin whose contents nobody loads is a plugin that
 * does not work, which is why these cases assert the SKILLS AND AGENTS, not the metadata.
 */
describe("plugins written for the Claude Code CLI", () => {
  let cwd: string;

  const writeBundle = (root: string, name: string): string => {
    const dir = join(cwd, root, "plugins", name);
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name, version: "1.2.3", description: "A CLI-shaped bundle." }),
    );
    return dir;
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cc-plugin-compat-"));
  });

  it("test_a_manifest_in_the_cli_location_is_read", async () => {
    writeBundle(".claude", "judge");
    const mgr = new PluginsManager(cwd, undefined, true, false, undefined);
    await mgr.initialize();
    expect((await mgr.list()).map((p) => p.name)).toEqual(["judge"]);
  });

  it("test_the_agents_a_bundle_contributes_are_loaded", async () => {
    const dir = writeBundle(".claude", "judge");
    mkdirSync(join(dir, "agents"), { recursive: true });
    writeFileSync(
      join(dir, "agents", "reviewer.md"),
      "---\nname: reviewer\ndescription: from the bundle.\ncolor: red\n---\nBody.\n",
    );
    const loaded = await loadSubagents(cwd, true, undefined);
    expect(Object.keys(loaded)).toContain("reviewer");
  });

  it("test_the_skills_a_bundle_contributes_are_loaded", async () => {
    const dir = writeBundle(".claude", "judge");
    mkdirSync(join(dir, "skills", "verdict"), { recursive: true });
    writeFileSync(
      join(dir, "skills", "verdict", "SKILL.md"),
      "---\nname: verdict\ndescription: from the bundle.\n---\nBody.\n",
    );
    const mgr = new SkillsManager(cwd, undefined, true);
    await mgr.refresh();
    expect((await mgr.list()).map((s) => s.name)).toContain("verdict");
  });

  // The accepted case (rules/testing.md § 4.2): a project with no plugin bundles must still load
  // cleanly, or scanning for them would have turned "none installed" into an error.
  it("test_a_project_with_no_bundles_loads_nothing_and_does_not_fail", async () => {
    const mgr = new SkillsManager(cwd, undefined, true);
    await mgr.refresh();
    expect(await mgr.list()).toEqual([]);
    expect(await loadSubagents(cwd, true, undefined)).toEqual({});
  });
});
