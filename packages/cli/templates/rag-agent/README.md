# {{projectName}}

Retrieval-augmented generation over your own files, scaffolded by `theokit init`.

## Setup

```bash
pnpm install
cp .env.example .env
mkdir -p .theokit/memory && echo "# Notes" > .theokit/memory/MEMORY.md
pnpm dev "What is in this knowledge base?"
```

## What this does

1. `Memory.openIndex({ cwd })` — SQLite full-text search, no native dependency.
2. `index.sync()` scans `.theokit/memory/` and reports what it indexed. An empty
   index says so up front, so a thin answer is not mistaken for a weak model.
3. `Tool.create(…)` exposes the index to the model, which decides when to search.
4. The agent answers from retrieved snippets and cites them.

`sources` belongs to the SEARCH, not to opening the index — it narrows which
corpora a single query reads.

## Requirements

- Node 22.12+.
- One of: Anthropic / OpenAI / OpenRouter API key.

## Next steps

- Hybrid vector recall: `Memory.openIndex({ cwd, embedding: { provider: "openai" } })`.
- LanceDB backend: `backend: "lance"` — which then REQUIRES an embedding runtime
  and the `@lancedb/lancedb` peer.
