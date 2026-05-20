/**
 * Lazy provider discovery (T3.4, ADR D107).
 *
 * Scans `~/.theokit/plugins/model-providers/<name>/index.{js,mjs}` and
 * imports each as a Plugin. Plugins with `kind: "model-provider"` register
 * their profile. Errors per plugin are logged + skipped. Idempotent per
 * process.
 *
 * EC-9: dynamic `import()` in Node 22 needs `file://` URL for absolute
 * paths in ESM contexts. `pathToFileURL` handles both.
 *
 * @internal
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { registerProvider } from "./registry.js";

let discovered = false;

function pluginsRoot(): string {
  return join(homedir(), ".theokit", "plugins", "model-providers");
}

export async function discoverProviderPlugins(): Promise<void> {
  if (discovered) return;
  discovered = true;

  const root = pluginsRoot();
  if (!existsSync(root)) return;

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  for (const entry of entries) {
    await loadOne(join(root, entry), entry);
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 2-extension loader (mjs / js) + plugin shape detection (default / named / direct) — inlining is clearer than 5 helper fns.
async function loadOne(dir: string, entryName: string): Promise<void> {
  for (const ext of ["index.mjs", "index.js"]) {
    const indexPath = join(dir, ext);
    if (!existsSync(indexPath)) continue;
    try {
      const mod = await import(pathToFileURL(indexPath).href);
      const plugin = mod.default ?? mod[entryName] ?? mod;
      if (
        plugin !== null &&
        typeof plugin === "object" &&
        (plugin as { kind?: unknown }).kind === "model-provider"
      ) {
        const profile = (plugin as { profile?: unknown }).profile;
        if (profile !== undefined && typeof profile === "object") {
          registerProvider(profile as Parameters<typeof registerProvider>[0]);
        }
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[theokit-sdk] failed to load provider plugin "${entryName}": ${msg}\n`);
      return;
    }
  }
}

/** Test-only reset. @internal */
export function _resetDiscovery(): void {
  discovered = false;
}
