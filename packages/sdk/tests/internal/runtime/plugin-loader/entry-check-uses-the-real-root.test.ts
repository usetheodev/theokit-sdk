import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PluginsManager } from "../../../../src/internal/runtime/plugin-loader/plugins-manager.js";
import { removeTempDirRobustSync } from "../../../helpers/temp-workspace.js";

/**
 * A plugin discovered from a FOREIGN root had its entry file checked against the NATIVE root.
 *
 * `refresh()` iterates every root `pluginBundleRoots()` returns — `.theokit/plugins` and, when a
 * compat source admits the `plugins` surface, `.claude/plugins` too — and calls `refreshRoot(root)`
 * once per root. `assertEntryFileExists`, called from inside that loop, does not receive which root
 * it is checking: it reconstructs `join(this.cwd, ".theokit", "plugins", folderName)` unconditionally.
 * A plugin discovered under `.claude/plugins/<name>` was therefore checked against
 * `.theokit/plugins/<name>` — a directory that plugin never lived in.
 *
 * This is reachable, not theoretical: `compatSources: ["claude-code"]` has always admitted the
 * `plugins` surface (the per-surface form added tonight only makes it possible to admit LESS, never
 * more), so any consumer who declared it and had `.claude/plugins/<name>/PLUGIN.md` on disk with a
 * declared `entry` was hitting this.
 *
 * The failure mode observed depends on what happens to sit at the wrong path: with nothing there,
 * a legitimate foreign plugin is refused as "entry file is missing." Worse, a `.theokit/plugins/`
 * folder that happens to share the SAME NAME would have its entry file read instead — a path
 * confusion the ADR D79-D80 path-traversal guard this function calls does not protect against,
 * because the traversal check runs against the WRONG root, not against none.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempDirRobustSync(d);
});

function workspaceWithForeignPlugin(): string {
  const ws = mkdtempSync(join(tmpdir(), "plugin-root-confusion-"));
  dirs.push(ws);
  const pluginDir = join(ws, ".claude", "plugins", "my-plugin");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, "PLUGIN.md"),
    "---\nname: my-plugin\nversion: 1.0.0\nentry: index.js\n---\n\nBody.\n",
  );
  writeFileSync(join(pluginDir, "index.js"), "module.exports = {};\n");
  return ws;
}

describe("a foreign plugin's entry file is checked against the root it was found in", () => {
  it("does not report a missing entry for a foreign plugin whose entry file exists", async () => {
    const ws = workspaceWithForeignPlugin();
    const manager = new PluginsManager(ws, undefined, true, false, undefined, ["claude-code"]);

    await manager.initialize();

    const list = await manager.list();
    expect(list.map((p) => p.name)).toContain("my-plugin");
  });
});
