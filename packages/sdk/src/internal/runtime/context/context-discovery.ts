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
import { glob } from "node:fs/promises";
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
 * Glob-style discovery under `cwd` (e.g. `.cursor/rules/*.mdc`, `.theokit/rules/**\/*.md`).
 * Returns absolute, lex-sorted paths.
 *
 * `*` matches within one path segment and `**` spans any depth, including zero — so
 * `.theokit/rules/**\/*.md` finds `rules/top.md` as well as `rules/deep/nested/inner.md`, while
 * `.theokit/rules/*.md` keeps its flat meaning and finds only the first. That distinction is the
 * compatibility contract: every existing spec uses a single `*`, and widening it would silently
 * start absorbing nested files nobody chose to expose.
 *
 * ## Why this used to be flat, and what changed (B-119)
 *
 * The previous implementation split the pattern at its LAST `/`, treated the prefix as a literal
 * directory and did one `readdir` — documented as "nested directories deferred to v2" (EC-R). The
 * deferral was deliberate; what made it a defect was measured from a consumer. TheoCode's own rule
 * loader descends recursively, so migrating it onto the `theokit-rules` spec would have silently
 * dropped every nested rule — on the path that decides whether a repository's hooks execute. And a
 * pattern written to say so, `.theokit/rules/**\/*.md`, resolved its directory part to a literal
 * `**` and matched NOTHING, not even the top-level file it matched before the globstar was added.
 *
 * ## Why the stdlib rather than a walker
 *
 * `fs.promises.glob` (Node ≥ 22, and this package requires ≥ 22.12) implements exactly these
 * semantics, verified against a fixture before adoption: `**\/*.md` returns all three depths,
 * `*.md` returns one, and it emits no experimental warning. Writing a recursive walker here would
 * have been a third implementation of matching inside one package — the same duplication that let
 * the enumerator and the compiler in `context-glob.ts` disagree in the first place. `globToRegex`
 * stays where it belongs: deciding whether a rule APPLIES to a set of paths, which is a different
 * question from which files exist.
 *
 * `isSafePattern` still runs first and is unchanged, so `..` is refused before any I/O.
 *
 * @internal
 */
export async function walkUpForGlob(cwd: string, pattern: string): Promise<string[]> {
  if (!isSafePattern(pattern)) return [];
  const found: string[] = [];
  try {
    for await (const entry of glob(pattern, { cwd })) {
      found.push(resolve(cwd, entry));
    }
  } catch {
    // A pattern whose directory does not exist is the ordinary case — most projects have no
    // `.cursor/rules/`. Same outcome as matching nothing.
    return [];
  }
  // Sorted, because discovery order becomes prompt order and must not vary with the filesystem.
  //
  // The comparator is explicit and deliberately NOT `localeCompare`, which is the usual suggestion
  // for a bare `.sort()`. `localeCompare` orders by the machine's locale, so the same tree would
  // assemble a different prompt on a differently-configured machine — trading one source of
  // non-determinism for a subtler one. Code-unit ordering is what a bare `.sort()` already does for
  // strings; writing it out states the intent and keeps the result machine-independent.
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
