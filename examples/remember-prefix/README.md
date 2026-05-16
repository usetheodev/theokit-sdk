# remember-prefix

Auto-write memory facts via the `Remember:` prefix on user messages.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it shows

When `memory.enabled === true`, the SDK scans each user message for the
`Remember:` prefix (case-insensitive, also accepts `Remember this durable
preference:`). Matching messages have the fact text extracted and
persisted to `.theokit/memory/MEMORY.md` **before** the LLM call —
durable even if the LLM call fails.

## Secret redaction (ADR D9)

Patterns `sk-*`, `ghp_*`, `sk-proj-*` are replaced with `***` in the
persisted markdown. The example sends a message containing a fake API
key and verifies the persisted version is redacted.

## Companion examples

- `memory` — full memory recall flow (agent reads facts back)
- `memory-search` — LLM-driven memory search via the `memory_search` tool
- `memory-get` — LLM-driven bounded reads via the `memory_get` tool
- `active-memory` — pre-send blocking recall via `<active-memory>` block
- `memory-dreaming` — consolidation via `Memory.runDreamingSweep`
