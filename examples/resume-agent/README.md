# Resume agent

Reattaches to an existing agent by id. The resumed handle shares the
same workspace, the same registry entry, and the same session-message
history — so a follow-up question lands with the conversation context
the first send established.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. `Agent.create(...)` — capture `agentId`.
2. `agent.send("My favourite test runner is Vitest.")` — wait for the
   assistant reply (acknowledgment).
3. Close the original handle.
4. `Agent.resume(agentId)` — fresh handle, same id.
5. `resumed.send("What's my favourite test runner?")` — assistant
   should mention **Vitest** via session history.

## v1 limitation: in-process only

The agent registry lives in-memory
(`packages/sdk/src/internal/runtime/agent-registry.ts`). After
`process.exit`, the registry is gone — calling `Agent.resume(agentId)`
in a fresh Node process returns a placeholder handle (it does not crash,
but session history is empty and project resources reload from cwd).

Cross-process resume requires persisting the registry to disk plus
concurrency handling — tracked as future work. **Cron uses
`Agent.resume` internally for scheduled jobs**; cron jobs are
short-lived within the same scheduler process, so the limitation does
not affect them.
