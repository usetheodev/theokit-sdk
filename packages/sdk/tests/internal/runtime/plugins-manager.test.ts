/**
 * Tests for PluginsManager MD-first + path-traversal guard (T3.2, EC-1 fix).
 *
 * B-050 residue — the 7 `throw new` sites in this module a fresh whole-suite lcov reported at
 * count 0. A reachability pass ran first (recorded in the B-050 handoff): every site is a BOUNDARY
 * check over a file this repo does not control the contents of (a plugin manifest, on disk, in
 * `.theokit/plugins/`), so a reachability argument dismissing any of them as "unreachable" would
 * repeat the mistake `assertCloudRules`'s own docblock now warns against — the type system cannot
 * stop a caller from writing arbitrary bytes to a file. All 7 are reachable and covered below, each
 * asserting class + `code` + a message substring (a bare `toThrow()` is not enough to tell two
 * `plugin_missing_manifest` sites apart), and each guard also gets at least one input it ACCEPTS —
 * several already exist above (a readable `PLUGIN.md`, a readable `plugin.json` with a real `entry`)
 * so the new tests below do not repeat them.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import { PluginsManager } from "../../../src/internal/runtime/plugin-loader/plugins-manager.js";

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

/** Asserts a rejection is a `ConfigurationError` carrying `code`, with `message` containing `substr`. */
async function expectConfigError(p: Promise<unknown>, code: string, substr: string): Promise<void> {
  await expect(p).rejects.toBeInstanceOf(ConfigurationError);
  await expect(p).rejects.toMatchObject({ code });
  await expect(p).rejects.toThrow(substr);
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
      code: "path_traversal",
    });
  });

  it("rejects PLUGIN.md with absolute entry path", async () => {
    writePlugin("malicious-abs", {
      "PLUGIN.md": ["---", "name: malicious-abs", "entry: /etc/shadow", "---"].join("\n"),
    });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);
    await expect(mgr.initialize()).rejects.toMatchObject({
      code: "path_traversal",
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
      code: "path_traversal",
    });
  });

  it("rejects normalized escape (subdir/../../../etc/passwd)", async () => {
    writePlugin("malicious-norm", {
      "PLUGIN.md": ["---", "name: malicious-norm", "entry: subdir/../../../etc/passwd", "---"].join(
        "\n",
      ),
    });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);
    await expect(mgr.initialize()).rejects.toMatchObject({
      code: "path_traversal",
    });
  });
});

describe("PluginsManager — cloud boundary check (assertCloudRules)", () => {
  it("rejects a cloud agent given local plugin paths (code: cloud_plugin_path_rejected)", async () => {
    const mgr = new PluginsManager(dir, undefined, true, /* cloud */ true, [
      "/tmp/some-local-plugin",
    ]);

    await expectConfigError(
      mgr.initialize(),
      "cloud_plugin_path_rejected",
      "Cloud agents reject local plugin paths",
    );
  });

  it("accepts a cloud agent with no local plugin paths declared", async () => {
    // The ACCEPT case a refusal-only test suite cannot distinguish from "rejects everything":
    // `cloud: true` alone must not trip the guard — only `localPaths` non-empty does.
    const mgr = new PluginsManager(
      dir,
      undefined,
      /* settingSourcesIncludePlugins */ false,
      true,
      undefined,
    );

    await expect(mgr.initialize()).resolves.toBeUndefined();
  });

  it("accepts a cloud agent given an EMPTY local plugin paths array", async () => {
    const mgr = new PluginsManager(dir, undefined, false, true, []);

    await expect(mgr.initialize()).resolves.toBeUndefined();
  });
});

