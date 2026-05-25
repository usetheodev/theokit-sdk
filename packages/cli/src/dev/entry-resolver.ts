/**
 * Resolve the entry file for `theokit dev` (T4.1).
 *
 * Priority:
 *  1. Explicit `--entry <path>` flag.
 *  2. `package.json` `main` field.
 *  3. `src/index.ts` (or `.js` / `.mjs` / `.tsx`).
 *  4. `index.ts` at cwd root.
 *
 * Throws `entry_not_found` when nothing matches.
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

export function resolveEntry(cwd: string, explicit?: string): string {
  // 1. Explicit flag.
  if (explicit !== undefined && explicit.length > 0) {
    const abs = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
    if (!existsSync(abs)) {
      const err = new Error(`Entry file not found: ${explicit}`) as Error & { code?: string };
      err.code = "entry_not_found";
      throw err;
    }
    return abs;
  }

  // 2. package.json main.
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { main?: string };
      if (typeof pkg.main === "string" && pkg.main.length > 0) {
        const abs = resolve(cwd, pkg.main);
        if (existsSync(abs)) return abs;
      }
    } catch {
      // Malformed package.json — fall through to candidates.
    }
  }

  // 3-4. Conventional locations.
  for (const candidate of FALLBACK_CANDIDATES) {
    const abs = join(cwd, candidate);
    if (existsSync(abs)) return abs;
  }

  const err = new Error(
    `No entry file found. Pass --entry <path> or create one of: ${FALLBACK_CANDIDATES.join(", ")}`,
  ) as Error & { code?: string };
  err.code = "entry_not_found";
  throw err;
}
