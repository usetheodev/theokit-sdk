# Stream events

`run.stream()` is an `AsyncGenerator<SDKMessage, void>`. Each `SDKMessage` is a discriminated union — switch on `event.type` to handle each kind.

## The `SDKMessage` union

```typescript
type SDKMessage =
  | SDKSystemMessage      // type: "system"
  | SDKUserMessageEvent   // type: "user"
  | SDKAssistantMessage   // type: "assistant"
  | SDKThinkingMessage    // type: "thinking"
  | SDKToolUseMessage     // type: "tool_call"
  | SDKStatusMessage      // type: "status"
  | SDKTaskMessage        // type: "task"
  | SDKRequestMessage;    // type: "request"
```

All events include `agent_id` and `run_id`. Discriminate on `type`.

| `type` | Description | Key fields |
| --- | --- | --- |
| `"system"` | Init metadata. Emitted once at the start. | `subtype?`, `model?`, `tools?` |
| `"user"` | Echo of the user prompt for this run. | `message.content: TextBlock[]` |
| `"assistant"` | Model text output. | `message.content: (TextBlock \| ToolUseBlock)[]` |
| `"thinking"` | Reasoning content. | `text`, `thinking_duration_ms?` |
| `"tool_call"` | Tool lifecycle. Emitted twice: at start with `args`, then on completion with `result`. | `call_id`, `name`, `status`, `args?`, `result?` |
| `"status"` | Cloud run lifecycle transitions. | `status`, `message?` |
| `"task"` | Task-level milestones and summaries. | `status?`, `text?` |
| `"request"` | Awaiting user input or approval. | `request_id` |

## Consuming the stream

```typescript
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

Result data (final text, model used, duration, git metadata) lives on the `Run` object after the stream completes. Use `run.wait()` to read it.

## Tool call stability

> **Important.** The `args` and `result` payloads on `tool_call` events reflect each tool's internal shape and can change as tools evolve. Tool names can also be renamed or replaced. Treat `args` and `result` as `unknown` and parse defensively.
>
> The event envelope (`type`, `call_id`, `name`, `status`) is stable.

## Cloud lifecycle status

`SDKStatusMessage.status` covers cloud-side transitions:

| Status | Meaning |
| --- | --- |
| `"CREATING"` | VM provisioning and repo cloning |
| `"RUNNING"` | Agent doing work |
| `"FINISHED"` | Terminal — completed |
| `"ERROR"` | Terminal — errored |
| `"CANCELLED"` | Terminal — user cancelled |
| `"EXPIRED"` | Terminal — exceeded limits |

## Raw deltas — `InteractionUpdate`

For finer-grained updates (per-token text, tool-call args streaming in, thinking deltas), pass `onDelta` and `onStep` callbacks to `agent.send()`:

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

The callbacks are awaited before the next update is processed, so you can apply backpressure.

`InteractionUpdate` includes: `text-delta`, `thinking-delta`, `thinking-completed`, `tool-call-started`, `tool-call-completed`, `partial-tool-call`, `token-delta`, `step-started`, `step-completed`, `turn-ended`, `user-message-appended`, `summary`, `summary-started`, `summary-completed`, `shell-output-delta`.

## Structured conversation view

After (or alongside) streaming, you can read the conversation as turns:

```typescript
const turns = await run.conversation();
```

`ConversationTurn` is a discriminated union of `agentConversationTurn` (user message + assistant/tool/thinking steps) and `shellConversationTurn` (shell command + output).

Useful for rendering UI or persisting history without keeping the stream open.

## Next

- [Error handling](../guides/error-handling.md) — what can go wrong during a stream
- [Resource management](../guides/resource-management.md) — disposing agents cleanly
