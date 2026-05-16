# cloud-with-mcp-http

Demonstrates the HTTP MCP transport constraint for cloud agents (ADR D15,
EC-3 fix).

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Creates a cloud agent with two MCP servers:
   - `search` — HTTP MCP server (reachable from any VM the PaaS provisions)
   - `tooling` — stdio MCP server with bare command `npx` (PaaS image
     guarantees `npx` in PATH)
2. Prints `agent.cloudPayload` showing both serialized correctly.
3. Verifies secrets are stripped (no `Authorization`, `x-api-key`, `env`
   headers leak — ADR D16 EC-2).

## What's rejected (and why)

```ts
// REJECTED — cloud_incompatible_mcp_stdio_local
mcpServers: { x: { type: "stdio", command: "/usr/local/bin/x" } }

// REJECTED — cloud_incompatible_mcp_stdio_local
mcpServers: { x: { type: "stdio", command: "~/bin/x" } }

// REJECTED — cloud_incompatible_mcp_stdio_local
mcpServers: { x: { type: "stdio", command: "./local/x" } }
```

PaaS can't reach binaries on YOUR disk. Use bare commands (`npx`, `uvx`,
`node`) that the PaaS VM image provides, or switch to HTTP transport.

## Placeholder URL note (EC-9)

`https://mcp.example.com` in this example is a documentation placeholder.
**In fixture mode the SDK does not call it** — the example validates the
SDK accepts the config shape and serializes it correctly. Replace with your
real MCP HTTP server endpoint before running in production.
