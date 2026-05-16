import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { chunkMarkdown } from "../../../src/internal/memory/chunk-markdown.js";
import {
  DEFAULT_MEMORY_READ_LINES,
  readMemoryFileBounded,
} from "../../../src/internal/memory/reader.js";

/**
 * Phase 2 T2.1 — chunkMarkdown + bounded reader.
 */

describe("chunkMarkdown", () => {
  it("splits on heading boundaries", () => {
    const input = "# A\nbody1\n\n# B\nbody2\n";
    const chunks = chunkMarkdown(input);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]?.text).toContain("body1");
    expect(chunks[chunks.length - 1]?.text).toContain("body2");
  });

  it("respects max chars and assigns stable hashes for identical input", () => {
    const longParagraph = `${"word ".repeat(220).trim()}`; // ~1100 chars
    const chunks = chunkMarkdown(longParagraph, { maxChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(400);
      expect(chunk.hash).toMatch(/^[a-f0-9]{64}$/);
    }
    const second = chunkMarkdown(longParagraph, { maxChars: 400 });
    expect(second.map((c) => c.hash)).toEqual(chunks.map((c) => c.hash));
  });

  it("splits on a word boundary, not mid-word (EC-6)", () => {
    const paragraph = `${"abc ".repeat(300).trim()}`; // 1199 chars
    const chunks = chunkMarkdown(paragraph, { maxChars: 500 });
    for (const chunk of chunks) {
      // Each chunk must either be the last one OR end on whitespace/word.
      // Stronger: no chunk should start or end with a partial token.
      expect(chunk.text.startsWith("c") || chunk.text.startsWith("bc")).toBe(false);
      expect(chunk.text.endsWith("ab") || chunk.text.endsWith("a")).toBe(false);
    }
  });

  it("returns empty array for empty input", () => {
    expect(chunkMarkdown("")).toEqual([]);
  });

  it("captures nearest heading on each chunk", () => {
    const input = "# Title\npara1\n\n## Section\nparafoo\nparabar\n";
    const chunks = chunkMarkdown(input);
    const sectionChunk = chunks.find((c) => c.text.includes("parafoo"));
    expect(sectionChunk?.heading).toBe("Section");
  });
});

describe("readMemoryFileBounded", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-reader-"));
  });

  it("returns a bounded slice with line numbers", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(join(cwd, "memo.md"), `${lines}\n`, "utf8");
    const result = await readMemoryFileBounded({ cwd, relPath: "memo.md", from: 5, lines: 3 });
    expect(result.from).toBe(5);
    expect(result.linesReturned).toBe(3);
    expect(result.text.split("\n")).toEqual(["line 5", "line 6", "line 7"]);
    expect(result.totalLines).toBe(20);
    expect(result.remainingLines).toBe(13);
    expect(result.truncated).toBe(true);
  });

  it("flags truncated=false when reading past EOF", async () => {
    await writeFile(join(cwd, "memo.md"), "a\nb\nc\n", "utf8");
    const result = await readMemoryFileBounded({ cwd, relPath: "memo.md", from: 2, lines: 100 });
    expect(result.linesReturned).toBe(2);
    expect(result.remainingLines).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("defaults to 200 lines when lines arg is omitted", async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(join(cwd, "memo.md"), `${lines}\n`, "utf8");
    const result = await readMemoryFileBounded({ cwd, relPath: "memo.md" });
    expect(result.linesReturned).toBe(DEFAULT_MEMORY_READ_LINES);
    expect(result.remainingLines).toBe(300);
    expect(result.truncated).toBe(true);
  });
});
