/**
 * The DECLARATIVE half of #524's opt-in: `.theokit/config.json` `compat.adapters`, read once at
 * agent construction as the default when `local.compatSources` was not passed in code.
 *
 * The issue sketched this in TOML. It ships as JSON instead: the SDK already reads JSON everywhere
 * a project declares something (`settings.json`, `mcp.json`, `context.json`) and carries no TOML
 * parser or dependency for one — introducing one for a single optional section would be the
 * opposite of what #522/#524 are about, reading in a new format nobody asked this SDK to speak.
 * The SHAPE is unchanged: `compat.adapters` is an array of the exact same `CompatSourceDeclaration`
 * `local.compatSources` already accepts in code — a bare kind string, or `{ kind, import }`. One
 * shape, two entry points; `adaptersForSurface` validates either the same way.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { diag } from "../../diagnostics.js";
import { theokitConfigRoot } from "../../persistence/paths.js";
import type { CompatSourceDeclaration } from "./foreign-config-sources.js";

interface CompatConfigFileShape {
  compat?: { adapters?: unknown };
}

/**
 * Read `.theokit/config.json`'s `compat.adapters`, or `[]` when the file is absent, declares no
 * `compat` section, or is malformed — the last two WARN on the diagnostics channel rather than
 * failing silently, matching #526's fail-closed-and-say-so precedent for the code option.
 *
 * SYNC on purpose: the caller is `Agent`'s constructor, which resolves `compatSources` before any
 * submanager exists to await a promise. `existsSync` is already how the same constructor checks for
 * `.theokit`/`.claude`; a once-per-agent read of one small, optional JSON file is the same class of
 * work, not a new one.
 */
export function readCompatConfigFile(cwd: string): CompatSourceDeclaration[] {
  const path = join(theokitConfigRoot(cwd), "config.json");
  if (!existsSync(path)) return [];

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // Exists but unreadable (permissions, race with a delete) — same non-fatal default as a
    // missing file; the caller has no action to take that isn't already "read nothing".
    return [];
  }

  let parsed: CompatConfigFileShape;
  try {
    parsed = JSON.parse(raw) as CompatConfigFileShape;
  } catch (cause) {
    diag(
      `[theokit] ${path} is not valid JSON — ignoring its "compat.adapters" ` +
        `(${(cause as Error).message}).\n`,
    );
    return [];
  }

  const adapters = parsed.compat?.adapters;
  if (adapters === undefined) return [];
  if (!Array.isArray(adapters)) {
    diag(`[theokit] ${path}: "compat.adapters" must be an array — ignoring it.\n`);
    return [];
  }
  return adapters as CompatSourceDeclaration[];
}

/**
 * The one place `local.compatSources` — explicit code — and `.theokit/config.json` — the
 * project's declared default — are reconciled. Every reader that needs `compatSources` (hooks,
 * skills, plugins, subagents) calls THIS instead of writing `options.local?.compatSources ?? []`
 * by hand: that pattern existed at five call sites before this function did, and every one of them
 * silently meant "the file form doesn't exist" — the same duplication `theokitConfigRoot` closed
 * one layer down, one layer up.
 *
 * PRECEDENCE: explicit code wins. A consumer passing `local.compatSources` made a decision at the
 * call site; the file is the DEFAULT for callers who did not. This is not specified by #524 — it is
 * this SDK's choice, made explicit here rather than left to whichever call site happened to be
 * written first. It means a test or a one-off script can always override the file without editing
 * or deleting it, which the reverse precedence would not allow.
 */
export function resolveCompatSources(
  options: { local?: { compatSources?: readonly CompatSourceDeclaration[] } },
  cwd: string,
): readonly CompatSourceDeclaration[] {
  return options.local?.compatSources ?? readCompatConfigFile(cwd);
}
