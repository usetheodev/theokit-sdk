/**
 * Context file discovery (T1.1, ADRs D150 / D151).
 *
 * Discovers context files via three scopes:
 *  - `cwd-only` — single dir, single path lookup
 *  - `git-root-walk` — walk cwd → git-root, collect every directory's match
 *    (nearest-first ordering)
 *  - `globbed` — glob pattern relative to cwd (e.g. `.cursor/rules/*.mdc`)
 *
 * Pure `existsSync` checks — **no `.gitignore` parsing** (EC-A, KISS) and
 * **no invented `.theokitignore`** (EC-B). Paths normalized via
 * `realpath` to dedup symlink chains pointing to the same physical file
 * (EC-F). Git worktrees work transparently because `.git` exists as a
 * file in that case (EC-N).
 *
 * @internal
 */

import { existsSync, realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Single filename ("AGENTS.md") or relative glob (".cursor/rules/*.mdc"). */
export type DiscoveryScope = "cwd-only" | "git-root-walk" | "globbed";

/** Parser to apply once file is read. */
export type DiscoveryParser = "plain-markdown" | "mdc" | "frontmatter-zod" | "rules-frontmatter";

/**
 * Specification for one discoverable context source. The default registry
 * `DEFAULT_DISCOVERY_SPECS` covers the 2026 industry-standard set.
 *
 * @internal
 */
export interface DiscoverySpec {
  /** Stable identifier — used as `<source name="">` and telemetry key. */
  readonly id: string;
  /** Priority for merge (lower = earlier in prompt). */
  readonly priority: number;
  /** Filename (cwd-only/git-root-walk) or glob (globbed). */
  readonly pattern: string;
  readonly scope: DiscoveryScope;
  readonly parser: DiscoveryParser;
  /** Whether to follow `@path` import directives (CLAUDE.md / GEMINI.md). */
  readonly followImports: boolean;
}

/**
 * 2026 industry-standard context file registry. Sorted by priority
 * ascending — earlier in prompt = more general, last-writer-wins on
 * conflict (D152 concat-by-priority).
 *
 * @internal
 */
export const DEFAULT_DISCOVERY_SPECS: ReadonlyArray<DiscoverySpec> = [
  {
    id: "AGENTS.md",
    pattern: "AGENTS.md",
    scope: "git-root-walk",
    parser: "plain-markdown",
    followImports: false,
    priority: 10,
  },
  {
    id: "GEMINI.md",
    pattern: "GEMINI.md",
    scope: "git-root-walk",
    parser: "plain-markdown",
    followImports: true,
    priority: 20,
  },
  {
    id: "CLAUDE.md",
    pattern: "CLAUDE.md",
    scope: "git-root-walk",
    parser: "plain-markdown",
    followImports: true,
    priority: 30,
  },
  {
    id: "cursor-rules",
    pattern: ".cursor/rules/*.mdc",
    scope: "globbed",
    parser: "mdc",
    followImports: false,
    priority: 40,
  },
  {
    id: "theokit-rules",
    pattern: ".theokit/rules/*.md",
    scope: "globbed",
    parser: "rules-frontmatter",
    followImports: false,
    priority: 45,
  },
  {
    id: "theokit-context",
    pattern: ".theokit/context/*.md",
    scope: "globbed",
    parser: "frontmatter-zod",
    followImports: false,
    priority: 50,
  },
  {
    id: "THEO.md",
    pattern: ".theokit/THEO.md",
    scope: "cwd-only",
    parser: "plain-markdown",
    followImports: false,
    priority: 60,
  },
];

const SAFE_FILENAME = /^[a-zA-Z0-9_.\-/*]+$/;
const TRAVERSAL_RE = /(^|\/)\.\.(\/|$)/;

/**
 * Reject patterns that contain path traversal (`..`) or non-allowed
 * characters (D81 parity, EC-4).
 *
 * @internal
 */
export function isSafePattern(pattern: string): boolean {
  if (typeof pattern !== "string" || pattern.length === 0) return false;
  if (TRAVERSAL_RE.test(pattern)) return false;
  if (isAbsolute(pattern)) return false;
  return SAFE_FILENAME.test(pattern);
}

/**
 * Walk upward from `cwd` looking for the closest directory containing
 * a `.git` entry (file OR directory — worktrees use a `.git` FILE,
 * EC-N). Returns the absolute path of that directory, or `undefined`
 * when no git root exists at or above `cwd`.
 *
 * @internal
 */
export function findGitRoot(cwd: string): string | undefined {
  if (typeof cwd !== "string" || cwd.length === 0) return undefined;
  let current = resolve(cwd);
  // Guard against infinite loops on weird filesystems.
  for (let i = 0; i < 64; i += 1) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

/**
 * Walk `cwd` upward to `stopDir` (inclusive) collecting every existing
 * occurrence of `filename`. Returns absolute, realpath-deduped paths in
 * nearest-first order (innermost dir first).
 *
 * No `.gitignore` parsing (EC-A). Realpath collapses symlink chains
 * pointing to the same physical file (EC-F). Filesystem races (file
 * deleted mid-walk) are skipped silently (EC-5).
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: walk-up loop combines validation + realpath dedup + FS-race handling + stopDir guard in a single bounded loop; splitting fragments the dedup invariant.
export function walkUpForFile(
  cwd: string,
  filename: string,
  stopDir: string | undefined,
): string[] {
  if (!isSafePattern(filename)) {
    return [];
  }
  const start = resolve(cwd);
  const stop = stopDir !== undefined ? resolve(stopDir) : undefined;
  const found: string[] = [];
  const seenReal = new Set<string>();
  let current = start;
  // 64-level depth cap.
  for (let i = 0; i < 64; i += 1) {
    const candidate = join(current, filename);
    if (existsSync(candidate)) {
      let real: string;
      try {
        real = realpathSync(candidate);
      } catch {
        // FS race (deleted mid-walk) — skip.
        real = candidate;
      }
      if (!seenReal.has(real)) {
        seenReal.add(real);
        found.push(real);
      }
    }
    if (stop !== undefined && current === stop) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return found;
}

/**
 * Glob-style discovery scoped to a single directory under cwd (e.g.
 * `.cursor/rules/*.mdc`). Flat — does NOT recurse into subdirectories
 * (EC-R: nested directories deferred to v2). Returns absolute,
 * lex-sorted paths.
 *
 * @internal
 */
export async function walkUpForGlob(cwd: string, pattern: string): Promise<string[]> {
  if (!isSafePattern(pattern)) return [];
  const lastSlash = pattern.lastIndexOf("/");
  if (lastSlash < 0) {
    // Single filename — treat as cwd-only single match.
    const candidate = join(cwd, pattern);
    return existsSync(candidate) ? [resolve(candidate)] : [];
  }
  const dirPart = pattern.slice(0, lastSlash);
  const filePart = pattern.slice(lastSlash + 1);
  const dir = join(cwd, dirPart);
  if (!existsSync(dir)) return [];
  // Build a regex from the file part — supports only `*` wildcard.
  const fileRe = filePartToRegex(filePart);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const matched = entries.filter((e) => fileRe.test(e)).sort();
  return matched.map((e) => resolve(join(dir, e)));
}

function filePartToRegex(filePart: string): RegExp {
  const escaped = filePart.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
