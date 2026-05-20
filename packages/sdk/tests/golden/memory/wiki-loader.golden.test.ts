import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IndexManager } from "../../../src/internal/memory/index-manager.js";
import { memoryDir, memoryMdPath } from "../../../src/internal/memory/markdown-store.js";
import { wikiDir } from "../../../src/internal/memory/wiki-loader.js";

/**
 * Phase 10 T10.1 — wiki supplement indexing + corpus filtering.
 */

describe("memory-wiki supplements", () => {
  let cwd: string;
  let manager: IndexManager | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-wiki-"));
    await mkdir(memoryDir(cwd), { recursive: true });
    await mkdir(wikiDir(cwd), { recursive: true });
  });

  afterEach(() => {
    manager?.close();
    manager = undefined;
  });

  it("indexes wiki/*.md files with source='wiki'", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- memory entry alpha.\n", "utf8");
    await writeFile(
      join(wikiDir(cwd), "guide.md"),
      "# Guide\n\nWiki content about wikiword zoltar.\n",
      "utf8",
    );
    manager = await IndexManager.open({ cwd });
    const synced = await manager.sync();
    expect(synced.filesScanned).toBe(2);
    expect(synced.filesUpdated).toBe(2);
    const hits = await manager.search("zoltar");
    expect(hits.length).toBeGreaterThan(0);
    const wikiHit = hits.find((h) => h.source === "wiki");
    expect(wikiHit).toBeDefined();
    expect(wikiHit?.path).toContain("wiki/guide.md");
  });

  it("corpus=wiki filter returns only wiki hits", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- topic foo.\n", "utf8");
    await writeFile(join(wikiDir(cwd), "wiki-foo.md"), "# Foo\n\nfoo from wiki side.\n", "utf8");
    manager = await IndexManager.open({ cwd });
    await manager.sync();
    const onlyWiki = await manager.search("foo", { sources: ["wiki"] });
    expect(onlyWiki.length).toBeGreaterThan(0);
    for (const hit of onlyWiki) expect(hit.source).toBe("wiki");
  });

  it("default search (no sources filter) returns both memory + wiki hits", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- shared keyword alpha.\n", "utf8");
    await writeFile(
      join(wikiDir(cwd), "wiki-alpha.md"),
      "# Wiki\n\nshared keyword alpha discussion.\n",
      "utf8",
    );
    manager = await IndexManager.open({ cwd });
    await manager.sync();
    const all = await manager.search("alpha");
    const sources = new Set(all.map((h) => h.source));
    expect(sources.has("memory")).toBe(true);
    expect(sources.has("wiki")).toBe(true);
  });
});
