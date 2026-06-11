import { describe, expect, it } from "vitest";
import { splitByCharacter, splitBySentence, splitRecursive } from "../../src/rag/index.js";

describe("E2E: text splitter edge cases", () => {
  it("empty string returns empty for all splitters", () => {
    expect(splitByCharacter("", { chunkSize: 10 })).toEqual([]);
    expect(splitBySentence("", { chunkSize: 10 })).toEqual([]);
    expect(splitRecursive("", { chunkSize: 10 })).toEqual([]);
  });

  it("unicode text splits correctly", () => {
    const text = "こんにちは世界。お元気ですか？元気です。";
    const chunks = splitRecursive(text, { chunkSize: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it("very long text produces many chunks", () => {
    const text = "word ".repeat(10000);
    const chunks = splitRecursive(text, { chunkSize: 100 });
    expect(chunks.length).toBeGreaterThan(100);
  });
});
