/**
 * Reranker implementations for RAG pipelines (T11.1, ADR D448).
 *
 * NoopReranker: passes through results unchanged (baseline).
 * CohereReranker: calls the Cohere Rerank API (optional peer dep).
 *
 * @public
 */

import type { RankedChunk, Reranker, RetrievalResult } from "./types.js";

export class NoopReranker implements Reranker {
  async rerank(_query: string, chunks: RetrievalResult[]): Promise<RankedChunk[]> {
    return chunks.map((c, i) => ({
      text: c.text,
      score: c.score,
      originalIndex: i,
      metadata: c.metadata,
    }));
  }
}

type MockRerankFn = (query: string, docs: RetrievalResult[]) => Promise<RankedChunk[]>;

export interface CohereRerankerOptions {
  apiKey: string;
  model?: string;
  _mockRerank?: MockRerankFn;
}

export class CohereReranker implements Reranker {
  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _mockRerank?: MockRerankFn;

  constructor(opts: CohereRerankerOptions) {
    this._apiKey = opts.apiKey;
    this._model = opts.model ?? "rerank-v3.5";
    this._mockRerank = opts._mockRerank;
  }

  async rerank(query: string, chunks: RetrievalResult[]): Promise<RankedChunk[]> {
    if (chunks.length === 0) return [];

    if (this._mockRerank) {
      return this._mockRerank(query, chunks);
    }

    const response = await fetch("https://api.cohere.com/v2/rerank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this._apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this._model,
        query,
        documents: chunks.map((c) => c.text),
        top_n: chunks.length,
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere rerank failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    return data.results.map((r) => ({
      text: chunks[r.index].text,
      score: r.relevance_score,
      originalIndex: r.index,
      metadata: chunks[r.index].metadata,
    }));
  }
}
