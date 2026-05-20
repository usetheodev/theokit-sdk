import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import type { EmbeddingRuntime } from "../../../src/internal/memory/embedding-adapter.js";
import { IndexManager } from "../../../src/internal/memory/index-manager.js";
import { memoryMdPath } from "../../../src/internal/memory/markdown-store.js";
import { createMemoryGetTool, createMemorySearchTool } from "../../../src/internal/memory/tools.js";

/**
 * Phase 6 T6.1 — memory_search + memory_get tools.
 */

function deterministicVector(text: string, dim: number): number[] {
  const vec = new Array<number>(dim);
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  for (let i = 0; i < dim; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    vec[i] = ((seed >>> 16) & 0x7fff) / 0x7fff;
  }
  return vec;
}

function fakeAdapter(dim = 8): EmbeddingRuntime {
  return {
    id: "fake",
    model: "fake-small",
    dimension: dim,
    stats: () => ({ cacheHits: 0, cacheMisses: 0, httpCalls: 0, retries: 0 }),
    embed: (texts) => Promise.resolve(texts.map((t) => deterministicVector(t, dim))),
  };
}

describe("memory_search tool", () => {
  let cwd: string;
  let manager: IndexManager | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-memtool-"));
    await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
    await writeFile(
      memoryMdPath(cwd),
      "# Memory\n\n## Facts\n\n- magic-number is 8675309.\n- vitest preferred test runner.\n- random unrelated thought.\n",
      "utf8",
    );
  });

  afterEach(() => {
    manager?.close();
    manager = undefined;
  });

  it("returns ranked results as JSON-encoded payload", async () => {
    manager = await IndexManager.open({ cwd, embedding: fakeAdapter() });
    await manager.sync();
    const tool = createMemorySearchTool({ index: manager });
    const out = await tool.execute({ query: "magic-number 8675309" });
    const parsed = JSON.parse(out) as { hits: Array<{ snippet: string }>; truncated: boolean };
    expect(parsed.hits.length).toBeGreaterThan(0);
    expect(parsed.hits[0]?.snippet).toContain("8675309");
    expect(parsed.truncated).toBe(false);
  });

  it("caps total result size when payload exceeds maxTotalChars (EC-10)", async () => {
    // Create a corpus with many large chunks to force the cap.
    const bigParagraphs = Array.from(
      { length: 50 },
      (_, i) => `## Topic ${i}\n\n${"matchword ".repeat(120).trim()}\n`,
    ).join("\n");
    await writeFile(memoryMdPath(cwd), `# Memory\n\n${bigParagraphs}\n`, "utf8");
    manager = await IndexManager.open({ cwd });
    await manager.sync();
    const tool = createMemorySearchTool({ index: manager, maxTotalChars: 2000 });
    const out = await tool.execute({ query: "matchword", maxResults: 50 });
    const parsed = JSON.parse(out) as { hits: unknown[]; truncated: boolean };
    expect(parsed.truncated).toBe(true);
    expect(out.length).toBeLessThanOrEqual(3000); // some overhead for the JSON envelope
  });

  it("filters by corpus when provided", async () => {
    manager = await IndexManager.open({ cwd });
    await manager.sync();
    const tool = createMemorySearchTool({ index: manager });
    const out = await tool.execute({ query: "vitest", corpus: "memory" });
    const parsed = JSON.parse(out) as { hits: Array<{ source: string }>; truncated: boolean };
    for (const hit of parsed.hits) expect(hit.source).toBe("memory");
  });
});

describe("memory_get tool", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-memget-"));
    await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(memoryMdPath(cwd), `${lines}\n`, "utf8");
  });

  it("returns bounded excerpt JSON", async () => {
    const tool = createMemoryGetTool({ cwd });
    const out = await tool.execute({ path: "MEMORY.md", from: 5, lines: 3 });
    const parsed = JSON.parse(out) as { text: string; linesReturned: number };
    expect(parsed.linesReturned).toBe(3);
    expect(parsed.text.split("\n")).toEqual(["line 5", "line 6", "line 7"]);
  });

  it("rejects path traversal that escapes the memory root (EC-2)", async () => {
    const tool = createMemoryGetTool({ cwd });
    await expect(tool.execute({ path: "../../etc/passwd" })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    await expect(tool.execute({ path: "../../etc/passwd" })).rejects.toMatchObject({
      code: "memory_path_escapes_root",
    });
  });

  it("rejects absolute paths outside the memory root", async () => {
    const tool = createMemoryGetTool({ cwd });
    await expect(tool.execute({ path: "/etc/passwd" })).rejects.toBeInstanceOf(ConfigurationError);
  });
});
