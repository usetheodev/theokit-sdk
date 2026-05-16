# memory-search

Demonstrates the `memory_search` tool — semantic+lexical hybrid search over
`.theokit/memory/MEMORY.md` and `memory/notes/*.md`.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Creates `.theokit/memory/MEMORY.md` with 5 seed facts under `## Facts`.
2. Creates an agent with `memory: { enabled: true }`. The SDK lazily opens
   the SQLite FTS5 index + registers `memory_search` + `memory_get` with
   the LLM.
3. Asks the model to find a specific fact. The model is expected to call
   `memory_search({ query: "magic-number" })` and return the answer.

## Expected output

The agent's final text mentions `8675309` and (typically) references
calling `memory_search`. The captured `tools` array in the request body
includes `memory_search` and `memory_get`.

## Notes

- FTS-only mode is enabled by default (no embedding provider). For hybrid
  vector + FTS search, set `memory: { enabled: true, index: { embedding: { provider: "openai" } } }`.
- The index lives under `.theokit/memory/.index/memory.sqlite` (WAL mode).
- Corpus filters via `corpus=memory|wiki|all` per OpenClaw schema.
