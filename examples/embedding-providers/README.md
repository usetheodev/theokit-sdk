# embedding-providers

Switch among the 5 embedding adapters shipped in v1.0 (ADR D11).

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
# uncomment ONE of the provider keys
pnpm dev
```

## What it shows

`Memory.runDreamingSweep({ embedding: { provider } })` accepts `"openai"`,
`"mistral"`, `"openrouter"`, `"voyage"`, or `"deepinfra"`. Same code path
for all 5 — the adapter is selected by provider id, env-resolved API key.

Each provider produces different cluster shapes because different models
encode semantic similarity differently:

| Provider | Default model | Dimensions |
|---|---|---|
| `openai` | `text-embedding-3-small` | 1536 |
| `mistral` | `mistral-embed` | 1024 |
| `openrouter` | `openai/text-embedding-3-small` | 1536 |
| `voyage` | `voyage-3-lite` | 512 |
| `deepinfra` | `BAAI/bge-large-en-v1.5` | 1024 |

## Why this matters

Per ADR D4, the SDK does not maintain a curated model catalog —
`Theokit.models.list()` is the source of truth for available models. But
the adapter ids are locked: only the 5 above ship in v1.0. The 3 deferred
(`lmstudio`, `google`, `bedrock`) are tracked for v1.1 in ADRs D11/D12/D13.
