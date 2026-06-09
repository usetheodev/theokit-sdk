/**
 * RAG (Retrieval-Augmented Generation) sub-path barrel (T11.1, ADR D448).
 *
 * Exported via `@theokit/sdk/rag`.
 *
 * @public
 */

export { CohereReranker, type CohereRerankerOptions, NoopReranker } from "./reranker.js";
export { type VectorIndex, VectorRetriever, type VectorRetrieverOptions } from "./retriever.js";
export { splitByCharacter, splitBySentence, splitRecursive } from "./text-splitter.js";
export type {
  Chunk,
  Document,
  RankedChunk,
  Reranker,
  RetrievalResult,
  Retriever,
  SplitOptions,
} from "./types.js";
