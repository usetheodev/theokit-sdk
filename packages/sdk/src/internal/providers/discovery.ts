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

import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { registerProvider } from "./registry.js";

// M47 review F3 — the idempotence flag lives on `globalThis` via `Symbol.for`, mirroring registry.ts's
// M44 B1 pattern: tsup bundles each entry (`dist/index.js`, `dist/cron.js`, …) with its OWN module copy,
// so a module-local `let discovered` would re-run discovery once per entry (duplicate I/O + spurious
// "Provider overridden" WARNs). Every bundle copy shares THIS state.
function globalSingleton<T>(key: string, create: () => T): T {
  const g = globalThis as unknown as Record<symbol, T>;
  const sym = Symbol.for(key);
  if (g[sym] === undefined) g[sym] = create();
  return g[sym];
}

const discoveryState = globalSingleton("theokit-sdk.providers.discovered", () => ({
  done: false,
}));

function pluginsRoot(): string {
  return join(homedir(), ".theokit", "plugins", "model-providers");
}

/** The explicit trust allowlist the human edits (M47). Fail-closed: missing/malformed ⇒ empty. */
function trustFilePath(): string {
  return join(homedir(), ".theokit", "plugins", "trusted-providers.json");
}

/**
 * M47 — the trust gate for the dynamic-import surface. A plugin's `index.{js,mjs}` executes arbitrary code
 * at import time, so NOTHING is imported unless the human explicitly trusted the plugin name: either in
 * `~/.theokit/plugins/trusted-providers.json` (a JSON string array — the auditable primary, mirroring the
 * approved-hooks posture) or the additive `THEOKIT_TRUSTED_PROVIDERS` env (comma-separated convenience).
 * Fail-closed: a missing or malformed trust file trusts NOTHING (a malformed file WARNs).
 */
function loadTrustedNames(): Set<string> {
  const trusted = new Set<string>();
  const path = trustFilePath();
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
      if (Array.isArray(parsed)) {
        let discarded = 0;
        for (const name of parsed) {
          if (typeof name === "string" && name.length > 0) trusted.add(name);
          else discarded += 1;
        }
        // M47 review F5 — fail-closed AND fail-clear: a valid array with wrong-shaped entries
        // (numbers, objects) silently trusting nothing would leave the user with only the generic
        // per-plugin WARN and no clue the FILE shape is wrong.
        if (discarded > 0) {
          process.stderr.write(
            `[theokit-sdk] WARN: ${path} contains ${discarded} non-string entr${discarded === 1 ? "y" : "ies"} — discarded (entries must be plugin-name strings)\n`,
          );
        }
      } else {
        process.stderr.write(
          `[theokit-sdk] WARN: ${path} is not a JSON array — trusting NO provider plugins (fail-closed)\n`,
        );
      }
    } catch {
      process.stderr.write(
        `[theokit-sdk] WARN: ${path} is not valid JSON — trusting NO provider plugins (fail-closed)\n`,
      );
    }
  }
  for (const name of (process.env.THEOKIT_TRUSTED_PROVIDERS ?? "").split(",")) {
    const trimmed = name.trim();
    if (trimmed.length > 0) trusted.add(trimmed);
  }
  return trusted;
}

export async function discoverProviderPlugins(): Promise<void> {
  if (discoveryState.done) return;
  discoveryState.done = true;

  const root = pluginsRoot();
  if (!existsSync(root)) return;

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  const trusted = loadTrustedNames();
  for (const entry of entries) {
    // M47 — the gate fires BEFORE any import(): untrusted code is never evaluated (import-time side effects
    // ARE the attack; a post-import check would be theater).
    if (!trusted.has(entry)) {
      // M47 review F4/F7 — the remedy must be complete: discovery is once-per-process (the latch above),
      // so editing the trust file only takes effect after a restart; and the env format is comma-separated.
      process.stderr.write(
        `[theokit-sdk] WARN: provider plugin "${entry}" is present but NOT trusted — skipped. ` +
          `To trust it, add "${entry}" to ${trustFilePath()} (JSON array of names) or ` +
          `THEOKIT_TRUSTED_PROVIDERS (comma-separated), then restart the process.\n`,
      );
      continue;
    }
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
  discoveryState.done = false;
}
