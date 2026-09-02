import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { projectConfigRoots } from "../../../../src/internal/persistence/paths.js";
import { HooksExecutor } from "../../../../src/internal/runtime/hooks/hooks-executor.js";
import { loadSubagents } from "../../../../src/internal/runtime/skills/subagents-loader.js";
import { removeTempDirRobustSync } from "../../../helpers/temp-workspace.js";

/**
 * usetheokit/theokit-sdk#524 — `.claude/` was read by DEFAULT, across four subsystems, with no
 * opt-in anywhere.
 *
 * A directory containing only `.claude/` — no `.theokit/`, no configuration of this SDK at all —
 * had its hooks executed, its skills folded into the system prompt, and its subagents registered.
 * The measured consequence was #522: every turn denied in a repository whose only unusual property
 * was having Claude Code set up.
 *
 * ## Trust is not consent
 *
 * A consumer's trust gate already decides whether project sources are read at all, and it was doing
 * double duty as the answer to a different question. "Do I trust the code in this directory?" and
 * "do I want another product's configuration imported into this one?" come apart in the ordinary
 * case: I trust my own repository completely, and that is exactly where `.claude/` is populated —
 * for a different tool, by a different contract, often by a teammate who never heard of this SDK.
 *
 * The skills case is the quiet one. A skill's text enters the system prompt, so importing prompt
 * content from a directory this SDK does not own is a prompt-injection surface nobody opted into.
 */
function workspaceWithOnlyClaude(): string {
  const dir = mkdtempSync(join(tmpdir(), "theokit-524-"));
  onTestFinished(() => {
    removeTempDirRobustSync(dir);
  });
  mkdirSync(join(dir, ".claude", "agents"), { recursive: true });
  mkdirSync(join(dir, ".claude", "hooks"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "agents", "leaked-agent.md"),
    "---\nname: leaked-agent\ndescription: from a directory nobody declared.\n---\nBody.\n",
  );
  writeFileSync(
    join(dir, ".claude", "settings.json"),
    JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "exit 1" }] }] },
    }),
  );
  return dir;
}

describe("a foreign configuration source is not read until it is declared", () => {
  it("resolves only the native root by default", () => {
    expect(projectConfigRoots("/w")).toEqual([join("/w", ".theokit")]);
  });

  it("resolves a declared source, native first for precedence", () => {
    // On a name collision the native definition wins: it is the one the project wrote for THIS
    // runtime. `subagents-loader` documents first-occurrence-wins, so order is the contract.
    expect(projectConfigRoots("/w", ["claude-code"])).toEqual([
      join("/w", ".theokit"),
      join("/w", ".claude"),
    ]);
  });

  it("ignores an unknown source rather than inventing a directory for it", () => {
    // A typo must fail closed. Reading `<cwd>/.codex` because someone wrote "codex" before the
    // adapter exists would import a dialect nothing knows how to parse.
    expect(projectConfigRoots("/w", ["codex" as never])).toEqual([join("/w", ".theokit")]);
  });

  it("does not register subagents from an undeclared .claude/", async () => {
    const dir = workspaceWithOnlyClaude();

    const agents = await loadSubagents(dir, true, undefined);

    expect(Object.keys(agents)).not.toContain("leaked-agent");
  });

  it("registers them once the source is declared", async () => {
    // The counter-proof: opting in must restore exactly today's behaviour, or this is a removal
    // wearing the costume of a default change.
    const dir = workspaceWithOnlyClaude();

    const agents = await loadSubagents(dir, true, undefined, ["claude-code"]);

    expect(Object.keys(agents)).toContain("leaked-agent");
  });

  it("does not run hooks from an undeclared .claude/", async () => {
    const dir = workspaceWithOnlyClaude();

    const hooks = new HooksExecutor(dir);
    await hooks.initialize(true);
    const decision = await hooks.run({ event: "preToolUse", tool: "shell", input: {} });

    expect(decision.blocked, "a hook nobody declared decided whether a tool may run").toBe(false);
  });

  it("runs them once the source is declared", async () => {
    const dir = workspaceWithOnlyClaude();

    const hooks = new HooksExecutor(dir, ["claude-code"]);
    await hooks.initialize(true);
    const decision = await hooks.run({ event: "preToolUse", tool: "shell", input: {} });

    expect(decision.blocked).toBe(true);
  });
});
