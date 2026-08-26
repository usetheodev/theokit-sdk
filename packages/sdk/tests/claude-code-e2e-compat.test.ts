import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
 * The fixture is BUILT, not copied. An earlier version of this file read the real `.claude`
 * directory at the repository root, and that made it green on every machine and red on the only
 * one that matters: `.claude/` is never versioned here, so it exists for every developer and for no
 * CI runner. A test whose pass depends on something that is not the behaviour under test is the
 * exact defect this whole change set was fixing, arriving through the back door.
 *
 * What mattered was never those particular files — it was the SHAPES that broke, so they are
 * written out explicitly below and the test now says what it exercises instead of inheriting it:
 * agents carrying the CLI's `color`, a `README.md` with no frontmatter beside them, rules as plain
 * markdown with no frontmatter at all, and hooks declared in `settings.json` rather than a
 * hooks file.
 *
 * `.theokit` is never created here, and that is asserted: this measures what a project which has
 * NEVER heard of this SDK presents to it.
 */
describe("a real Claude Code project, read end to end", () => {
  let cwd: string;
  let claudeHome: string;

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "cc-e2e-"));
    claudeHome = mkdtempSync(join(tmpdir(), "cc-e2e-home-"));
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(join(cwd, ".claude", "agents"), { recursive: true });
    // A majority of real CLI agents carry `color`; it was the field that made them a load error.
    for (const [name, extra] of [
      ["reviewer", "color: blue"],
      ["planner", "color: green"],
      ["auditor", "model: sonnet\ncolor: red"],
      ["scribe", ""],
    ] as const) {
      writeFileSync(
        join(cwd, ".claude", "agents", `${name}.md`),
        `---\nname: ${name}\ndescription: ${name} specialist.\ntools: Read, Grep\n${extra}\n---\nBody.\n`,
      );
    }
    // Documentation beside them: one such file used to abort the whole directory.
    writeFileSync(join(cwd, ".claude", "agents", "README.md"), "# The specialists\n\nProse.\n");

    // Rules as the CLI writes them — plain markdown, no frontmatter.
    mkdirSync(join(cwd, ".claude", "rules"), { recursive: true });
    for (const name of ["testing", "architecture", "git-safety"]) {
      writeFileSync(
        join(cwd, ".claude", "rules", `${name}.md`),
        `# ${name}\n\nSource of truth for ${name}.\n`,
      );
    }

    // Hooks where the CLI actually keeps them, beside the keys it keeps alongside.
    writeFileSync(
      join(cwd, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { allow: ["Bash"] },
        env: { EXAMPLE: "1" },
        hooks: {
          PreToolUse: [
            { matcher: "shell", hooks: [{ type: "command", command: "echo pre", timeout: 30 }] },
          ],
          Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
          // No firing point in this runtime: skipped with a warn, never accepted.
          SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
        },
      }),
    );
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
    // Four declarations plus the bundle's; the README contributes nothing and stops nothing.
    expect(Object.keys(loaded).sort()).toEqual([
      "auditor",
      "bundled",
      "planner",
      "reviewer",
      "scribe",
    ]);
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
    expect(Object.keys(config.hooks ?? {}).sort()).toEqual(["preToolUse", "stop"]);
  });

  it("test_a_hook_event_this_runtime_never_fires_is_not_silently_accepted", async () => {
    // SessionStart has no firing point here. Accepting it would register a hook that never runs,
    // which reads to an operator exactly like a hook that ran and did nothing.
    const config = await loadHookConfig(cwd);
    expect(JSON.stringify(config)).not.toContain("echo start");
  });

  it("test_a_memory_the_cli_recorded_is_read", async () => {
    const facts = await readFactsFromMarkdown(cwd);
    expect(facts.map((f) => f.text).join(" ")).toContain("E2E-MEMORY");
  });

  it("test_the_project_never_needed_a_theokit_directory", () => {
    expect(existsSync(join(cwd, ".theokit"))).toBe(false);
  });
});
