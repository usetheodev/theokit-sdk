import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
  /**
   * The public barrel, loaded ONCE for the whole file.
   *
   * It used to be `await import("../src/index.js")` inside each of the three agent tests, and the
   * cost of transforming the barrel's module graph therefore landed entirely on whichever test ran
   * first — against the same 20s budget as its own work, while its two siblings, doing the same
   * work, got a warm cache. Under full-suite load that first test timed out at 20029ms; measured
   * twice, and a run in between where it passed is what made it look like flakiness rather than an
   * asymmetry. The import is dynamic and not static because `beforeAll` sets CLAUDE_CONFIG_DIR and
   * the barrel must not be evaluated before it.
   *
   * This does not widen any budget. It stops one test paying for three.
   */
  let Agent: typeof import("../src/index.js")["Agent"];

  beforeAll(async () => {
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
    ({ Agent } = await import("../src/index.js"));
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

  /*
   * What "no `.theokit` needed" actually means (#439).
   *
   * This used to be one assertion against the shared `cwd`, and it passed only because it was
   * DECLARED before the two cases that run an agent there. Shuffled, it failed on 3 of 5 seeds —
   * `rules/testing.md` § 6 calls that a bug, and the guarantee it was defending is one of the
   * central claims of the compatibility work, so it was defending it by accident.
   *
   * The guarantee is narrower than the old name suggested, and worth writing as it is: READING a
   * Claude Code project creates nothing. Running an agent creates `.theokit/`, and what appears
   * there is this SDK's own state — the agent registry and the memory SQLite index — not Claude
   * Code format. The index stays in the project even when the facts go to the CLI's directory,
   * deliberately: the CLI has no index format for it to go to.
   *
   * Each case gets its own `cwd` so neither can decide the other's result.
   */
  it("test_reading_a_cli_project_creates_nothing_in_it", async () => {
    const readOnly = mkdtempSync(join(tmpdir(), "cc-e2e-read-"));
    mkdirSync(join(readOnly, ".claude", "agents"), { recursive: true });
    writeFileSync(
      join(readOnly, ".claude", "agents", "solo.md"),
      "---\nname: solo\ndescription: only agent.\n---\nBody.\n",
    );
    writeFileSync(join(readOnly, "CLAUDE.md"), "# Project\n\nRead me.\n");

    await loadSubagents(readOnly, true, undefined);
    await runDiscovery({ cwd: readOnly, specs: DEFAULT_DISCOVERY_SPECS, maxBytesPerFile: 200_000 });
    await readFactsFromMarkdown(readOnly);

    expect(existsSync(join(readOnly, ".theokit"))).toBe(false);
  });

  // The counterpart, and the reason the case above is not vacuous: running an agent DOES create the
  // directory. Asserting only the first half would let "creates nothing, ever" pass unchallenged.
  it("test_running_an_agent_creates_theokit_and_only_sdk_state_in_it", async () => {
    const ran = mkdtempSync(join(tmpdir(), "cc-e2e-ran-"));
    const agent = await Agent.create({
      model: { id: "anthropic/claude-sonnet-4-6" },
      apiKey: "theo_test_e2e",
      local: { cwd: ran, sessionDir: claudeHome },
      memory: { enabled: true },
    });
    await agent.send("hello");

    expect(existsSync(join(ran, ".theokit"))).toBe(true);
    // Only this SDK's own state — nothing here is a Claude Code shape the CLI would try to read.
    expect(readdirSync(join(ran, ".theokit")).sort()).toEqual(["agents", "memory"]);
  });

  // The other direction, and the one the scope named: a memory this SDK records has to land where
  // the CLI looks, not only be able to read what the CLI wrote.
  //
  // `memory.directory` is the switch, and it used to be `local.sessionDir`. The transcript home
  // answered "where does memory go?" as a side effect, and only the writer heard the answer — the
  // indexer and the `memory_get` guard kept reading the project store (#463). One option, one
  // question.
  it("test_a_memory_this_agent_records_lands_where_the_cli_reads", async () => {
    const cliMemory = join(claudeHome, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
    const agent = await Agent.create({
      model: { id: "anthropic/claude-sonnet-4-6" },
      apiKey: "theo_test_e2e",
      local: { cwd, sessionDir: claudeHome },
      memory: { enabled: true, directory: cliMemory },
    });
    await agent.send("Remember (feedback): shared with the cli");

    const written = readFileSync(join(cliMemory, "shared-cli.md"), "utf8");
    expect(written).toContain("type: feedback");
    // The index the CLI reads has to name it, and has to sit beside it.
    expect(readFileSync(join(cliMemory, "MEMORY.md"), "utf8")).toContain("shared-cli.md");
  });

  it("test_without_a_configured_directory_nothing_moves", async () => {
    const plain = mkdtempSync(join(tmpdir(), "cc-e2e-plain-"));
    const agent = await Agent.create({
      model: { id: "anthropic/claude-sonnet-4-6" },
      apiKey: "theo_test_e2e",
      local: { cwd: plain },
      memory: { enabled: true },
    });
    await agent.send("Remember: stays put");
    expect(existsSync(join(plain, ".theokit", "memory", "stays-put.md"))).toBe(true);
  });
});
