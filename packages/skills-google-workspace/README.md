# @usetheo/skills-google-workspace

Google Workspace skill bundle for `@usetheo/sdk` — Calendar, Drive, Sheets, Docs, Gmail, Slides, and Forms via the community-maintained `google-workspace-mcp` server.

> **NÃO reinventa MCP.** This package is a thin Node factory that emits a single `McpServerConfig` running `npx google-workspace-mcp serve [--read-only] [--account <name>]`. All 95+ tools, OAuth flow, multi-account support, and credential storage come from the upstream server. Our value-add: SDK-branded ergonomics, secure defaults, a CLI wrapper (`theokit setup gworkspace`) that pre-validates credentials, and a cookbook of six recipes.

## Quick start

```bash
pnpm add @usetheo/skills-google-workspace
npx theokit setup gworkspace          # walkthrough — pre-validates OAuth client + delegates to upstream
```

```ts
import { Agent } from "@usetheo/sdk";
import { googleWorkspace } from "@usetheo/skills-google-workspace";

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: { id: "openai/gpt-4o-mini" },
  mcpServers: googleWorkspace(),     // read-only by default
});

const run = await agent.send("What's on my calendar in the next 24 hours?");
console.log((await run.wait()).result);
await agent.dispose();
```

## Scopes & defaults

- **`googleWorkspace()`** — read-only mode. Server runs with `--read-only`; write tools return errors.
- **`googleWorkspace({ writable: true })`** — write mode. Drive write, Gmail send, Calendar create, Sheets update, etc. are exposed.
- **`googleWorkspace({ account: "work" })`** — pick a named account previously registered via `theokit setup gworkspace`.

The underlying OAuth consent screen requests broad scopes (Drive, Gmail.modify, Calendar, Spreadsheets, etc.). The `--read-only` flag enforces safety at runtime by blocking write tools.

## Configuration reference

See `src/types.ts` for the full `GoogleWorkspaceOptions` shape. Defaults:

| Option | Default | Notes |
|---|---|---|
| `account` | `"default"` | Forwarded as `--account` to upstream server. |
| `writable` | `false` | When `true`, drops `--read-only`. |
| `npmPackage` | `"google-workspace-mcp@^2.3.0"` | Specifier passed to `npx`. |
| `configDir` | upstream default (`~/.google-mcp`) | Forwarded as `GOOGLE_MCP_CONFIG_PATH` env. |

## Troubleshooting

(Filled in during Phase 5 dogfood.)

## See also

- ADRs `D340-D348` (`.claude/knowledge-base/adrs/`)
- Plan `.claude/knowledge-base/plans/skills-google-workspace-plan.md` v1.2
- Upstream server: <https://github.com/pm990320/google-workspace-mcp>
