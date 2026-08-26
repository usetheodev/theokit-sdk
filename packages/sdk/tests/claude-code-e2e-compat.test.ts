import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DISCOVERY_SPECS, runDiscovery } from "../src/context/index.js";
import { readFactsFromMarkdown } from "../src/internal/memory/storage/markdown-store.js";
import { loadHookConfig } from "../src/internal/runtime/hooks/hooks-source.js";
import { PluginsManager } from "../src/internal/runtime/plugins/plugins-manager.js";
import { SkillsManager } from "../src/internal/runtime/skills/skills-manager.js";
import { loadSubagents } from "../src/internal/runtime/skills/subagents-loader.js";

/*
 * End-to-end: a project laid out for the Claude Code CLI, read by this SDK.
 *
 * Built from the REAL files in this repository's own `.claude` directory rather than fixtures —
 * fourteen agent declarations (a majority carrying `color`, plus a README with no frontmatter),
 * thirty-two plain-markdown rules, a settings.json whose hooks point at shell scripts. Those are the
 * shapes that broke, and a hand-written fixture would have been written to the shape that works.
 *
 * `.theokit` is untouched here on purpose: this asserts what a project that has NEVER heard of this
 * SDK presents to it.
 */
describe("a real Claude Code project, read end to end", () => {
  const repo = join(__dirname, "..", "..", "..");
  let cwd: string;
  let claudeHome: string;

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "cc-e2e-"));
    claudeHome = mkdtempSync(join(tmpdir(), "cc-e2e-home-"));
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(join(cwd, ".claude"), { recursive: true });
    for (const dir of ["agents", "rules"]) {
      cpSync(join(repo, ".claude", dir), join(cwd, ".claude", dir), { recursive: true });
    }
    cpSync(join(repo, ".claude", "settings.json"), join(cwd, ".claude", "settings.json"));
    writeFileSync(join(cwd, "CLAUDE.md"), "# Project\n\nThe project code is E2E-CLAUDEMD.\n");

    // A skill and a plugin bundle in the CLI's shapes.
    mkdirSync(join(cwd, ".claude", "skills", "greet"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "skills", "greet", "SKILL.md"),
      "---\nname: greet\ndescription: says hello.\n---\nBody.\n",
    );
    const bundle = join(cwd, ".claude", "plugins", "judge");
    mkdirSync(join(bundle, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(bundle, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "judge", version: "0.1.0", description: "bundle." }),
    );
    mkdirSync(join(bundle, "agents"), { recursive: true });
    writeFileSync(
      join(bundle, "agents", "bundled.md"),
      "---\nname: bundled\ndescription: from the bundle.\n---\nBody.\n",
    );

    // A memory in the CLI's own project store.
    const memDir = join(claudeHome, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(
      join(memDir, "fact.md"),
      "---\nname: fact\ndescription: a recorded fact\nmetadata:\n  node_type: memory\n  type: project\n---\n\nThe memory code is E2E-MEMORY.\n",
    );
  });

  it("test_the_agents_the_cli_project_declares_all_load", async () => {
    const loaded = await loadSubagents(cwd, true, undefined);
    // 14 files in the directory, one of which is a README with no frontmatter.
    expect(Object.keys(loaded).length).toBeGreaterThanOrEqual(13);
    expect(Object.keys(loaded)).toContain("bundled");
  });

  it("test_the_skill_the_cli_project_declares_loads", async () => {
    const mgr = new SkillsManager(cwd, undefined, true);
    await mgr.refresh();
    expect((await mgr.list()).map((s) => s.name)).toContain("greet");
  });

  it("test_the_plugin_bundle_is_registered", async () => {
    const mgr = new PluginsManager(cwd, undefined, true, false, undefined);
    await mgr.initialize();
    expect((await mgr.list()).map((p) => p.name)).toContain("judge");
  });

  it("test_the_rules_and_claude_md_reach_the_context", async () => {
    const found = (await runDiscovery({
      cwd,
      specs: DEFAULT_DISCOVERY_SPECS,
      maxBytesPerFile: 200_000,
    })) as { id: string; content: string }[];
    expect(found.map((f) => f.id)).toContain("CLAUDE.md");
    expect(found.some((f) => f.id.startsWith("claude-rules"))).toBe(true);
  });

  it("test_the_hooks_declared_in_the_cli_settings_file_load", async () => {
    const config = await loadHookConfig(cwd);
    expect(Object.keys(config.hooks ?? {}).length).toBeGreaterThan(0);
  });

  it("test_a_memory_the_cli_recorded_is_read", async () => {
    const facts = await readFactsFromMarkdown(cwd);
    expect(facts.map((f) => f.text).join(" ")).toContain("E2E-MEMORY");
  });

  it("test_the_project_never_needed_a_theokit_directory", () => {
    expect(existsSync(join(cwd, ".theokit"))).toBe(false);
  });
});
