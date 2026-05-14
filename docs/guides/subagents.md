# Subagents

Named subagents are spawned by the parent agent via its `Agent` tool. Useful for splitting concerns ("the parent plans, the subagent reviews", "writer + tester", etc.).

## Inline definitions

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "composer-2" },
  local: { cwd: process.cwd() },
  agents: {
    "code-reviewer": {
      description: "Expert code reviewer for quality and security.",
      prompt: "Review code for bugs, security issues, and proven approaches.",
      model: "inherit",
    },
    "test-writer": {
      description: "Writes tests for code changes.",
      prompt: "Write comprehensive tests for the given code.",
    },
  },
});
```

| Field | Purpose |
| --- | --- |
| `description` | Shown to the parent agent so it knows when to spawn this subagent. Required. |
| `prompt` | System prompt for the subagent. Required. |
| `model` | Override the parent's model selection. Pass `"inherit"` to use whatever the parent is using. Defaults to `"inherit"`. |
| `mcpServers` | MCP servers available to the subagent. Names reference servers from the parent's `mcpServers`. |

## File-based definitions

Subagents committed to the repo at `.theokit/agents/*.md` are picked up automatically when `local.settingSources` includes `"project"`. Format:

```markdown
---
name: code-reviewer
description: Expert code reviewer for quality and security.
model: inherit
---

Review code for bugs, security issues, and proven approaches.
```

The body of the markdown file is the prompt. Frontmatter carries `name`, `description`, and optional `model`.

## Precedence

Inline definitions in `Agent.create()` override file-based ones with the same name.

## MCP scoping

A subagent can subscribe to a subset of the parent's MCP servers by listing names in `mcpServers`:

```typescript
agents: {
  "doc-writer": {
    description: "Writes documentation from code.",
    prompt: "Read code, write docs in our style.",
    mcpServers: ["docs"],            // only the "docs" MCP server
  },
}
```

This keeps the subagent's tool surface narrow and intentional.

## Next

- [MCP servers](./mcp-servers.md) — defining the servers subagents reference
- [Hooks](./hooks.md) — file-based policy that also applies to subagents
