import { describe, expect, it } from "vitest";
import { CohereReranker, NoopReranker } from "../../src/rag/reranker.js";
import type { RetrievalResult } from "../../src/rag/types.js";

const sampleResults: RetrievalResult[] = [
  { text: "cooking recipe for pasta", score: 0.6 },
  { text: "pasta carbonara traditional Italian", score: 0.8 },
  { text: "unrelated document about cars", score: 0.3 },
];

describe("NoopReranker", () => {
  it("preserves original order and scores", async () => {
    const reranker = new NoopReranker();
    const ranked = await reranker.rerank("pasta recipe", sampleResults);
    expect(ranked.length).toEqual(3);
    expect(ranked[0].text).toEqual("cooking recipe for pasta");
    expect(ranked[0].score).toEqual(0.6);
  });

  it("assigns originalIndex", async () => {
    const reranker = new NoopReranker();
    const ranked = await reranker.rerank("pasta", sampleResults);
    expect(ranked[0].originalIndex).toEqual(0);
    expect(ranked[1].originalIndex).toEqual(1);
    expect(ranked[2].originalIndex).toEqual(2);
  });

  it("handles empty results", async () => {
    const reranker = new NoopReranker();
    const ranked = await reranker.rerank("anything", []);
    expect(ranked).toEqual([]);
  });
});

describe("CohereReranker", () => {
  it("re-orders by relevance score (mock)", async () => {
    const reranker = new CohereReranker({
      apiKey: "test-key",
      _mockRerank: async (_query: string, docs: RetrievalResult[]) =>
        docs
          .map((d, i) => ({
            text: d.text,
            score: d.text.includes("carbonara") ? 0.99 : 0.1 * i,
            originalIndex: i,
          }))
          .sort((a, b) => b.score - a.score),
    });
    const ranked = await reranker.rerank("Italian pasta carbonara", sampleResults);
    expect(ranked[0].text).toEqual("pasta carbonara traditional Italian");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("preserves metadata through reranking", async () => {
    const resultsWithMeta: RetrievalResult[] = [
      { text: "doc1", score: 0.5, metadata: { source: "wiki" } },
    ];
    const reranker = new CohereReranker({
      apiKey: "test-key",
      _mockRerank: async (_q, docs) =>
        docs.map((d, i) => ({ text: d.text, score: 0.9, originalIndex: i, metadata: d.metadata })),
    });
    const ranked = await reranker.rerank("query", resultsWithMeta);
    expect(ranked[0].metadata).toEqual({ source: "wiki" });
  });
});
