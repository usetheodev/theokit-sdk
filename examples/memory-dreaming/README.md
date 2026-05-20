# memory-dreaming

Demonstrates the dreaming/REM consolidation sweep.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env   # set OPENAI_API_KEY or MISTRAL_API_KEY
pnpm dev
```

## What it does

1. Seeds `.theokit/memory/MEMORY.md` with 6 facts — 3 near-duplicate paraphrases
   of "Vitest is the test runner" and 2 thematic deploy facts.
2. Calls `Memory.runDreamingSweep({ cwd, embedding: { provider: "openai" } })`.
3. The SDK runs three phases:
   - **light** — drops near-duplicate facts (cosine ≥ 0.95).
   - **REM** — clusters thematically related facts (cosine ≥ 0.75).
   - **deep** — writes `.theokit/memory/notes/dreamed-<ts>.md` with
     consolidated clusters + appends an entry to `.theokit/memory/dream-diary.md`.
4. Prints the diary + the dreamed notes.

## Requirements

This example needs a real embedding provider. Set one of:

- `OPENAI_API_KEY` — uses `text-embedding-3-small`.
- `MISTRAL_API_KEY` — uses `mistral-embed`.

Without one, the example exits with a clear error.

## Scheduling consolidation

`Memory.runDreamingSweep` is a plain async function. Call it from any
scheduled context — a long-running cron, a serverless trigger, a manual
maintenance script. The SDK does not bind dreaming to its own `Cron`
namespace; the consolidation logic is decoupled so you can run it wherever
fits your operational shape.
