# Agent management

Demonstrates the static management surface on `Agent`:

- `Agent.list({ runtime?, limit?, cursor? })`
- `Agent.get(agentId)`
- `Agent.listRuns({ runtime?, ... })`
- `Agent.getRun(runId, options)`
- `Agent.archive(agentId)` / `Agent.unarchive(agentId)`
- `Agent.delete(agentId)`

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

Uses fixture mode (no provider key needed) so the example produces
deterministic output and runs without a backend.
