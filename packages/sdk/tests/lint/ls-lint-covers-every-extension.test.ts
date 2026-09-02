/**
 * Lint gate — every file extension present in the test tree has an `.ls-lint.yml` rule.
 *
 * `pnpm run validate:naming` exited 0 for a long time while checking 18 of the 951 `.ts` files
 * under `packages/<pkg>/tests`. ls-lint matches on the LONGEST extension, so `foo.test.ts` has
 * extension `.test.ts`, and the config declared a rule only for `.ts`. Every `.test.ts`,
 * `.golden.test.ts` and `.contract.test.ts` file — 98.1% of the tree — was unchecked, and two real
 * deviations were sitting in the gap: a stem starting with a digit, and a camelCase segment among
 * 806 kebab-case stems. `src/` was genuinely covered because it has no multi-dot filenames, which
 * is precisely why the exit code stayed 0 and nobody looked.
 *
 * A gate that cannot fail is worse than no gate, because its green reads as coverage. The config
 * now declares each compound extension by hand — and a hand-maintained list is exactly the kind of
 * thing that goes stale silently. The first `.bench.test.ts` anyone adds would reopen the hole
 * with ls-lint still exiting 0.
 *
 * So this test asserts the property the config can only approximate: every extension that actually
 * occurs in the test tree is one the naming gate has a rule for. Adding a new suffix now fails
 * here, with the line to add, instead of quietly widening the blind spot.
 *
 * Scope is TypeScript sources only. Fixture files under `tests/fixtures/` carry names that imitate
 * a consumer project on disk (`SKILL.md`, `.theokit/`), and those names are the fixture's payload
 * rather than our convention — demanding kebab-case of them would break what they exist to prove.
 */

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const CONFIG_PATH = join(REPO_ROOT, ".ls-lint.yml");

/** Directories ls-lint itself ignores, plus build output that never carries our conventions. */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".turbo"]);

/** Only these are governed by the filename convention; see the docblock on fixture scope. */
const GOVERNED_SUFFIXES = [".ts", ".tsx"];

/**
 * The extension ls-lint would attribute to a basename: everything from the FIRST dot.
 *
 * This mirrors ls-lint's own longest-match rule, verified empirically — a file named
 * `9bad.golden.test.ts` is reported by ls-lint as failing "`.golden.test.ts` rules", not
 * "`.ts` rules".
 */
function lsLintExtension(basename: string): string {
  const firstDot = basename.indexOf(".");
  return firstDot === -1 ? "" : basename.slice(firstDot);
}

/** Every file under `root`, skipping the directories ls-lint itself ignores. */
async function walkFiles(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    // Tolerated only for SUBdirectories, where a concurrent delete can race the walk. A missing
    // ROOT would make the whole scan vacuous, and the sentinel assertion below is what catches
    // that — returning [] here never becomes a silent pass.
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (!entry.isDirectory()) {
      found.push(path);
    } else if (!SKIP_DIRS.has(entry.name)) {
      found.push(...(await walkFiles(path)));
    }
  }
  return found;
}

/** extension -> one example path, so a failure names a file the reader can open. */
async function collectExtensions(root: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const path of await walkFiles(root)) {
    const ext = lsLintExtension(basename(path));
    if (!GOVERNED_SUFFIXES.some((suffix) => ext.endsWith(suffix))) continue;
    if (!found.has(ext)) found.set(ext, path);
  }
  return found;
}

/**
 * Extensions declared under a top-level `ls:` scope key.
 *
 * Parsed with a line scanner rather than a YAML dependency: the config is two levels deep, and
 * adding a parser to assert one property would cost more than the property is worth.
 */
function declaredExtensions(config: string, scope: string): Set<string> {
  const declared = new Set<string>();
  const lines = config.split("\n");
  const scopeLine = lines.findIndex((line) => line.trimEnd() === `  ${scope}:`);
  if (scopeLine === -1) return declared;

  for (const line of lines.slice(scopeLine + 1)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    // A line indented by 2 ends the scope: it is the next scope key, or the `ignore:` block.
    if (!line.startsWith("    ")) break;
    const extension = line.trim().match(/^(\.[^:]+):/)?.[1];
    if (extension !== undefined) declared.add(extension);
  }
  return declared;
}

describe("ls-lint covers every extension present in the test tree", () => {
  it.each([
    {
      scope: "packages/*/tests/**",
      root: join(REPO_ROOT, "packages", "sdk", "tests"),
      sentinel: ".test.ts",
    },
    { scope: "e2e", root: join(REPO_ROOT, "e2e"), sentinel: ".e2e.test.ts" },
  ])("$scope declares a rule for every TypeScript extension it contains", async ({
    scope,
    root,
    sentinel,
  }) => {
    const config = await readFile(CONFIG_PATH, "utf8");
    const declared = declaredExtensions(config, scope);
    const present = await collectExtensions(root);

    // ANTI-VACUITY GUARD. Without it this gate has the defect it was written to expose: if the
    // scan returns nothing — wrong root, a widened SKIP_DIRS, a typo in GOVERNED_SUFFIXES, a
    // readdir that failed — then `undeclared` is empty and the assertion below passes while
    // having checked zero files. The sentinel is an extension the scope carries BY DEFINITION
    // (a test tree that contains no `.test.ts` is not a test tree), so it stays true as the tree
    // grows. A file COUNT would not: a floor picked today drifts into a ratchet nobody re-reads,
    // which is how a sibling gate came to assert `toBeLessThanOrEqual(60)` over a real count of 28.
    expect(
      [...present.keys()],
      `The scan of "${root}" found no "${sentinel}" file, so it almost certainly walked nothing ` +
        `and this gate would pass without checking anything. Fix the scan before trusting a green.`,
    ).toContain(sentinel);

    const undeclared = [...present.entries()]
      .filter(([ext]) => !declared.has(ext))
      .map(([ext, example]) => `${ext} (e.g. ${example.slice(REPO_ROOT.length + 1)})`);

    expect(
      undeclared,
      `These extensions occur under "${scope}" but no rule in .ls-lint.yml matches them, so every ` +
        `file carrying them is UNCHECKED while the gate still exits 0. Add each one to the ` +
        `"${scope}" block:\n  ${undeclared.join("\n  ")}`,
    ).toEqual([]);
  });

  it("attributes the extension the way ls-lint does — longest match, not the last suffix", () => {
    // Pins the assumption the gate above rests on. If ls-lint ever changed to last-suffix
    // matching, the config's compound entries would become dead and this test would say so.
    expect(lsLintExtension("concurrent-sse-1000.test.ts")).toBe(".test.ts");
    expect(lsLintExtension("agent.golden.test.ts")).toBe(".golden.test.ts");
    expect(lsLintExtension("plain.ts")).toBe(".ts");
    expect(lsLintExtension("noextension")).toBe("");
  });
});
