# Context Manager

The context manager selects project context before a run starts. Use it for working-set material such as README files, architecture notes, design docs, generated summaries, and other task context. Do not use it for durable user preferences; use memory for that.

## File-Based Context

Local agents read `.theokit/context.json` from the workspace when `local.settingSources` includes `"project"`. Cloud agents read the committed file from the cloned repo.

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd(), settingSources: ["project"] },
  context: {
    manager: "file",
    maxTokens: 1200,
  },
});

const snapshot = await agent.context.snapshot();
```

Example `.theokit/context.json`:

```json
{
  "sources": [
    { "name": "project-readme", "path": "README.md" },
    { "name": "architecture-note", "path": "docs/architecture.md" }
  ],
  "exclude": ["**/.env", "**/secrets/**"],
  "maxTokens": 1200
}
```

## Public Snapshot

`agent.context.snapshot()` returns the public diagnostic view of selected context. It reports source names, paths, status, and token budget. It must not include raw secrets, local absolute paths, or token values.

```typescript
interface SDKContextManager {
  snapshot(): Promise<{
    runtime: "local" | "cloud";
    sources: Array<{ name: string; path?: string; status: "included" | "excluded" | "summarized" }>;
    budget?: { maxTokens?: number; usedTokens?: number };
  }>;
}
```

## Reloading

Call `agent.reload()` after editing `.theokit/context.json` or referenced files. Reload preserves conversation state and re-reads context, skills, hooks, project MCP, and subagents.

Invalid context config fails with `ConfigurationError`; it is never silently ignored.
