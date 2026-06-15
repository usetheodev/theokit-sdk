---
user-invocable: false
paths:
  - "**/.theokit/**"
  - "**/config.*"
  - "**/theo.config.*"
description: TheoKit SDK configuration reference — .theokit/ structure, mcp.json, hooks, env vars, config discovery
---

# TheoKit Configuration

## Directory structure

```
.theokit/
+-- hooks/                          # one .md per hook
|   +-- shell-policy.md
+-- context/                        # one .md per context source
|   +-- bot-readme.md
+-- skills/<name>/SKILL.md          # named capability packs
+-- plugins/<name>/PLUGIN.md        # plugin definitions
+-- cron/
|   +-- jobs.json                   # local cron state (auto-created)
+-- agents/*.md                     # subagent definitions (name + description frontmatter)
+-- memory/                         # local memory storage
```

User-level config lives at `~/.theokit/` with the same structure.

## Config file format (v1.5+)

Markdown + YAML frontmatter. One file per entity.

### Hook example

```markdown
---
event: preToolUse
matcher: ^shell$
command: node .theokit/policy.js
---

# Shell tool policy gate

Vets shell tool invocations before spawn.
```

### Disabling an entry

Rename `<name>.md` to `<name>.md.disabled` — the loader silently skips it.

## Setting sources

`local.settingSources` controls which config layers a local agent loads:

| Value | Source |
|---|---|
| `"project"` | `.theokit/` in the workspace |
| `"user"` | `~/.theokit/` |
| `"team"` | Team settings synced from the dashboard |
| `"mdm"` | MDM-managed enterprise settings |
| `"plugins"` | Plugin-provided settings |
| `"all"` | All of the above |

Cloud agents always load project / team / plugins and ignore this field.

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd(), settingSources: ["project", "user"] },
});
```

## Environment variables

| Env var | Purpose |
|---|---|
| `THEOKIT_API_KEY` | Default API key (user or service account) |
| `THEOKIT_REDACT_SECRETS` | Set `false` to disable secret redaction (default: `true`) |
| `OLLAMA_HOST` | Ollama server URL (default: `http://localhost:11434`) |
| `OLLAMA_API_KEY` | Bearer token for Ollama Cloud or proxy |
| `OPENROUTER_API_KEY` | OpenRouter provider key |
| `ANTHROPIC_API_KEY` | Anthropic provider key |
| `OPENAI_API_KEY` | OpenAI provider key |

## MCP server discovery

Servers are loaded with first-match-wins precedence:

1. `mcpServers` on `agent.send()` — fully replaces creation-time servers
2. `mcpServers` on `Agent.create()` — used when no per-send override
3. Plugin servers (if settingSources includes `"plugins"`)
4. Project servers from `.theokit/mcp.json` (if settingSources includes `"project"`)
5. User servers from `~/.theokit/mcp.json` (if settingSources includes `"user"`)

## Context manager config

```typescript
const agent = await Agent.create({
  context: {
    manager: "file",     // reads .theokit/context/<name>.md
    maxTokens: 1200,
  },
  local: { cwd: process.cwd(), settingSources: ["project"] },
});
```

`manager: "inline"` uses `sources` passed directly in `Agent.create()`.

## Skills config

```typescript
const agent = await Agent.create({
  skills: {
    enabled: ["code-review", "test-architect"],
  },
  local: { cwd: process.cwd(), settingSources: ["project"] },
});
```

Skills live at `.theokit/skills/<name>/SKILL.md` with strict YAML frontmatter
(`name`, `description` required).

## Migration from legacy JSON

```bash
npx theokit-migrate-config --apply
```

Dry-run by default; `--apply` writes. Backs up originals to
`<file>.json.<unix-ts>.bak`. Legacy JSON still works in v1.x with a
deprecation warning. JSON support removed in v2.0.

## `agent.reload()`

Re-reads filesystem config (context, skills, hooks, project MCP, subagents)
without disposing the agent or losing conversation state. Invalid files
raise `ConfigurationError`.