describe("PluginsManager — manifest boundary checks (loadPluginManifestFromJson)", () => {
  it("rejects a plugin folder with neither PLUGIN.md nor plugin.json (code: plugin_missing_manifest)", async () => {
    // Reachable without any crafted malformed content: an empty (or leftover) plugin folder.
    mkdirSync(join(dir, ".theokit", "plugins", "empty-folder"), { recursive: true });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);

    await expectConfigError(
      mgr.initialize(),
      "plugin_missing_manifest",
      "empty-folder is missing plugin.json",
    );
  });

  it("rejects plugin.json containing malformed JSON (code: plugin_manifest_invalid)", async () => {
    writePlugin("bad-json", { "plugin.json": "{ this is not json" });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);

    await expectConfigError(
      mgr.initialize(),
      "plugin_manifest_invalid",
      "bad-json manifest is invalid JSON",
    );
  });

  it("rejects plugin.json that parses but is not an object (code: plugin_manifest_shape)", async () => {
    // A JSON *array* is NOT this shape failure — `typeof [] === "object"` in JS, so the guard's
    // `typeof parsed !== "object"` check lets an array through (its fields just fall back to
    // defaults). The genuinely-rejected shapes are the JSON primitives: string, number, boolean.
    writePlugin("string-json", { "plugin.json": JSON.stringify("just a string, not a manifest") });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);

    await expectConfigError(
      mgr.initialize(),
      "plugin_manifest_shape",
      "string-json manifest must be an object",
    );
  });
});

describe("PluginsManager — manifest boundary checks (loadPluginManifestFromMarkdown)", () => {
  it("rejects a PLUGIN.md that is actually a directory (code: plugin_missing_manifest)", async () => {
    // existsSync() (used by refresh() to route MD-first) does not distinguish files from
    // directories, so a directory literally named "PLUGIN.md" reaches the markdown loader's own
    // readFile(), which fails with EISDIR — a deterministic, non-racy way to exercise the
    // TOCTOU-shaped guard at this call site.
    const pluginDir = join(dir, ".theokit", "plugins", "md-is-a-dir");
    mkdirSync(join(pluginDir, "PLUGIN.md"), { recursive: true });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);

    await expectConfigError(
      mgr.initialize(),
      "plugin_missing_manifest",
      "md-is-a-dir is missing PLUGIN.md",
    );
  });

  it("rejects a symlinked PLUGIN.md — the shared markdown loader excludes symlinks from its scan (code: plugin_missing_manifest)", async () => {
    // Two independent reads of the same path disagree: plugins-manager's own existsSync()/readFile()
    // follow the symlink and succeed, but loadMarkdownEntities()'s readdir(withFileTypes) does NOT —
    // `Dirent.isFile()` is false for a symlink even when its target is a regular file — so its
    // "flat" pattern scan silently excludes the entry and returns zero entities. `entities.find`
    // then comes back empty, hitting the "not parseable" throw even though the file reads fine.
    const pluginDir = join(dir, ".theokit", "plugins", "md-is-a-symlink");
    mkdirSync(pluginDir, { recursive: true });
    const realTarget = join(pluginDir, "real-manifest.md");
    writeFileSync(
      realTarget,
      ["---", "name: md-is-a-symlink", "version: 1.0.0", "---"].join("\n"),
      "utf8",
    );
    symlinkSync(realTarget, join(pluginDir, "PLUGIN.md"));
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);

    await expectConfigError(
      mgr.initialize(),
      "plugin_missing_manifest",
      "md-is-a-symlink PLUGIN.md not parseable",
    );
  });
});

describe("PluginsManager — entry-file boundary check (assertEntryFileExists)", () => {
  it("rejects a manifest whose declared entry file does not exist on disk (code: plugin_entry_missing)", async () => {
    writePlugin("missing-entry", {
      "PLUGIN.md": ["---", "name: missing-entry", "entry: does-not-exist.js", "---"].join("\n"),
      // deliberately no does-not-exist.js on disk
    });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);

    await expectConfigError(
      mgr.initialize(),
      "plugin_entry_missing",
      "Plugin missing-entry entry file is missing: does-not-exist.js",
    );
  });

  it("accepts a manifest that declares no entry at all", async () => {
    // The guard's other branch (`if (entry === undefined) return;`) — distinct from "entry present
    // and the file exists", which the top-of-file MD-first tests already cover.
    writePlugin("no-entry-declared", {
      "PLUGIN.md": ["---", "name: no-entry-declared", "version: 1.0.0", "---"].join("\n"),
    });
    const mgr = new PluginsManager(dir, undefined, true, false, undefined);

    await expect(mgr.initialize()).resolves.toBeUndefined();
    const list = await mgr.list();
    expect(list).toHaveLength(1);
  });
});
