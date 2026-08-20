/**
 * Plugin discovery for `theokit inspect` (T3.1, ADR D198).
 *
 * Read-only filesystem walk of `~/.theokit/plugins/` and
 * `<cwd>/.theokit/plugins/`. Does NOT execute plugin code (safe to run
 * in CI). Plugin manifests are markdown + YAML frontmatter per D77.
 *
 * @internal
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** One discovered plugin. `path` points at its `PLUGIN.md`, not at the plugin directory. */
interface PluginInfo {
  readonly name: string;
  readonly source: "user-global" | "project";
  readonly description?: string;
  readonly path: string;
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (match === null) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const [k, ...rest] = line.split(":");
    if (k === undefined || rest.length === 0) continue;
    const key = k.trim();
    const val = rest.join(":").trim();
    if (key === "name") out.name = val;
    else if (key === "description") out.description = val;
  }
  return out;
}

function loadPluginManifest(
  root: string,
  name: string,
  source: PluginInfo["source"],
): PluginInfo | undefined {
  const manifestPath = join(root, name, "PLUGIN.md");
  if (!existsSync(manifestPath)) return undefined;
  try {
    const fm = parseFrontmatter(readFileSync(manifestPath, "utf8"));
    return {
      name: fm.name ?? name,
      source,
      ...(fm.description !== undefined ? { description: fm.description } : {}),
      path: manifestPath,
    };
  } catch {
    // Malformed manifest — skip silently (per D198 invariant).
    return undefined;
  }
}

function walkPluginDir(root: string, source: PluginInfo["source"]): PluginInfo[] {
  if (!existsSync(root) || !lstatSync(root).isDirectory()) return [];
  const out: PluginInfo[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const info = loadPluginManifest(root, entry.name, source);
    if (info !== undefined) out.push(info);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Discover plugins from `~/.theokit/plugins/` and `<cwd>/.theokit/plugins/`, merged and sorted by name.
 *
 * A plugin is a DIRECTORY containing `PLUGIN.md`; the frontmatter's `name` wins over the directory
 * name when present. Directories without that file, and files with unreadable frontmatter, are
 * skipped silently (D198) — so "my plugin is not listed" almost always means a missing or malformed
 * `PLUGIN.md`, not a broken CLI.
 *
 * On a name collision the PROJECT entry replaces the user-global one (EC-N, mirroring D162), and the
 * shadowed entry is not reported.
 *
 * Never executes plugin code and never throws for a missing directory — safe in CI.
 */
export function listPlugins(cwd: string): PluginInfo[] {
  const userPlugins = walkPluginDir(join(homedir(), ".theokit", "plugins"), "user-global");
  const projectPlugins = walkPluginDir(join(cwd, ".theokit", "plugins"), "project");
  // EC-N (DOCUMENT): project entries override user-global on name collision (mirror of D162).
  const byName = new Map<string, PluginInfo>();
  for (const p of userPlugins) byName.set(p.name, p);
  for (const p of projectPlugins) byName.set(p.name, p);
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}
