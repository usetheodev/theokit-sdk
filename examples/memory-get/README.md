# memory-get

Demonstrates the `memory_get` tool — safe bounded read by path + line range.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Writes a deploy runbook to `.theokit/memory/notes/deploy.md`.
2. Asks the model for the rollback procedure. The model is expected to
   call `memory_get({ path: "notes/deploy.md" })` and summarize.

## Safety

- `memory_get` rejects any `path` that escapes `.theokit/memory/` —
  `path: "../../etc/passwd"` throws `ConfigurationError(code: "memory_path_escapes_root")`
  (EC-2 of the edge-case review).
- Bounded read defaults to 200 lines per call; `from` + `lines` parameters
  scope further.
