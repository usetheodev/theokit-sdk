# @theokit/sdk — TypeScript SDK for AI Agents

Build AI agents that run locally or in the cloud. Same code, same API, pick your runtime. The exported types are the canonical contract.

## Setup

```bash
npm install @theokit/sdk
```

Set your API key:
```bash
export THEOKIT_API_KEY="your-key"
```

Node 22.12+ required.

## Import Map (verified subpaths)

```typescript
import { Agent, Cron, Tool } from "@theokit/sdk";              // core: Agent, Run, Cron, Tool, SDKMessage
import { TheokitAgentError } from "@theokit/sdk/errors";       // error hierarchy
import { Workflow } from "@theokit/sdk/workflow";              // multi-step workflows
import { Eval } from "@theokit/sdk/eval";                      // evaluation suite
import { Subscription } from "@theokit/sdk/subscription";      // SSE / WebSocket subscriptions
import { SubAgent } from "@theokit/sdk/a2a";                   // agent-to-agent delegation
import { Auth } from "@theokit/sdk/server/auth";              // authentication
import { TaskStore } from "@theokit/sdk/task-store";           // task persistence
```

Other public subpaths: `/messages`, `/models`, `/skills`, `/project`, `/subagents`, `/sandbox`, `/client`, `/persistence`, `/retry`, `/concurrency`, `/sanitize`. There is **no** `@theokit/sdk/rag` subpath. Never import from `@theokit/sdk/internal/*` or `@theokit/sdk/dist/*`.

That list is a shortcut, not the whole surface — `./cron`, `./compaction`, `./context`, `./providers`, `./auth`, `./mcp-auth`, `./filesystem`, `./interactive`, `./path-safety`, `./subagents-loader` and `./server/errors-envelope` are public too. Two generated references ship inside the installed package and are the authority when this file and the package disagree:

```
node_modules/@theokit/sdk/docs/harness-capability-map.md   # every public symbol + the exact specifier to import it from
node_modules/@theokit/sdk/docs/error-codes.md              # every `code` an error can carry, and where it is raised
```

Read the capability map before guessing an import: a symbol reachable from two specifiers is listed under both, and when a class is emitted separately into a subpath entry it is a distinct nominal type from the one in the root bundle — passing one where the other is expected fails on a private field. When a symbol appears twice, import it and everything it is passed to from the SAME specifier.

Branch on `err.code`, never on the message: messages carry an id, a path or a limit and change with them, while the code is the contract.

## Quick Start

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
});

const run = await agent.send("Summarize this repository");
for await (const event of run.stream()) {
  if (event.type === "assistant") {
    for (const block of event.message.content) {
      if (block.type === "text") process.stdout.write(block.text);
    }
  }
}

await agent[Symbol.asyncDispose](); // or: await using agent = await Agent.create(...)
```

## Core Patterns

### Agent lifecycle
- `Agent.create(options)` — create an agent (local or cloud); returns immediately, `agent.agentId` is `agent-<uuid>` (local) or `bc-<uuid>` (cloud).
- `agent.send(prompt)` — send a message, get a `Run` (context is retained across sends).
- `run.stream()` — `AsyncGenerator` of `SDKMessage` events.
- `run.wait()` — resolve to `{ status, result, model, durationMs, git? }` after the run ends.
- `Agent.prompt(prompt, options)` — one-shot (create + send + dispose). **Prompt is the first argument.**
- `Agent.resume(agentId, { apiKey })` — reattach; runtime auto-detected from the ID prefix.
- Dispose with `await using`, `await agent[Symbol.asyncDispose]()`, or `agent.close()` (fire-and-forget).

### Tool definition — `Tool.create` with a Zod schema
```typescript
import { z } from "zod";
import { Tool } from "@theokit/sdk";

