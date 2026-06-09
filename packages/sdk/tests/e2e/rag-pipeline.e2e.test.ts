import { describe, expect, it } from "vitest";
import { NoopReranker, splitRecursive, VectorRetriever } from "../../src/rag/index.js";
import type { RetrievalResult } from "../../src/rag/types.js";

describe("E2E: RAG pipeline", () => {
  it("chunk → retrieve → rerank end-to-end", async () => {
    const text = "The quick brown fox. Jumps over the lazy dog. In the garden.";
    const chunks = splitRecursive(text, { chunkSize: 25 });
    expect(chunks.length).toBeGreaterThan(1);

    const mockIndex = {
      async search(_query: string, topK: number): Promise<RetrievalResult[]> {
        return chunks.slice(0, topK).map((c, i) => ({
          text: c.text,
          score: 0.9 - i * 0.1,
        }));
      },
    };

    const retriever = new VectorRetriever({ index: mockIndex, topK: 2 });
    const results = await retriever.retrieve("fox garden");
    expect(results.length).toEqual(2);

    const reranker = new NoopReranker();
    const ranked = await reranker.rerank("fox", results);
    expect(ranked.length).toEqual(2);
    expect(ranked[0].originalIndex).toEqual(0);
  });
});
