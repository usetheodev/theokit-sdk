---
user-invocable: false
paths:
  - "**/*stream*"
  - "**/*Stream*"
  - "**/*SDKMessage*"
description: TheoKit SDK streaming reference — Run.stream(), SDKMessage union, streamObject, generateObject
---

# TheoKit Streaming

## `Run.stream()` — SDKMessage events

```typescript
const run = await agent.send("Find the bug in src/auth.ts");
for await (const event of run.stream()) {
  switch (event.type) {
    case "assistant":
      for (const block of event.message.content) {
        if (block.type === "text") process.stdout.write(block.text);
      }
      break;
    case "thinking":
      process.stdout.write(event.text);
      break;
    case "tool_call":
      console.log(`[tool] ${event.name}: ${event.status}`);
      break;
    case "status":
      console.log(`[status] ${event.status}`);
      break;
  }
}
```

## SDKMessage discriminated union

```typescript
type SDKMessage =
  | SDKSystemMessage        // "system" — init metadata, emitted once
  | SDKUserMessageEvent     // "user"   — echo of user prompt
  | SDKAssistantMessage     // "assistant" — model text output
  | SDKThinkingMessage      // "thinking"  — reasoning content
  | SDKToolUseMessage       // "tool_call" — tool invocation lifecycle
  | SDKStatusMessage        // "status" — cloud run transitions
  | SDKTaskMessage          // "task"   — task milestones/summaries
  | SDKRequestMessage;      // "request" — awaiting user input
```

All events include `agent_id` and `run_id`.

### Key message types

| Type | Key fields |
|---|---|
| `"system"` | `subtype?: "init"`, `model?`, `tools?` |
| `"assistant"` | `message.content: (TextBlock \| ToolUseBlock)[]` |
| `"thinking"` | `text`, `thinking_duration_ms?` |
| `"tool_call"` | `call_id`, `name`, `status`, `args?`, `result?`, `truncated?` |
| `"status"` | `status: "CREATING" \| "RUNNING" \| "FINISHED" \| ...` |

`tool_call` is emitted twice: once with `status: "running"` + `args`, then
again on completion with `status: "completed"` or `"error"` + `result`.

## Raw deltas — `onDelta` callback

For per-token streaming, pass `onDelta` to `agent.send()`:

```typescript
const run = await agent.send("Refactor the utils module", {
  onDelta: ({ update }) => {
    if (update.type === "text-delta") process.stdout.write(update.text);
    if (update.type === "thinking-delta") process.stdout.write(update.text);
  },
  onStep: ({ step }) => {
    console.log(`[step] ${step.type}`);
  },
});
```

### InteractionUpdate types

`text-delta`, `thinking-delta`, `thinking-completed`, `tool-call-started`,
`tool-call-completed`, `partial-tool-call`, `token-delta`, `step-started`,
`step-completed`, `turn-ended`, `summary`, `shell-output-delta`.

`turn-ended` includes token usage:
```typescript
{ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
```

## `Agent.generateObject()` — structured output

```typescript
import { z } from "zod";
import { Agent } from "@theokit/sdk";

const { object, raw, usage, finishReason } = await Agent.generateObject({
  schema: z.object({
    title: z.string().min(1),
    summary: z.string(),
    year: z.number().nullable(),
  }),
  prompt: "Produce a fact card about: Brazilian samba.",
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
  apiKey: process.env.THEOKIT_API_KEY,
  maxRetries: 1,
});
// object is fully typed: z.infer<typeof schema>
```

Throws `GenerateObjectError` with `code: "no_tool_call" | "parse_failed"`.

## `Agent.streamObject()` — streaming structured output (v1.2+)

```typescript
for await (const evt of Agent.streamObject({
  schema: FactCard,
  prompt: "Produce a fact card about: jazz music.",
  model: { id: "google/gemini-2.0-flash-001" },
  apiKey: process.env.THEOKIT_API_KEY,
  local: { cwd: process.cwd() },
})) {
  if (evt.type === "partial") render(evt.partial);
  if (evt.type === "complete") finalize(evt.object);
}
```

### StreamObjectEvent

```typescript
type StreamObjectEvent<T> =
  | { type: "partial"; partial: DeepPartial<T>; attempt: number }
  | { type: "complete"; object: T; raw: unknown; usage; finishReason };
```

The `complete` event always fires (or the iterator throws `StreamObjectError`).
Partials are best-effort.

## Waiting without streaming

```typescript
const result = await run.wait();
console.log(result.status);     // "finished" | "error" | "cancelled"
console.log(result.result);     // final assistant text
console.log(result.durationMs);
console.log(result.git);        // cloud: { branches: [{ repoUrl, branch?, prUrl? }] }
```

## Cancelling

```typescript
await run.cancel();
// status moves to "cancelled", partial output preserved
```
