import { describe, expect, it } from "vitest";
import { VectorRetriever } from "../../src/rag/retriever.js";
import type { RetrievalResult } from "../../src/rag/types.js";

const mockIndex = {
  async search(query: string, topK: number): Promise<RetrievalResult[]> {
    if (query.includes("quantum")) return [];
    return [
      { text: "result 1", score: 0.95, metadata: {} },
      { text: "result 2", score: 0.87, metadata: {} },
      { text: "result 3", score: 0.72, metadata: {} },
    ].slice(0, topK);
  },
};

describe("VectorRetriever", () => {
  it("returns top-k results from index", async () => {
    const retriever = new VectorRetriever({ index: mockIndex, topK: 3 });
    const results = await retriever.retrieve("cooking recipes");
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results[0]!.score).toEqual(0.95);
  });

  it("respects topK option", async () => {
    const retriever = new VectorRetriever({ index: mockIndex, topK: 2 });
    const results = await retriever.retrieve("cooking");
    expect(results.length).toEqual(2);
  });

  it("results have score property", async () => {
    const retriever = new VectorRetriever({ index: mockIndex, topK: 3 });
    const results = await retriever.retrieve("cooking");
    for (const r of results) {
      expect(r).toHaveProperty("score");
      expect(typeof r.score).toEqual("number");
    }
  });

  it("EC-6: returns empty array when no matches", async () => {
    const retriever = new VectorRetriever({ index: mockIndex, topK: 3 });
    const results = await retriever.retrieve("quantum physics");
    expect(results).toEqual([]);
  });

  it("override topK at retrieve time", async () => {
    const retriever = new VectorRetriever({ index: mockIndex, topK: 10 });
    const results = await retriever.retrieve("cooking", { topK: 1 });
    expect(results.length).toEqual(1);
  });
});
