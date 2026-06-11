/**
 * Retriever implementations for RAG pipelines (T11.1, ADR D448).
 *
 * VectorRetriever wraps any index that implements `search(query, topK)`.
 * The Retriever interface is the contract — consumers depend on the interface,
 * implementations depend on the index adapter (DIP per architecture.md § 2).
 *
 * @public
 */

import type { RetrievalResult, Retriever } from "./types.js";

export interface VectorIndex {
  search(query: string, topK: number): Promise<RetrievalResult[]>;
}

export interface VectorRetrieverOptions {
  index: VectorIndex;
  topK?: number;
}

export class VectorRetriever implements Retriever {
  private readonly _index: VectorIndex;
  private readonly _defaultTopK: number;

  constructor(opts: VectorRetrieverOptions) {
    this._index = opts.index;
    this._defaultTopK = opts.topK ?? 5;
  }

  async retrieve(query: string, options?: { topK?: number }): Promise<RetrievalResult[]> {
    const topK = options?.topK ?? this._defaultTopK;
    return this._index.search(query, topK);
  }
}
