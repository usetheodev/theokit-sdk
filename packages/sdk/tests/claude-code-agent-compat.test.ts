import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadSubagents } from "../src/internal/runtime/skills/subagents-loader.js";

/*
 * Compatibility with agents authored for the Claude Code CLI.
 *
 * Measured 2026-08-26 over the 59 agent files on this machine (project `.claude/agents` plus every
 * installed plugin): `name` and `description` and `tools` appear in all 59, `model` in 46, and
 * `color` in 38. The first four are fields this loader already reads. `color` is the CLI's label
 * colour — it changes nothing about what the agent may do — and it made the loader throw
 * `subagent_unknown_field`, so a majority of real agent files could not be loaded at all.
 *
 * The strict check is NOT loosened. Its reason is sound and stated where it lives: a dropped
 * `sandbox` that an operator wrote believing it confines the child is a silent gate. A field that
 * could change behaviour must still fail loudly. What changes is that fields KNOWN to be inert are
 * named, so "we understand this and it does nothing" stops being indistinguishable from "we have
 * never heard of this".
 */
describe("agents written for the Claude Code CLI", () => {
  let cwd: string;

  const writeAgent = (frontmatter: string): void => {
    mkdirSync(join(cwd, ".theokit", "agents"), { recursive: true });
    writeFileSync(
      join(cwd, ".theokit", "agents", "probe.md"),
      `---\n${frontmatter}\n---\nCorpo do prompt.\n`,
    );
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cc-agent-compat-"));
  });

  it("test_an_agent_carrying_the_cli_colour_field_loads", async () => {
    writeAgent("name: probe\ndescription: sonda.\ntools: Read, Grep\ncolor: blue");
    const loaded = await loadSubagents(cwd, true, undefined);
    expect(Object.keys(loaded)).toEqual(["probe"]);
  });

  it("test_the_colour_is_ignored_rather_than_carried_into_the_definition", async () => {
    writeAgent("name: probe\ndescription: sonda.\ncolor: blue");
    const loaded = await loadSubagents(cwd, true, undefined);
    expect(loaded.probe).not.toHaveProperty("color");
  });

  it("test_every_field_the_cli_writes_loads_together", async () => {
    writeAgent("name: probe\ndescription: sonda.\ntools: Read, Grep\nmodel: sonnet\ncolor: blue");
    const loaded = await loadSubagents(cwd, true, undefined);
    expect(loaded.probe?.description).toBe("sonda.");
    expect(loaded.probe?.tools).toEqual(["Read", "Grep"]);
  });

  // A directory of agents written for the CLI conventionally carries documentation beside them.
  // `.claude/agents/README.md` exists in this repository and is cited by `cycle-maintenance.md`.
  // Before this, one such file made the loader throw and NOT ONE agent in the directory loaded.
  it("test_documentation_beside_the_agents_does_not_stop_every_agent_from_loading", async () => {
    writeAgent("name: probe\ndescription: sonda.");
    writeFileSync(join(cwd, ".theokit", "agents", "README.md"), "# Os especialistas\n\nProsa.\n");
    const loaded = await loadSubagents(cwd, true, undefined);
    expect(Object.keys(loaded)).toEqual(["probe"]);
  });

  // A file with NO frontmatter is not an agent declaration. A file WITH frontmatter that is wrong
  // is a broken agent, and must still fail — otherwise a typo'd `sandbox` returns as a silent gate
  // through the other door.
  it("test_an_agent_whose_frontmatter_is_present_but_wrong_still_fails", async () => {
    writeAgent("name: probe\ndescription: sonda.\nbogus_field: 1");
    await expect(loadSubagents(cwd, true, undefined)).rejects.toMatchObject({
      code: "subagent_unknown_field",
    });
  });

  // The half of the oracle that proves the guard still guards (rules/testing.md § 4.2): without
  // these, accepting every field would pass the three above and the silent-gate class would be back.
  it("test_a_genuinely_unknown_field_is_still_a_typed_load_error", async () => {
    writeAgent("name: probe\ndescription: sonda.\nescalate_privileges: true");
    await expect(loadSubagents(cwd, true, undefined)).rejects.toMatchObject({
      code: "subagent_unknown_field",
    });
  });

  it("test_a_misspelt_sandbox_is_still_refused_rather_than_dropped", async () => {
    writeAgent("name: probe\ndescription: sonda.\nsandboxed: false");
    await expect(loadSubagents(cwd, true, undefined)).rejects.toMatchObject({
      code: "subagent_unknown_field",
    });
  });

  // Location, not format: these same files were already parseable — nothing looked in `.claude`.
  it("test_an_agent_declared_under_dot_claude_is_loaded", async () => {
    mkdirSync(join(cwd, ".claude", "agents"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "agents", "cli-agent.md"),
      "---\nname: cli-agent\ndescription: vindo do .claude.\ncolor: green\n---\nCorpo.\n",
    );
    const loaded = await loadSubagents(cwd, true, undefined);
    expect(Object.keys(loaded)).toEqual(["cli-agent"]);
  });

  it("test_agents_from_both_directories_are_merged", async () => {
    writeAgent("name: theokit-agent\ndescription: do .theokit.");
    mkdirSync(join(cwd, ".claude", "agents"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "agents", "cli-agent.md"),
      "---\nname: cli-agent\ndescription: do .claude.\n---\nCorpo.\n",
    );
    const loaded = await loadSubagents(cwd, true, undefined);
    expect(Object.keys(loaded).sort()).toEqual(["cli-agent", "theokit-agent"]);
  });

  it("test_the_explicit_namespace_wins_when_both_declare_the_same_name", async () => {
    writeAgent("name: shared\ndescription: DO THEOKIT.");
    mkdirSync(join(cwd, ".claude", "agents"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "agents", "shared.md"),
      "---\nname: shared\ndescription: do claude.\n---\nCorpo.\n",
    );
    const loaded = await loadSubagents(cwd, true, undefined);
    expect(loaded.shared?.description).toBe("DO THEOKIT.");
  });
});
