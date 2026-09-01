/**
 * Locating the plugin bundles a project carries.
 *
 * Shared by the skills and subagents loaders, which both need the same answer to "which folders in
 * this project are plugins" and would otherwise each grow their own copy of the directory walk.
 *
 * @internal
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pluginBundleRoots } from "../../persistence/paths.js";

/**
 * Every plugin folder under the project's plugin roots.
 *
 * Returns the FOLDERS, not their contents — what a bundle contributes (`skills/`, `agents/`) is the
 * caller's business, and a loader that also knew the layout would have to change whenever the other
 * one did.
 *
 * A missing root is not an error: most projects carry no plugins, and treating their absence as a
 * failure would make "none installed" indistinguishable from "the directory could not be read".
 */
export async function pluginBundleDirs(cwd: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const root of pluginBundleRoots(cwd)) {
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) dirs.push(join(root, entry.name));
    }
  }
  return dirs;
}
