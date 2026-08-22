/**
 * Resolve the entry file for `theokit dev` (T4.1).
 *
 * Priority:
 *  1. Explicit `--entry <path>` flag.
 *  2. `package.json` `main` field.
 *  3. `src/index.ts` (or `.js` / `.mjs` / `.tsx`).
 *  4. `index.ts` at cwd root.
 *
 * Note the order: `package.json` `main` beats `src/index.ts`. In a project whose `main` points at a
 * BUILT file (`dist/index.js`), `theokit dev` watches the build output rather than the source, which
 * looks like hot-reload silently not working.
 *
 * Throws an `Error` whose `code` is `entry_not_found` when nothing matches.
 *
 * @internal
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const FALLBACK_CANDIDATES = [
  "src/index.ts",
  "src/index.tsx",
  "src/index.mjs",
  "src/index.js",
  "index.ts",
  "index.mjs",
  "index.js",
];

function entryNotFoundError(message: string): Error & { code?: string } {
  const err = new Error(message) as Error & { code?: string };
  err.code = "entry_not_found";
  return err;
}

function resolveFromExplicit(cwd: string, explicit: string): string {
  const abs = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
  if (!existsSync(abs)) throw entryNotFoundError(`Entry file not found: ${explicit}`);
  return abs;
}

function resolveFromPackageJson(cwd: string): string | undefined {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { main?: string };
    if (typeof pkg.main === "string" && pkg.main.length > 0) {
      const abs = resolve(cwd, pkg.main);
      if (existsSync(abs)) return abs;
    }
  } catch {
    // Malformed package.json — fall through to candidates.
  }
  return undefined;
}

function resolveFromCandidates(cwd: string): string | undefined {
  for (const candidate of FALLBACK_CANDIDATES) {
    const abs = join(cwd, candidate);
    if (existsSync(abs)) return abs;
  }
  return undefined;
}

/**
 * Resolve the file `theokit dev` / `theokit acp` should load, as an absolute path.
 *
 * Existence is the only test — the file is not parsed and its extension is not checked, so a
 * `--entry` pointing at a `.json` resolves happily and fails later at import.
 *
 * A `package.json` that cannot be parsed is not an error: it is skipped and the fallback candidates
 * are tried. Same for a `main` that points at a missing file.
 *
 * @throws Error with `code === "entry_not_found"` — for an explicit path that does not exist, or
 * when no candidate matched.
 */
export function resolveEntry(cwd: string, explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) return resolveFromExplicit(cwd, explicit);
  const fromPkg = resolveFromPackageJson(cwd);
  if (fromPkg !== undefined) return fromPkg;
  const fromCandidate = resolveFromCandidates(cwd);
  if (fromCandidate !== undefined) return fromCandidate;
  throw entryNotFoundError(
    `No entry file found. Pass --entry <path> or create one of: ${FALLBACK_CANDIDATES.join(", ")}`,
  );
}
