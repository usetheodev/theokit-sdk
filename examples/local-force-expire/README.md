# local-force-expire

`local: { force: true }` on `SendOptions` — expire a stuck previous run
before starting a new one.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it shows

Local agents track a single "active run" per agent. If a previous run is
stuck (status `"running"` but no progress), the next `send()` would
either block or fail. Setting `local: { force: true }` on the new send
transitions the stuck run to `"cancelled"` and starts the new one.

Use in production when:

- Your process restarted with a stale registry entry
- The previous run hung on an external IO (MCP server, hook subprocess)
- You want to retry without re-creating the agent
