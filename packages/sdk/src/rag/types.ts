/**
 * RAG types — Document, Chunk, RetrievalResult (T11.1, ADR D448).
 * @public
 */

export interface Document {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface Chunk {
  text: string;
  index: number;
  metadata?: Record<string, unknown>;
}

export interface RetrievalResult {
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface RankedChunk {
  text: string;
  score: number;
  originalIndex: number;
  metadata?: Record<string, unknown>;
}

export interface SplitOptions {
  chunkSize: number;
  overlap?: number;
}

export interface Retriever {
  retrieve(query: string, options?: { topK?: number }): Promise<RetrievalResult[]>;
}

export interface Reranker {
  rerank(query: string, chunks: RetrievalResult[]): Promise<RankedChunk[]>;
}
