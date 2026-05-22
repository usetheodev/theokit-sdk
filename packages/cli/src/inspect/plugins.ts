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

export interface PluginInfo {
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: dir-exists + entries-iter + manifest-parse + fallback-name is one read-only walker; D198 requires no plugin execution.
function walkPluginDir(root: string, source: PluginInfo["source"]): PluginInfo[] {
  if (!existsSync(root) || !lstatSync(root).isDirectory()) return [];
  const out: PluginInfo[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(root, entry.name, "PLUGIN.md");
    if (!existsSync(manifestPath)) continue;
    try {
      const content = readFileSync(manifestPath, "utf8");
      const fm = parseFrontmatter(content);
      out.push({
        name: fm.name ?? entry.name,
        source,
        ...(fm.description !== undefined ? { description: fm.description } : {}),
        path: manifestPath,
      });
    } catch {
      // Malformed manifest — skip silently (per D198 invariant).
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function listPlugins(cwd: string): PluginInfo[] {
  const userPlugins = walkPluginDir(join(homedir(), ".theokit", "plugins"), "user-global");
  const projectPlugins = walkPluginDir(join(cwd, ".theokit", "plugins"), "project");
  // EC-N (DOCUMENT): project entries override user-global on name collision (mirror of D162).
  const byName = new Map<string, PluginInfo>();
  for (const p of userPlugins) byName.set(p.name, p);
  for (const p of projectPlugins) byName.set(p.name, p);
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}
