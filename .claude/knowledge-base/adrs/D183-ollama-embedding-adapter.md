# D183 — Ollama embedding adapter via native `/api/embeddings` shape

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`@usetheo/sdk` adds Ollama as the sixth embedding adapter in
`MEMORY_EMBEDDING_ADAPTERS`. The adapter:

- Targets Ollama's OpenAI-compatible `/v1/embeddings` endpoint (not the
  native `/api/embeddings`) and reuses the shared
  `createOpenAiCompatibleRuntime` factory verbatim.
- Carries `transport: "local"` (first adapter in the catalog with this
  value — `transport` union extended from `"remote"` to `"remote" | "local"`).
- Forwards `OLLAMA_API_KEY` when set (Ollama Cloud / reverse-proxy auth);
  otherwise sends the sentinel `"ollama-local"` as Bearer token, mirroring
  OpenClaw's `OLLAMA_DEFAULT_API_KEY` and our own `sentinelForNoAuth`
  router fallback.
- Defaults to `nomic-embed-text` (768 dim, ~274MB). Built-in
  `DIMENSION_BY_MODEL` covers `nomic-embed-text`, `all-minilm`,
  `bge-large`, `bge-m3`, `mxbai-embed-large` (plus their `:latest` tags).
- Reuses the factory's existing EC-4 contract — unknown models throw
  `ConfigurationError(code: "embedding_unknown_model")` BEFORE any HTTP
  call, preventing silent dimension mismatches in the vector store.

## Rationale

- **Reuse over reinvention.** Ollama's `/v1/embeddings` is byte-shape
  identical to OpenAI's. Plugging into `createOpenAiCompatibleRuntime`
  saves ~140 LOC and avoids drift between adapters.
- **`transport: "local"` enables future SDK heuristics.** Auto-select
  priority can prefer cheaper local providers, dreaming sweeps can
  document zero-cost guarantees, etc.
- **Sentinel pattern matches OpenClaw.** Their `OLLAMA_DEFAULT_API_KEY =
  "ollama-local"` is exactly what we forward. Local Ollama ignores the
  `Authorization` header; sending a sentinel is harmless and keeps the
  factory contract clean (it requires a non-empty apiKey).
- **EC-A MUST FIX absorbed.** The dimension table is the single source
  of truth — the factory's EC-4 fail-fast prevents the "stored vectors
  at wrong dim → silent retrieval corruption" failure mode the edge-case
  review flagged.

Alternatives rejected:

- **Use native `/api/embeddings` endpoint.** Forces a custom transport
  (no batching, different request shape `{model, prompt}` vs
  `{model, input: [...]}`). Marginal benefit; high duplication cost.
- **Dynamic dimension probe.** Adapter calls `/api/show` to read
  dimension from the model card. Adds a startup HTTP call + races with
  model loading; the static table covers every Ollama-supported
  embedding model as of 2026-05.

## Consequences

- **Enables:** Memory + RAG flows running 100% locally (no remote API
  key needed anywhere in the SDK). Demonstrated by
  `examples/ollama-local-rag`.
- **Constrains:** Adding a new Ollama embedding model requires updating
  `DIMENSION_BY_MODEL` in the adapter source. Out-of-table models throw
  early with an actionable error.
- **Carries forward:** LM Studio and llama.cpp embedding adapters can
  follow the same pattern when their respective server binaries
  stabilize their `/v1/embeddings` implementations.
