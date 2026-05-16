# mcp-http

Companion to [`mcp-stdio`](../mcp-stdio). Same SDK shape, different transport.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it shows

`mcpServers.<name>.type: "http"` for a remote MCP server. The SDK speaks
HTTP (the MCP HTTP+SSE / HTTP+JSON spec) to the URL — no subprocess like
stdio.

## Placeholder URL

`https://mcp.example.com` is a documentation placeholder. In fixture mode
the SDK doesn't call it. Replace with your real MCP HTTP server endpoint
before running against a real provider key.
