# send-mcp-override

`SendOptions.mcpServers` — per-send MCP server set override.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it shows

Each `agent.send()` accepts an optional `mcpServers` field that REPLACES
the agent's baseline MCP config for that call only. Useful for one-off
sends that need a different tool surface than the long-lived agent default.
