/**
 * Tests for PluginsManager MD-first + path-traversal guard (T3.2, EC-1 fix).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PluginsManager } from "../../../src/internal/runtime/plugins-manager.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "plugins-mgr-"));
  mkdirSync(join(dir, ".theokit", "plugins"), { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePlugin(name: string, files: Record<string, string>): void {
  const pluginDir = join(dir, ".theokit", "plugins", name);
  mkdirSync(pluginDir, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(pluginDir, filename), content, "utf8");
  }
}

describe("PluginsManager — MD-first", () => {
  it("loads from PLUGIN.md", async () => {
    writePlugin("openrouter", {
      "PLUGIN.md": [
        "---",
        "name: openrouter",
        "version: 1.2.0",
        "entry: index.js",
        "---",
        "OpenRouter chat provider.",
      ].join("\n"),
      "index.js": "module.exports = {};",
    });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);
    await mgr.initialize();
    const list = await mgr.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("openrouter");
    expect(list[0]?.version).toBe("1.2.0");
  });

  it("falls back to plugin.json with deprecation warn", async () => {
    writePlugin("anthropic", {
      "plugin.json": JSON.stringify({ name: "anthropic", version: "1.0", entry: "index.js" }),
      "index.js": "module.exports = {};",
    });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);
    await mgr.initialize();
    const list = await mgr.list();
    expect(list[0]?.name).toBe("anthropic");
  });

  it("both files present → MD wins", async () => {
    writePlugin("dual", {
      "PLUGIN.md": ["---", "name: dual", "version: 2.0.0", "entry: index.js", "---"].join("\n"),
      "plugin.json": JSON.stringify({ name: "dual", version: "1.0", entry: "old.js" }),
      "index.js": "module.exports = {};",
    });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);
    await mgr.initialize();
    const list = await mgr.list();
    expect(list[0]?.version).toBe("2.0.0"); // MD version
  });
});

describe("PluginsManager — path-traversal guard (EC-1 fix)", () => {
  it("rejects PLUGIN.md with entry containing `..`", async () => {
    writePlugin("malicious-md", {
      "PLUGIN.md": ["---", "name: malicious-md", "entry: ../../etc/passwd", "---"].join("\n"),
    });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);
    await expect(mgr.initialize()).rejects.toMatchObject({
      code: "plugin_entry_escape",
    });
  });

  it("rejects PLUGIN.md with absolute entry path", async () => {
    writePlugin("malicious-abs", {
      "PLUGIN.md": ["---", "name: malicious-abs", "entry: /etc/shadow", "---"].join("\n"),
    });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);
    await expect(mgr.initialize()).rejects.toMatchObject({
      code: "plugin_entry_escape",
    });
  });

  it("rejects plugin.json fallback with traversal entry", async () => {
    writePlugin("malicious-json", {
      "plugin.json": JSON.stringify({
        name: "malicious-json",
        entry: "../../../../../etc/passwd",
      }),
    });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);
    await expect(mgr.initialize()).rejects.toMatchObject({
      code: "plugin_entry_escape",
    });
  });
});
