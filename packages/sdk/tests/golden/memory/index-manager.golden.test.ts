import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultIndexPath } from "../../../src/internal/memory/index-db.js";
import { IndexManager } from "../../../src/internal/memory/index-manager.js";
import { memoryMdPath, notesDir } from "../../../src/internal/memory/markdown-store.js";

/**
 * Phase 3 T3.1 — SQLite + FTS5 IndexManager.
 */

async function setupMemoryCorpus(cwd: string): Promise<void> {
  await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
}

describe("IndexManager", () => {
  let cwd: string;
  let manager: IndexManager | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-index-"));
    await setupMemoryCorpus(cwd);
  });

  afterEach(() => {
    manager?.close();
    manager = undefined;
    vi.restoreAllMocks();
  });

  it("creates the schema on first open", async () => {
    manager = await IndexManager.open({ cwd });
    const status = manager.status();
    expect(status.backend).toBe("fts-only");
    expect(status.filesIndexed).toBe(0);
    expect(status.chunksIndexed).toBe(0);
  });

  it("indexes markdown chunks on sync", async () => {
    await writeFile(
      memoryMdPath(cwd),
      "# Memory\n\n## Facts\n\n- The magic-number is 8675309.\n- Vitest is the preferred test runner.\n",
      "utf8",
    );
    manager = await IndexManager.open({ cwd });
    const result = await manager.sync();
    expect(result.filesScanned).toBe(1);
    expect(result.filesUpdated).toBe(1);
    expect(result.chunksWritten).toBeGreaterThan(0);
    const status = manager.status();
    expect(status.filesIndexed).toBe(1);
    expect(status.chunksIndexed).toBeGreaterThan(0);
  });

  it("FTS5 search returns ranked hits", async () => {
    await writeFile(
      memoryMdPath(cwd),
      "# Memory\n\n## Facts\n\n- The magic-number is 8675309.\n- Vitest is the preferred test runner.\n- Random unrelated thought about cats.\n",
      "utf8",
    );
    manager = await IndexManager.open({ cwd });
    await manager.sync();
    const hits = await manager.search("magic-number 8675309");
    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0];
    expect(top?.snippet).toContain("8675309");
    expect(top?.score).toBeGreaterThan(0);
    expect(top?.citation).toMatch(/^MEMORY\.md:\d+-\d+$/);
  });

  it("reindexes a changed file (old chunks gone, new ones present)", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- old fact one.\n", "utf8");
    manager = await IndexManager.open({ cwd });
    await manager.sync();
    const before = await manager.search("old");
    expect(before.length).toBeGreaterThan(0);

    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- new fact two.\n", "utf8");
    await manager.sync();
    const afterOld = await manager.search("old");
    expect(afterOld.length).toBe(0);
    const afterNew = await manager.search("new fact");
    expect(afterNew.length).toBeGreaterThan(0);
  });

  it("status reports counts after sync", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- one\n- two\n- three\n", "utf8");
    manager = await IndexManager.open({ cwd });
    await manager.sync();
    const status = manager.status();
    expect(status.filesIndexed).toBe(1);
    expect(status.chunksIndexed).toBeGreaterThanOrEqual(1);
    expect(status.lastSyncMs).toBeGreaterThan(0);
  });

  it("handles empty corpus (no markdown files)", async () => {
    manager = await IndexManager.open({ cwd });
    const result = await manager.sync();
    expect(result.filesScanned).toBe(0);
    expect(result.filesUpdated).toBe(0);
    const hits = await manager.search("anything");
    expect(hits).toEqual([]);
  });

  it("survives a re-open after schema initialization (no orphan chunks)", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- foo bar baz.\n", "utf8");
    manager = await IndexManager.open({ cwd });
    await manager.sync();
    manager.close();
    manager = await IndexManager.open({ cwd });
    const status = manager.status();
    expect(status.filesIndexed).toBe(1);
    const hits = await manager.search("foo bar");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("recovers from a corrupt DB by renaming aside + rebuilding schema (EC-7)", async () => {
    const dbPath = defaultIndexPath(cwd);
    await mkdir(join(cwd, ".theokit", "memory", ".index"), { recursive: true });
    await writeFile(dbPath, "this is not a valid SQLite database file", "utf8");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    manager = await IndexManager.open({ cwd });
    const status = manager.status();
    expect(status.filesIndexed).toBe(0);
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
    // Notes directory should still be discoverable
    await mkdir(notesDir(cwd), { recursive: true });
    await writeFile(join(notesDir(cwd), "topic.md"), "# Topic\n\nSome notes.\n", "utf8");
    const synced = await manager.sync();
    expect(synced.filesScanned).toBe(1);
  });
});
