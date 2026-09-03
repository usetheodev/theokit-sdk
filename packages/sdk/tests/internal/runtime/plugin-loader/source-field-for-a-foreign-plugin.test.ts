import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PluginsManager } from "../../../../src/internal/runtime/plugin-loader/plugins-manager.js";
import { removeTempDirRobustSync } from "../../../helpers/temp-workspace.js";

/**
 * The `source` field this suite's sibling made reachable — `agent.plugins.list()` already returned
 * it, only the public TYPE did not declare it — was itself broken for a foreign-root plugin.
 *
 * Both manifest loaders (Claude Code's `.claude-plugin/plugin.json` and this SDK's own
 * `PLUGIN.md`/`plugin.json`) built `source` by searching the manifest path for the literal
 * substring `.theokit/` and slicing from there. A manifest read from `.claude/plugins/<name>/…`
 * contains no such substring: `indexOf` returns -1, and `.slice(-1)` returns the LAST CHARACTER of
 * the path — `n`, from `.json` — instead of a relative path. The very audit trail #524 asks for
 * would show a single letter for exactly the case it exists to make visible.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempDirRobustSync(d);
});

function workspaceWithForeignPlugin(manifest: ".claude-plugin" | "PLUGIN.md"): string {
  const ws = mkdtempSync(join(tmpdir(), "plugin-source-field-"));
  dirs.push(ws);
  const pluginDir = join(ws, ".claude", "plugins", "my-plugin");
  if (manifest === ".claude-plugin") {
    mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(pluginDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "my-plugin", version: "1.0.0" }),
    );
  } else {
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "PLUGIN.md"),
      "---\nname: my-plugin\nversion: 1.0.0\n---\n\nBody.\n",
    );
  }
  return ws;
}

describe("a foreign plugin's source field is a real relative path", () => {
  it("for the Claude Code CLI manifest form (.claude-plugin/plugin.json)", async () => {
    const ws = workspaceWithForeignPlugin(".claude-plugin");
    const manager = new PluginsManager(ws, undefined, true, false, undefined, ["claude-code"]);

    await manager.initialize();

    const source = (await manager.list()).find((p) => p.name === "my-plugin")?.source;
    expect(source).toBe(join(".claude", "plugins", "my-plugin", ".claude-plugin", "plugin.json"));
  });

  it("for this SDK's own manifest form (PLUGIN.md)", async () => {
    const ws = workspaceWithForeignPlugin("PLUGIN.md");
    const manager = new PluginsManager(ws, undefined, true, false, undefined, ["claude-code"]);

    await manager.initialize();

    const source = (await manager.list()).find((p) => p.name === "my-plugin")?.source;
    expect(source).toBe(join(".claude", "plugins", "my-plugin", "PLUGIN.md"));
  });
});
