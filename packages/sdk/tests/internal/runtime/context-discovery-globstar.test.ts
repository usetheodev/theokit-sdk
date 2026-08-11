/**
 * `globbed` discovery and `**` — B-119.
 *
 * `walkUpForGlob` splits its pattern at the LAST `/`, treats the prefix as a literal directory and
 * does a single `readdir` of it. So a nested file is unreachable, and a pattern that says so
 * explicitly is worse than unreachable: `.theokit/rules/**\/*.md` resolves the directory part to a
 * literal `**`, `existsSync` fails, and the spec matches NOTHING — not even the top-level file it
 * matched before the author added the globstar.
 *
 * Measured from a consumer: TheoCode's `loadRules` descends recursively, so migrating it onto this
 * spec would silently drop every nested rule — on the path that decides whether a repository's
 * `[[hooks]]` execute.
 *
 * The package already contains the code that fixes this. `context-glob.ts`'s `globToRegex` compiles
 * `**` correctly; `walkUpForGlob` builds its own weaker matcher instead. Two implementations of one
 * rule, with the enumerator using the weaker one.
 *
 * The flat case is pinned as hard as the recursive one. `*` must never cross a `/`, or every
 * existing consumer of `.theokit/rules/*.md` silently starts absorbing nested files — a widening
 * nobody asked for and nobody would see.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type DiscoverySpec,
  walkUpForGlob,
} from "../../../src/internal/runtime/context/context-discovery.js";
import { runDiscovery } from "../../../src/internal/runtime/context/context-discovery-runner.js";

describe("walkUpForGlob — `**` reaches every depth (B-119)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "theokit-globstar-"));
    await mkdir(join(tmp, ".theokit", "rules", "deep", "nested"), { recursive: true });
    await writeFile(join(tmp, ".theokit", "rules", "top.md"), "top");
    await writeFile(join(tmp, ".theokit", "rules", "deep", "mid.md"), "mid");
    await writeFile(join(tmp, ".theokit", "rules", "deep", "nested", "inner.md"), "inner");
    await writeFile(join(tmp, ".theokit", "rules", "notes.txt"), "ignored");
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(tmp, { recursive: true, force: true });
  });

  it("test_a_globstar_pattern_finds_files_at_every_depth", async () => {
    const found = await walkUpForGlob(tmp, ".theokit/rules/**/*.md");
    const names = found.map((p) => p.slice(tmp.length + 1)).sort();

    expect(names).toEqual([
      ".theokit/rules/deep/mid.md",
      ".theokit/rules/deep/nested/inner.md",
      ".theokit/rules/top.md",
    ]);
  });

  it("test_a_globstar_pattern_still_respects_the_file_extension", async () => {
    // Anti-vacuity: recursion must not turn the pattern into "everything under here".
    const found = await walkUpForGlob(tmp, ".theokit/rules/**/*.md");
    expect(found.some((p) => p.endsWith("notes.txt"))).toBe(false);
  });

  it("test_a_flat_pattern_keeps_its_flat_meaning", async () => {
    // The compatibility half, and the one that would break every existing consumer if it drifted.
    const found = await walkUpForGlob(tmp, ".theokit/rules/*.md");
    const names = found.map((p) => p.slice(tmp.length + 1));

    expect(names).toEqual([".theokit/rules/top.md"]);
  });

  it("test_results_are_returned_in_a_stable_order", async () => {
    // Discovery order decides prompt order, so it has to be reproducible across filesystems rather
    // than inherited from `readdir`.
    const a = await walkUpForGlob(tmp, ".theokit/rules/**/*.md");
    const b = await walkUpForGlob(tmp, ".theokit/rules/**/*.md");

    expect(a).toEqual(b);
    expect(a).toEqual([...a].sort());
  });

  it("test_a_missing_directory_yields_nothing_rather_than_throwing", async () => {
    expect(await walkUpForGlob(tmp, ".theokit/absent/**/*.md")).toEqual([]);
    expect(await walkUpForGlob(tmp, ".theokit/absent/*.md")).toEqual([]);
  });

  it("test_a_traversal_pattern_is_still_refused", async () => {
    // `isSafePattern` guards the pattern; adding recursion must not open a way past it.
    expect(await walkUpForGlob(tmp, "../**/*.md")).toEqual([]);
    expect(await walkUpForGlob(tmp, ".theokit/../../**/*.md")).toEqual([]);
  });
});

describe("runDiscovery — a globstar spec reaches the nested rule (B-119)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "theokit-globstar-disc-"));
    await mkdir(join(tmp, ".theokit", "rules", "deep"), { recursive: true });
    await writeFile(join(tmp, ".theokit", "rules", "top.md"), "top level rule");
    await writeFile(join(tmp, ".theokit", "rules", "deep", "inner.md"), "nested rule");
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(tmp, { recursive: true, force: true });
  });

  // The unit case above proves `walkUpForGlob`; this proves the wiring. A consumer never calls
  // that function — it calls `runDiscovery`, which reaches it through `resolvePathsForSpec`, and a
  // fix that stopped at the leaf would look complete while changing nothing a consumer can see.
  const globstarSpec: DiscoverySpec = {
    id: "theokit-rules-recursive",
    pattern: ".theokit/rules/**/*.md",
    scope: "globbed",
    parser: "rules-frontmatter",
    followImports: false,
    priority: 45,
  };

  it("test_a_globstar_spec_surfaces_both_depths_through_runDiscovery", async () => {
    const sources = await runDiscovery({
      cwd: tmp,
      specs: [globstarSpec],
      maxBytesPerFile: 65_536,
    });
    const blob = JSON.stringify(sources);

    expect(blob).toContain("top level rule");
    expect(blob).toContain("nested rule");
  });

  it("test_the_shipped_flat_spec_still_sees_only_the_top_level", async () => {
    // The compatibility contract at the level consumers actually use. If this ever goes green for
    // the nested file, every existing installation silently widened.
    const flat: DiscoverySpec[] = [{ ...globstarSpec, pattern: ".theokit/rules/*.md" }];
    const blob = JSON.stringify(
      await runDiscovery({ cwd: tmp, specs: flat, maxBytesPerFile: 65_536 }),
    );

    expect(blob).toContain("top level rule");
    expect(blob).not.toContain("nested rule");
  });
});
