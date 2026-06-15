---
user-invocable: false
description: RAG primitives -- VectorRetriever, CohereReranker, text splitters from @theokit/sdk/rag.
paths:
  - "**/*retriev*"
  - "**/*rerank*"
  - "**/*splitter*"
  - "**/*rag*"
---

# TheoKit SDK -- RAG

Quick reference for the RAG (Retrieval-Augmented Generation) sub-path at `@theokit/sdk/rag`.

## Installation

The RAG module ships with `@theokit/sdk` -- no additional install needed.

```typescript
import {
  VectorRetriever,
  CohereReranker,
  NoopReranker,
  splitByCharacter,
  splitBySentence,
  splitRecursive,
} from "@theokit/sdk/rag";
```

## Types

```typescript
interface Document {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

interface Chunk {
  text: string;
  index: number;
  metadata?: Record<string, unknown>;
}

interface RetrievalResult {
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

interface RankedChunk {
  text: string;
  score: number;
  originalIndex: number;
  metadata?: Record<string, unknown>;
}

interface SplitOptions {
  chunkSize: number;
  overlap?: number;
}
```

## Interfaces

### Retriever

```typescript
interface Retriever {
  retrieve(query: string, options?: { topK?: number }): Promise<RetrievalResult[]>;
}
```

### Reranker

```typescript
interface Reranker {
  rerank(query: string, chunks: RetrievalResult[]): Promise<RankedChunk[]>;
}
```

## VectorRetriever

Wraps any index that implements `search(query, topK)`.

```typescript
interface VectorIndex {
  search(query: string, topK: number): Promise<RetrievalResult[]>;
}

interface VectorRetrieverOptions {
  index: VectorIndex;
  topK?: number; // default 5
}
```

Usage:

```typescript
import { VectorRetriever } from "@theokit/sdk/rag";

const retriever = new VectorRetriever({
  index: myVectorIndex,
  topK: 10,
});

const results = await retriever.retrieve("How does auth work?");
// results: RetrievalResult[] sorted by relevance
```

The `VectorIndex` interface is the DI boundary. Consumers depend on the interface; implementations (e.g., backed by Memory's SQLite-vec or LanceDB index) depend on the index adapter.

## CohereReranker

Calls the Cohere Rerank v2 API to re-score retrieval results by relevance.

```typescript
interface CohereRerankerOptions {
  apiKey: string;
  model?: string; // default "rerank-v3.5"
}
```

Usage:

```typescript
import { CohereReranker } from "@theokit/sdk/rag";

const reranker = new CohereReranker({
  apiKey: process.env.COHERE_API_KEY!,
  model: "rerank-v3.5",
});

const ranked = await reranker.rerank("auth middleware", retrievalResults);
// ranked: RankedChunk[] re-scored by Cohere
```

## NoopReranker

Passes through results unchanged. Useful as a baseline or when reranking is not needed.

```typescript
import { NoopReranker } from "@theokit/sdk/rag";

const reranker = new NoopReranker();
const ranked = await reranker.rerank(query, results);
// ranked === results (with originalIndex added)
```

## Text splitters

Three strategies for splitting documents into chunks. All return `Chunk[]` with `text` and `index`. Empty input returns an empty array.

### splitByCharacter

Fixed-size character windows with optional overlap.

```typescript
import { splitByCharacter } from "@theokit/sdk/rag";

const chunks = splitByCharacter(longText, { chunkSize: 500, overlap: 50 });
```

### splitBySentence

Groups sentences into chunks up to `chunkSize` characters.

```typescript
import { splitBySentence } from "@theokit/sdk/rag";

const chunks = splitBySentence(longText, { chunkSize: 500 });
```

Splits on sentence boundaries (`.`, `!`, `?` followed by whitespace). Sentences are never broken mid-sentence.

### splitRecursive

Three-level cascading split: paragraph, then sentence, then character.

```typescript
import { splitRecursive } from "@theokit/sdk/rag";

const chunks = splitRecursive(longText, { chunkSize: 500, overlap: 50 });
```

Algorithm:
1. Split by double newlines (paragraphs).
2. Paragraphs that exceed `chunkSize` are split by sentence.
3. Sentences that still exceed `chunkSize` are split by character.

This is the recommended default for most RAG use cases.

## Full RAG pipeline example

```typescript
import { VectorRetriever, CohereReranker, splitRecursive } from "@theokit/sdk/rag";

// 1. Split documents
const chunks = splitRecursive(documentText, { chunkSize: 500, overlap: 50 });

// 2. Index chunks (your vector store)
await vectorStore.upsert(chunks.map((c, i) => ({
  id: `doc-${i}`,
  text: c.text,
  embedding: await embed(c.text),
})));

// 3. Retrieve
const retriever = new VectorRetriever({ index: vectorStore, topK: 20 });
const results = await retriever.retrieve(userQuery);

// 4. Rerank
const reranker = new CohereReranker({ apiKey: process.env.COHERE_API_KEY! });
const ranked = await reranker.rerank(userQuery, results);

// 5. Use top results as agent context
const context = ranked.slice(0, 5).map((r) => r.text).join("\n\n");
const agent = await Agent.create({
  systemPrompt: `Use this context:\n${context}`,
  // ...
});
```

## DI integration

Use `@Retriever` and `@Reranker` decorators from `@theokit/di-agent` to register RAG components in the DI container. See the theokit-di-agent skill for details.
