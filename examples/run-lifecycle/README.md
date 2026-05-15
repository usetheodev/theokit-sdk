# Run lifecycle

Demonstrates the introspection surface on a `Run` handle:

- `run.supports(op)` / `run.unsupportedReason(op)` — which operations
  this run handle supports (varies between local/cloud/historical).
- `run.onDidChangeStatus(listener)` — observable status transitions
  (running → finished | error | cancelled).
- `run.cancel()` — best-effort cancellation.
- `run.conversation()` — structured per-turn view (assistantMessage,
  toolCall, shell command, etc.).

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```
