# Ollama Local RAG

End-to-end retrieval-augmented generation pipeline running **100%
locally** via Ollama (ADR D182 + D183). No API keys, no cloud calls.

## Pipeline

```
docs.md ──▶ embed (nomic-embed-text) ──▶ vectors
                                          │
                question ──▶ embed ──▶ cosine similarity ──▶ top-3 facts
                                                                │
                                                                ▼
                                                  context + question
                                                                │
                                                                ▼
                                                  Agent.send (llama3.2)
                                                                │
                                                                ▼
                                                          grounded answer
```

## Setup

```bash
# 1. Install Ollama (one-time)
#    https://ollama.com/download

# 2. Pull both models
ollama pull nomic-embed-text     # embeddings (~274 MB)
ollama pull llama3.2:3b          # chat       (~1.9 GB)

# 3. Build the SDK once
cd ../..
pnpm install
pnpm build
cd examples/ollama-local-rag

# 4. Run
pnpm install --ignore-workspace
pnpm start
# Or with a custom question:
pnpm start -- "What does the satisfies operator do?"
```

## Example output

```
Indexing 6 facts via nomic-embed-text...
Index ready.

Question: When was TypeScript first released?

Top 3 retrieved facts:
  [0.715] TypeScript was created by Anders Hejlsberg at Microsoft and first publicly released in October 2012.
  [0.482] TypeScript compiles to plain JavaScript and runs anywhere JavaScript runs ...
  [0.421] The `unknown` type was introduced in TypeScript 3.0 ...

Answer: TypeScript was first released in October 2012.
```

## Notes

- **Idempotency**: this demo rebuilds the index every run. For a
  persistent corpus, hook the adapter into the SDK's `Memory` layer
  (see `Memory.runDreamingSweep`).
- **Corpus**: edit `data/docs.md` and re-run.
- **Latency**: first run loads both models (10-60s each). Subsequent
  runs reuse the loaded models.
