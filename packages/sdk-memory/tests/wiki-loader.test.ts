/**
 * sdk-memory `wiki-loader` unit test (iter 57).
 *
 * Validates the iter 57 hybrid copy of
 * `internal/memory/storage/wiki-loader.ts` from sdk-core. sdk-memory
 * now ships the canonical read-only wiki discovery that future
 * indexer moves will tag with `source="wiki"` chunk provenance so
 * `memory_search { corpus: "wiki" | "all" }` filter scopes hits.
 *
 * sdk-core retains its copy for v1.x back-compat.
 * Both copies byte-equivalent at runtime (same wikiDir layout
 * `.theokit/memory/wiki/`, same *.md filter, same root-relative
 * relPath convention).
 *
 * Uses temp-dir + real file I/O (no mocks) per the no-stubs canon.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverWikiFiles, resolveMemoryRoot, type WikiFile, wikiDir } from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("sdk-memory wiki-loader (iter 57)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-wiki-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_wikiDir_returns_theokit_memory_wiki_layout", () => {
    expect(wikiDir(resolveMemoryRoot(cwd))).toBe(join(cwd, ".theokit", "memory", "wiki"));
  });

  it("test_returns_empty_when_wiki_dir_absent", async () => {
    const result = await discoverWikiFiles(resolveMemoryRoot(cwd));
    expect(result).toEqual([]);
  });

  it("test_returns_empty_when_wiki_dir_present_but_empty", async () => {
    await mkdir(wikiDir(resolveMemoryRoot(cwd)), { recursive: true });
    const result = await discoverWikiFiles(resolveMemoryRoot(cwd));
    expect(result).toEqual([]);
  });

  it("test_includes_md_files_with_wiki_prefixed_relPath", async () => {
    await mkdir(wikiDir(resolveMemoryRoot(cwd)), { recursive: true });
    await writeFile(join(wikiDir(resolveMemoryRoot(cwd)), "intro.md"), "# Intro");
    await writeFile(join(wikiDir(resolveMemoryRoot(cwd)), "advanced.md"), "# Advanced");

    const result = await discoverWikiFiles(resolveMemoryRoot(cwd));
    expect(result.length).toBe(2);

    const sorted = [...result].sort((a, b) => a.relPath.localeCompare(b.relPath));
    expect(sorted[0]?.relPath).toBe("wiki/advanced.md");
    expect(sorted[1]?.relPath).toBe("wiki/intro.md");
    expect(sorted[0]?.absolutePath).toBe(join(wikiDir(resolveMemoryRoot(cwd)), "advanced.md"));
    expect(sorted[1]?.absolutePath).toBe(join(wikiDir(resolveMemoryRoot(cwd)), "intro.md"));
  });

  it("test_filters_out_non_markdown_files", async () => {
    await mkdir(wikiDir(resolveMemoryRoot(cwd)), { recursive: true });
    await writeFile(join(wikiDir(resolveMemoryRoot(cwd)), "keep.md"), "kept");
    await writeFile(join(wikiDir(resolveMemoryRoot(cwd)), "skip.txt"), "skipped");
    await writeFile(join(wikiDir(resolveMemoryRoot(cwd)), "skip.json"), "{}");
    await writeFile(join(wikiDir(resolveMemoryRoot(cwd)), "no-ext"), "skipped too");

    const result: WikiFile[] = await discoverWikiFiles(resolveMemoryRoot(cwd));
    expect(result.length).toBe(1);
    expect(result[0]?.relPath).toBe("wiki/keep.md");
  });

  it("test_does_not_recurse_into_subdirectories", async () => {
    // wiki-loader uses readdir without recursion. Files inside a
    // nested subdir under wiki/ are NOT returned. (The canonical sdk-core
    // copy ships the same shallow behavior — recursion would be a
    // semantic change, not a parity move.)
    await mkdir(join(wikiDir(resolveMemoryRoot(cwd)), "deep"), { recursive: true });
    await writeFile(join(wikiDir(resolveMemoryRoot(cwd)), "deep", "buried.md"), "deep content");
    await writeFile(join(wikiDir(resolveMemoryRoot(cwd)), "top.md"), "top content");

    const result = await discoverWikiFiles(resolveMemoryRoot(cwd));
    expect(result.length).toBe(1);
    expect(result[0]?.relPath).toBe("wiki/top.md");
  });
});
