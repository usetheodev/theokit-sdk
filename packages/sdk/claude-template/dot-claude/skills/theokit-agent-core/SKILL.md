---
user-invocable: false
description: Agent lifecycle, sending messages, streaming, and disposal patterns for @theokit/sdk.
paths:
  - "**/*agent*"
  - "**/*Agent*"
  - "**/sdk.*"
---

# TheoKit SDK -- Agent Core

Quick reference for Agent lifecycle, Run streaming, and disposal.

## Agent.create

```typescript
import { Agent } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
});
```

Returns an `SDKAgent`. Local agents get `agent-<uuid>` IDs; cloud agents get `bc-<uuid>`.

### AgentOptions (key fields)

| Property | Type | Notes |
|---|---|---|
| `model` | `ModelSelection` | Required for local; `{ id, params? }`. |
| `apiKey` | `string` | Falls back to `THEOKIT_API_KEY` env. |
| `local` | `{ cwd, settingSources?, sandboxOptions? }` | Local runtime config. |
| `cloud` | `CloudOptions` | Cloud runtime config (repos, autoCreatePR, envVars). |
| `systemPrompt` | `string \| (ctx: SystemPromptContext) => string` | Static string or async resolver. |
| `mcpServers` | `Record<string, McpServerConfig>` | Inline MCP server definitions. |
| `agents` | `Record<string, AgentDefinition>` | Subagent definitions. |
| `tools` | `CustomTool[]` | Inline custom tools (local only). |
| `memory` | `MemoryOptions` | Durable memory config. |
| `handoffs` | `Array<SDKAgent \| Handoff>` | Peer-to-peer agent handoffs. |
| `local.sessionDir` | `string` | Where session transcripts are written. Default `~/.theokit`; `~/.claude` for Claude Code `--continue` interop. |
| `local.sessionStore` | `SessionStore` | Inject an external store (Postgres / Redis / KV) as the primary session store and resume source, for ephemeral or multi-host filesystems. |

## Agent.prompt (one-shot)

```typescript
const result = await Agent.prompt("What does the auth middleware do?", {
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
});
// result: { id, status, result?, model?, durationMs?, git? }
```

Pass `throwOnError: true` to reject with `AgentRunError` instead of resolving with `status: 'error'`.

## agent.send and Run

```typescript
const run = await agent.send("Find the bug in src/auth.ts");
```

### Run interface

| Member | Type | Description |
|---|---|---|
| `id` | `string` | Run identifier. |
| `status` | `RunStatus` | `"running" \| "finished" \| "error" \| "cancelled"` |
| `stream()` | `AsyncGenerator<SDKMessage>` | Normalized event stream. |
| `wait()` | `Promise<RunResult>` | Block until finished. |
| `cancel()` | `Promise<void>` | Cancel the run. |
| `conversation()` | `Promise<ConversationTurn[]>` | Structured turn history. |
| `onDidChangeStatus(fn)` | `() => void` | Status change listener; returns unsubscribe. |

### Streaming SDKMessage types

```typescript
for await (const event of run.stream()) {
  switch (event.type) {
    case "assistant": /* event.message.content: (TextBlock | ToolUseBlock)[] */ break;
    case "thinking":  /* event.text, event.thinking_duration_ms? */ break;
    case "tool_call": /* event.name, event.status, event.args?, event.result? */ break;
    case "status":    /* event.status: cloud lifecycle transitions */ break;
    case "task":      /* event.text: task milestones */ break;
    case "request":   /* event.request_id: awaiting user input */ break;
  }
}
```

### Per-send options

```typescript
await agent.send("Plan the refactor", {
  model: { id: "claude-sonnet-4-6", params: [{ id: "thinking", value: "high" }] },
  systemPrompt: "Focus on performance.",
  signal: abortController.signal,
  onDelta: ({ update }) => { /* InteractionUpdate */ },
  onStep: ({ step }) => { /* ConversationStep */ },
});
```

## Agent.resume

```typescript
const agent = await Agent.resume("bc-abc123", {
  apiKey: process.env.THEOKIT_API_KEY!,
});
```

Runtime auto-detected from ID prefix. Inline `mcpServers` and `tools` are NOT persisted -- re-pass on resume.

## Agent.getOrCreate

```typescript
const agent = await Agent.getOrCreate(`tg-user-${userId}`, {
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "claude-sonnet-4-6" },
  local: { cwd: process.cwd() },
});
```

Tries resume first; on `UnknownAgentError` falls through to create.

## Agent.get / Agent.list / Agent.listRuns

```typescript
const info = await Agent.get(agentId);
const { items, nextCursor } = await Agent.list({ runtime: "local", cwd: process.cwd() });
const { items: runs } = await Agent.listRuns(agentId);
```

## AgentFactory.create

```typescript
import { AgentFactory } from "@theokit/sdk";

const factory = AgentFactory.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "claude-sonnet-4-6" },
  local: { cwd: process.cwd() },
  systemPrompt: "You are a helpful assistant.",
});
const agent = await factory.getOrCreate(`user-${userId}`);
```

## Agent.builder (fluent API)

```typescript
const agent = await Agent.builder()
  .apiKey(process.env.THEOKIT_API_KEY!)
  .model({ id: "claude-sonnet-4-6" })
  .local({ cwd: process.cwd() })
  .tools([myTool])
  .getOrCreate(`user-${userId}`);
```

## Agent.generateObject / Agent.streamObject

```typescript
import { z } from "zod";

const { object } = await Agent.generateObject({
  schema: z.object({ title: z.string(), year: z.number().nullable() }),
  prompt: "Fact card about jazz.",
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
});

for await (const evt of Agent.streamObject({ schema, prompt, model, local })) {
  if (evt.type === "partial") render(evt.partial);
  if (evt.type === "complete") finalize(evt.object);
}
```

## Disposal patterns

```typescript
// Preferred: await using (auto-dispose on block exit)
await using agent = await Agent.create({ /* ... */ });

// Explicit dispose
await agent[Symbol.asyncDispose]();

// Fire-and-forget close
agent.close();

// Reload config without disposing
await agent.reload();
```

## Agent.registry (production)

```typescript
Agent.registry.configure({ maxAgents: 1000, idleTimeoutMs: 15 * 60 * 1000 });
Agent.registry.size();
Agent.registry.evict("agent-42");
await Agent.registry.evictAll(); // graceful shutdown
```

## Cancellation

```typescript
const run = await agent.send(message, { signal: request.signal });
// On abort: AgentRunError with code "aborted"

// Compose with timeout:
const composed = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
await agent.send(message, { signal: composed });
```
