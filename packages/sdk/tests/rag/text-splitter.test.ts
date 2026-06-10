import { describe, expect, it } from "vitest";
import { splitByCharacter, splitBySentence, splitRecursive } from "../../src/rag/text-splitter.js";

describe("text-splitter", () => {
  describe("splitByCharacter", () => {
    it("splits text into chunks of specified size", () => {
      const chunks = splitByCharacter("abcdefghij", { chunkSize: 4 });
      expect(chunks.length).toEqual(3);
      expect(chunks[0]!.text).toEqual("abcd");
      expect(chunks[1]!.text).toEqual("efgh");
      expect(chunks[2]!.text).toEqual("ij");
    });

    it("respects overlap", () => {
      const chunks = splitByCharacter("abcdefghij", { chunkSize: 5, overlap: 2 });
      expect(chunks[0]!.text).toEqual("abcde");
      expect(chunks[1]!.text).toEqual("defgh");
    });

    it("EC-5: empty string returns empty array", () => {
      expect(splitByCharacter("", { chunkSize: 10 })).toEqual([]);
    });

    it("EC-5: single char returns one chunk", () => {
      const chunks = splitByCharacter("x", { chunkSize: 10 });
      expect(chunks.length).toEqual(1);
      expect(chunks[0]!.text).toEqual("x");
    });
  });

  describe("splitBySentence", () => {
    it("splits at sentence boundaries", () => {
      const chunks = splitBySentence("Hello world. How are you? Fine thanks.", { chunkSize: 20 });
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0]!.text).toMatch(/Hello world\./);
    });

    it("keeps sentences together when under chunkSize", () => {
      const chunks = splitBySentence("Short. Also short.", { chunkSize: 100 });
      expect(chunks.length).toEqual(1);
      expect(chunks[0]!.text).toEqual("Short. Also short.");
    });

    it("EC-5: empty string returns empty array", () => {
      expect(splitBySentence("", { chunkSize: 10 })).toEqual([]);
    });
  });

  describe("splitRecursive", () => {
    it("chunks at paragraph then sentence then character boundaries", () => {
      const text = "First paragraph.\n\nSecond paragraph with more text that is longer.";
      const chunks = splitRecursive(text, { chunkSize: 30 });
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0]!.text).toEqual("First paragraph.");
    });

    it("handles overlap correctly", () => {
      const chunks = splitRecursive("Hello world. How are you? I am fine.", {
        chunkSize: 15,
        overlap: 5,
      });
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it("EC-5: empty string returns empty array", () => {
      expect(splitRecursive("", { chunkSize: 100 })).toEqual([]);
    });

    it("EC-5: single char returns one chunk", () => {
      const chunks = splitRecursive("x", { chunkSize: 100 });
      expect(chunks.length).toEqual(1);
      expect(chunks[0]!.text).toEqual("x");
    });

    it("preserves chunk index", () => {
      const chunks = splitRecursive("First. Second. Third.", { chunkSize: 10 });
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]!.index).toEqual(i);
      }
    });
  });
});
