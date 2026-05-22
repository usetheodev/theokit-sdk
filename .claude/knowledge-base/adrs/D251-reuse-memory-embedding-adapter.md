# D251 — Reuse `MemoryEmbeddingProviderAdapter` (D11) for embeddings — zero new layer

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`Cache.semantic` `embedder` option accepts an `EmbeddingRuntime` instance OR factory opts (`{ provider: "openai" }`). Cache calls `runtime.embed([text])` to generate vectors. Default = autoselect.

## Rationale

Adapters openai/mistral/openrouter/voyage/deepinfra already shipped (D11). Reimplementing duplicates code. Embedding cache (LRU) also exists in `internal/memory/embedding-cache.ts` and can be reused via a separate namespace.

## Consequences

- Tests use fake embedder returning deterministic vectors.
- Embedder change invalidates cache via namespace (D258).
- Embedding API cost counts toward user's quota — documented.