const searchTool = Tool.create({
  name: "search",
  description: "Search the web",
  inputSchema: z.object({ query: z.string() }),
  handler: async ({ query }) => JSON.stringify({ results: await search(query) }),
});
```

The tool spec field is `handler` (returns a string, or a typed value when you set `outputSchema`). Built-in coding tools (`createReadFileTool`, …) live in the separate `@theokit/sdk-tools` package, not a `@theokit/sdk/tools` subpath.

`Tool.create` is the canonical factory (uniform `X.create()` API since v3.0). Every public factory follows it: `Provider.create`, `Plugin.create`, `Subscription.create`, `Auth.create`, `SubAgent.create`, `Squad.create`, `Retry.create`. There is **no** `defineTool` / `define*` export — those were removed at v3.0.

### Streaming events (`SDKMessage`)
Discriminate on `type`. All events carry `agent_id` and `run_id`.
- `{ type: "system" }` — init metadata, once at start (`model?`, `tools?`)
- `{ type: "user", message: { content } }` — echo of the prompt
- `{ type: "assistant", message: { content } }` — model output; `content` is a `(TextBlock | ToolUseBlock)[]`
- `{ type: "thinking", text }` — reasoning content
- `{ type: "tool_call", call_id, name, status, args?, result? }` — tool lifecycle
- `{ type: "status", status }` — cloud run lifecycle
- `{ type: "task" }` / `{ type: "request", request_id }` — task milestones / awaiting input

There is no `tool_use` / `tool_result` / `usage` / `error` event. Read assistant text from `event.message.content` (a block array), not `event.content`. Treat `tool_call` `args`/`result` as `unknown`.

### Error handling
```typescript
import { TheokitAgentError } from "@theokit/sdk/errors";

try {
  await agent.send("...");
} catch (e) {
  if (e instanceof TheokitAgentError) console.error(e.code, e.isRetryable, e.message);
}
```
Subclasses: `AuthenticationError`, `RateLimitError`, `ConfigurationError`, `IntegrationNotConnectedError`, `NetworkError`, `UnknownAgentError`, `UnsupportedRunOperationError`.

### Optional: DI decorators (`@theokit/di` + `@theokit/di-agent`)
Decorators are an **optional** convenience layer in separate packages — the factory API above is canonical and never requires them.
```typescript
import { Injectable } from "@theokit/di";
import { Tool as ToolDecorator, Cron as CronDecorator } from "@theokit/di-agent";

@Injectable()
class MyService {
  @ToolDecorator({ name: "search", description: "Search" })
  searchTool!: unknown;

  @CronDecorator({ schedule: "*/5 * * * *" })
  cleanup() { /* runs every 5 min */ }
}
```

### Optional: Gateways
```typescript
import { defineGateway } from "@theokit/gateway-telegram"; // or -slack, -discord, etc.
const gateway = defineGateway({ token: process.env.BOT_TOKEN });
```

## Anti-patterns

- NEVER `new Agent()` — always `await Agent.create()`.
- NEVER author `defineTool` / `defineSubscription` / `defineAuth` / `defineSubAgent` — use `Tool.create` / `Subscription.create` / `Auth.create` / `SubAgent.create`.
- NEVER switch on `tool_use` / `tool_result` / `usage` / `error` stream events — they don't exist; use `tool_call` / `assistant` / `thinking` / `status`.
- NEVER read assistant text as `event.content` — it's `event.message.content`.
- NEVER import from `@theokit/sdk/internal/*`, `@theokit/sdk/dist/*`, or `@theokit/sdk/rag` (no such subpath).
- NEVER forget disposal (`await using` / `Symbol.asyncDispose` / `close()`) — it leaks the runtime.
- NEVER use `any` for tool input schemas — use Zod schemas.

## Packages

| Package | Purpose |
|---------|---------|
| `@theokit/sdk` | Core SDK (Agent, Run, Tool, Cron, streaming, memory, workflows, eval, subscriptions) |
| `@theokit/di` | Dependency injection container (optional) |
| `@theokit/di-agent` | Agentic decorators for DI (optional) |
| `@theokit/gateway-*` | Platform gateways — telegram, slack, discord, etc. (optional) |
| `@theokit/react` | React hooks for agent UIs (optional) |

## Configuration

Project config lives in `.theokit/`:
- `.theokit/mcp.json` — MCP server configuration
- `.theokit/hooks.json` — lifecycle hooks
- `.theokit/agents/*.md` — agent instruction files

Environment variables:
- `THEOKIT_API_KEY` — API key (required)
- `THEOKIT_MODEL_ID` — default model override
