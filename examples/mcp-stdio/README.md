# MCP — stdio transport

Agent talking to an MCP (Model Context Protocol) server over stdio. The
server is shipped inline in this example (`src/server.ts`) and runs as
a child process spawned by the SDK.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. The SDK spawns `node --import tsx src/server.ts` as a stdio MCP
   server when the agent initializes.
2. During the agent loop, `tools/list` is sent — the server replies with
   one tool: `time.now`.
3. The model decides to call `mcp_demo-time_time_now` with
   `{ offsetHours: 0 }`. (The `.` in the server-side tool name `time.now`
   becomes `_` after the SDK's name sanitizer — see "Tool naming" below.)
4. The SDK forwards the call over JSON-RPC, the server returns the
   current ISO timestamp, and the result feeds back to the model.
5. The model converts the timestamp to a plain-English answer.

## Expected output

```
Agent: agent-<uuid>
[system] tools: shell, mcp_demo-time_time.now
[tool_call:mcp_demo-time_time_now] → 2026-05-15T15:14:02.001Z

It is currently 2026-05-15T15:14:02.001Z (UTC).

[status=finished duration=2630ms]
```

The MCP server name `demo-time` becomes `mcp_demo-time_time.now` in the
tool list — the SDK prefixes every MCP-provided tool to avoid conflicts
with the built-in `shell` tool.

## Tool naming

The full naming rule is `mcp_<server-name>_<tool-name>`. Hyphens are
preserved; every other non-alphanumeric character (including `.`) is
replaced with `_`. Two examples:

| Server name | Tool name | Surfaced as |
| --- | --- | --- |
| `demo-time` | `time.now` | `mcp_demo-time_time_now` |
| `linear-api` | `create-issue` | `mcp_linear-api_create-issue` |
