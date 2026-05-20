# memory-lance — LanceDB backend + Migration CLI

Demonstrates the LanceDB opt-in backend for Memory + the `theokit-migrate-memory` CLI (ADR D43, ADR D44).

## What it does

1. Creates a tmpdir workspace.
2. Seeds 5 facts in `.theokit/memory/MEMORY.md` (the markdown source of truth — the SQLite/Lance index is built lazily from this file).
3. Runs `migrateSqliteToLance({ cwd, dryRun: true })` — works WITHOUT `@lancedb/lancedb` installed (read-only SQLite scan).
4. Shows the `AgentOptions.memory.index.backend = "lance"` config that opts into the Lance backend.
5. Documents the graceful degradation: without `@lancedb/lancedb` installed, the SDK raises `ConfigurationError(code: "lance_backend_unavailable")` with install hint.

Always exits 0, with or without Lance installed (ADR D50).

## Setup

```bash
pnpm install --ignore-workspace
```

No env vars required for the dry-run path.

## Run

```bash
pnpm dev
```

## With Lance installed

To activate the real Lance backend:

```bash
pnpm add @lancedb/lancedb
```

Then in your `Agent.create` call:

```ts
const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  memory: {
    enabled: true,
    namespace: "my-bot",
    userId: "user-123",
    scope: "user",
    index: {
      backend: "lance",
      embedding: { provider: "openai", model: "text-embedding-3-small" },
    },
  },
});
```

## Migration from SQLite to Lance

Use the bundled CLI:

```bash
# Dry-run first (preview only, never writes)
pnpm exec theokit-migrate-memory --cwd . --dry-run

# Real migration with confirmation prompt
pnpm exec theokit-migrate-memory --cwd .
```

The migration:
1. Reads all facts from `.theokit/memory/index.sqlite`.
2. Writes to staging `.theokit/memory/lance-new/`.
3. Validates: count match + sample-of-10 NFC unicode-normalized text match (EC-3 — facts in pt-BR/zh/ja with accents migrate correctly).
4. On success: rename `lance-new/` → `lance/` (atomic commit).
5. Prompts to delete SQLite db (skip with `--keep-sqlite`).
6. On failure: leaves SQLite intact, removes `lance-new/`.

## Environment compatibility

`@lancedb/lancedb` is an optional peer dependency. The native binding may fail to install on:
- Alpine Linux / musl
- ARM (Raspberry Pi, older M1 macs with no Rosetta)

In those environments, the SDK falls back to the default SQLite backend automatically. Migration CLI dry-run still works (no Lance dep needed).

## See also

- ADR D43 — `.claude/knowledge-base/adrs/D43-lance-backend-same-interface.md`
- ADR D44 — `.claude/knowledge-base/adrs/D44-migration-cli-standalone.md`
- SDK docs: `docs.md` § "Memory backends" + "Migration CLI"
