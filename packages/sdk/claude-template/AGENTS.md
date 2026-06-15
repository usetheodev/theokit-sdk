# @theokit/sdk — TypeScript SDK for AI Agents

Build AI agents that run locally or in the cloud. Same code, same API, pick your runtime.

## Setup

```bash
npm install @theokit/sdk
```

Set your API key:
```bash
export THEOKIT_API_KEY="your-key"
```

## Import Map

```typescript
import { Agent } from "@theokit/sdk";                         // Core: Agent, Run, SDKMessage
import { defineTool } from "@theokit/sdk";                     // Tool definitions
import { TheokitAgentError } from "@theokit/sdk/errors";       // Error hierarchy
import { Cron } from "@theokit/sdk/cron";                      // Scheduled jobs
import { Eval } from "@theokit/sdk/eval";                      // Evaluation suite
import { Workflow } from "@theokit/sdk/workflow";               // Multi-step workflows
import { defineSubscription } from "@theokit/sdk/subscription"; // SSE/WebSocket subscriptions
import { VectorRetriever } from "@theokit/sdk/rag";            // RAG: retrievers, rerankers, splitters
import { defineSubAgent } from "@theokit/sdk/a2a";             // Agent-to-agent delegation
import { SandboxBackend } from "@theokit/sdk/sandbox";         // Sandbox backends
import { defineAuth } from "@theokit/sdk/server/auth";         // Authentication
import { TaskStore } from "@theokit/sdk/task-store";           // Task persistence
import { createClient } from "@theokit/sdk/client";            // HTTP client
```

## Quick Start

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
});

const run = await agent.send("Summarize this repository");
for await (const event of run.stream()) {
  if (event.type === "assistant") console.log(event.content);
}

agent.dispose(); // Always clean up
```

## Core Patterns

### Agent lifecycle
- `Agent.create(options)` — create an agent (local or cloud)
- `agent.send(prompt)` — send a message, get a Run
- `run.stream()` — AsyncGenerator of SDKMessage events
- `agent.dispose()` — clean up resources (or use `await using`)
- `Agent.prompt(options, prompt)` — one-shot: create, send, dispose

### Tool definition
```typescript
const searchTool = defineTool({
  name: "search",
  description: "Search the web",
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => ({ results: await search(query) }),
});
```

### Streaming events (SDKMessage)
- `{ type: "assistant", content }` — text from the model
- `{ type: "tool_use", name, input }` — tool call
- `{ type: "tool_result", name, output }` — tool response
- `{ type: "status", status }` — run status change
- `{ type: "error", error }` — error event
- `{ type: "usage", tokens }` — token usage update

### Error handling
```typescript
try {
  await agent.send("...");
} catch (e) {
  if (e instanceof TheokitAgentError) {
    console.error(e.code, e.message); // typed error with code
  }
}
```

### DI decorators (`@theokit/di` + `@theokit/di-agent`)
```typescript
import { Injectable, Container } from "@theokit/di";
import { Tool, Workflow, Cron, InjectAgent } from "@theokit/di-agent";

@Injectable()
class MyService {
  @Tool({ name: "search", description: "Search" })
  searchTool!: ToolOptions;

  @Cron({ schedule: "*/5 * * * *" })
  cleanup() { /* runs every 5 min */ }
}
```

### Gateways
```typescript
import { defineGateway } from "@theokit/gateway-telegram"; // or -slack, -discord, etc.
const gateway = defineGateway({ token: process.env.BOT_TOKEN });
```

Available: telegram, slack, discord, whatsapp, teams, email, sms, mattermost, line, matrix.

## Anti-patterns

- NEVER import from `@theokit/sdk/internal/...` — internal paths are not public API
- NEVER import from `@theokit/sdk/dist/...` — use the exports map above
- NEVER forget `agent.dispose()` — causes resource leaks
- NEVER use `new Agent()` — always use `Agent.create()`
- NEVER use `any` for tool input schemas — use Zod schemas

## Packages

| Package | Purpose |
|---------|---------|
| `@theokit/sdk` | Core SDK (Agent, Run, Tools, Memory, Streaming) |
| `@theokit/di` | Dependency injection container |
| `@theokit/di-agent` | 15 agentic decorators for DI |
| `@theokit/gateway-*` | Platform gateways (Telegram, Slack, etc.) |
| `@theokit/react` | React hooks for agent UIs |

## Configuration

Project config lives in `.theokit/`:
- `.theokit/mcp.json` — MCP server configuration
- `.theokit/hooks.json` — lifecycle hooks
- `.theokit/agents/*.md` — agent instruction files

Environment variables:
- `THEOKIT_API_KEY` — API key (required)
- `THEOKIT_MODEL_ID` — default model override
