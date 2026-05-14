# MCP servers

Agents pick up Model Context Protocol servers from several sources. Inline definitions in `Agent.create()` or `agent.send()` are the most common path; file-based configs are also supported.

## Inline definitions

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "composer-2" },
  local: { cwd: process.cwd() },
  mcpServers: {
    docs: {
      type: "http",
      url: "https://example.com/mcp",
      auth: { CLIENT_ID: "client-id", scopes: ["read", "write"] },
    },
    filesystem: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
    },
  },
});
```

## Source precedence

Local agents load servers from up to five sources, first-match-wins on name conflicts:

1. `mcpServers` on `agent.send()` — fully replaces creation-time servers for that run.
2. `mcpServers` on `Agent.create()` — used when no per-send override is provided.
3. Plugin servers, if `local.settingSources` includes `"plugins"`.
4. Project servers from `.theokit/mcp.json`, if `local.settingSources` includes `"project"`.
5. User servers from `~/.theokit/mcp.json`, if `local.settingSources` includes `"user"`.

Without `local.settingSources`, only inline servers are loaded.

Cloud agents load:

1. `mcpServers` on `agent.send()` — replaces creation-time servers.
2. `mcpServers` on `Agent.create()`.
3. Your user and team MCP servers from Theo's dashboard.

## Authentication patterns

| Field | Best for | Where credentials live |
| --- | --- | --- |
| `headers` | Static API keys, Bearer tokens | Passed through on every request |
| `auth` | OAuth-protected servers (`CLIENT_ID`, `CLIENT_SECRET`, `scopes`) | For cloud: Theo runs the OAuth flow once server-side. For local: SDK reuses tokens already obtained through the Theo app. |
| `env` (stdio only) | Servers that read credentials from environment | Passed into the VM (cloud) or the spawned process (local) |

For HTTP servers running in the cloud, `headers` and `auth` are handled by Theo's backend — sensitive fields are redacted before the VM sees them. Stdio `env` values are passed into the VM because the server runs there.

## Cloud-only fields

The `cwd` field on stdio configs is local-only. Cloud rejects it (the server runs inside the VM with an isolated working directory).

## Per-run overrides

```typescript
const run = await agent.send("Use the linear MCP for this task", {
  mcpServers: {
    linear: {
      type: "http",
      url: "https://mcp.linear.app/sse",
      headers: { Authorization: `Bearer ${process.env.LINEAR_API_KEY!}` },
    },
  },
});
```

Per-send `mcpServers` fully **replaces** the creation-time servers for that run — they are not merged. Pass all the servers you want, including ones inherited from `Agent.create()`.

## OAuth limitation (local)

The SDK cannot prompt for OAuth sign-in locally. OAuth-protected MCP servers only work if you've already authorized them through the Theo desktop app — the SDK then reuses those saved tokens.

For headless local environments (CI, servers), use service account API keys with token-style authentication (e.g., GitHub Personal Access Tokens via stdio `env`).

## Type reference

```typescript
type McpServerConfig =
  | {
      type?: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;                  // local only
    }
  | {
      type?: "http" | "sse";
      url: string;
      headers?: Record<string, string>;
      auth?: {
        CLIENT_ID: string;
        CLIENT_SECRET?: string;
        scopes?: string[];
      };
    };
```

## Next

- [Subagents](./subagents.md) — subagents can reference MCP servers from the parent
- [Hooks](./hooks.md) — file-based policy alongside file-based MCP config
