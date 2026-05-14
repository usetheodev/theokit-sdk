# Stream events reference

Full taxonomy of every event emitted by `run.stream()` and every update emitted via `onDelta` / `onStep`.

For the consumption pattern, see [Concepts: Stream events](../concepts/stream-events.md). This page is the exhaustive shape reference.

## `SDKMessage` (from `run.stream()`)

```typescript
type SDKMessage =
  | SDKSystemMessage
  | SDKUserMessageEvent
  | SDKAssistantMessage
  | SDKThinkingMessage
  | SDKToolUseMessage
  | SDKStatusMessage
  | SDKTaskMessage
  | SDKRequestMessage;
```

All variants carry `agent_id: string` and `run_id: string`.

### `SDKSystemMessage`

```typescript
interface SDKSystemMessage {
  type: "system";
  subtype?: "init";
  agent_id: string;
  run_id: string;
  model?: ModelSelection;
  tools?: string[];
}
```

### `SDKUserMessageEvent`

```typescript
interface SDKUserMessageEvent {
  type: "user";
  agent_id: string;
  run_id: string;
  message: { role: "user"; content: TextBlock[] };
}
```

### `SDKAssistantMessage`

```typescript
interface SDKAssistantMessage {
  type: "assistant";
  agent_id: string;
  run_id: string;
  message: {
    role: "assistant";
    content: Array<TextBlock | ToolUseBlock>;
  };
}
```

### `SDKThinkingMessage`

```typescript
interface SDKThinkingMessage {
  type: "thinking";
  agent_id: string;
  run_id: string;
  text: string;
  thinking_duration_ms?: number;
}
```

### `SDKToolUseMessage`

```typescript
interface SDKToolUseMessage {
  type: "tool_call";
  agent_id: string;
  run_id: string;
  call_id: string;
  name: string;
  status: "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
  truncated?: { args?: boolean; result?: boolean };
}
```

Emitted twice for most tool calls: first with `status: "running"` and `args`, then again on completion with `status: "completed"` (or `"error"`) and `result`.

> The `args` and `result` shapes are NOT part of the stable schema. Tool names and payloads can change as tools evolve. Only the envelope (`type`, `call_id`, `name`, `status`) is stable.

### `SDKStatusMessage`

```typescript
interface SDKStatusMessage {
  type: "status";
  agent_id: string;
  run_id: string;
  status: "CREATING" | "RUNNING" | "FINISHED" | "ERROR" | "CANCELLED" | "EXPIRED";
  message?: string;
}
```

Cloud lifecycle transitions. `CREATING` = VM provisioning and repo cloning. `RUNNING` = agent doing work. The rest are terminal.

### `SDKTaskMessage` and `SDKRequestMessage`

```typescript
interface SDKTaskMessage {
  type: "task";
  agent_id: string;
  run_id: string;
  status?: string;
  text?: string;
}

interface SDKRequestMessage {
  type: "request";
  agent_id: string;
  run_id: string;
  request_id: string;
}
```

`SDKRequestMessage` signals the agent is awaiting user input or approval.

### Content blocks

```typescript
interface TextBlock {
  type: "text";
  text: string;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;   // same stability caveat as tool_call args
}
```

## `InteractionUpdate` (from `onDelta` callback)

```typescript
type InteractionUpdate =
  | TextDeltaUpdate
  | ThinkingDeltaUpdate
  | ThinkingCompletedUpdate
  | ToolCallStartedUpdate
  | ToolCallCompletedUpdate
  | PartialToolCallUpdate
  | TokenDeltaUpdate
  | StepStartedUpdate
  | StepCompletedUpdate
  | TurnEndedUpdate
  | UserMessageAppendedUpdate
  | SummaryUpdate
  | SummaryStartedUpdate
  | SummaryCompletedUpdate
  | ShellOutputDeltaUpdate;
```

| Update | When |
| --- | --- |
| `text-delta` | Per-token model output |
| `thinking-delta` | Per-token reasoning |
| `thinking-completed` | Reasoning block finished — carries `thinkingDurationMs` |
| `tool-call-started` | Tool args committed |
| `partial-tool-call` | Tool args streaming in incrementally |
| `tool-call-completed` | Tool result arrived |
| `token-delta` | Usage delta (input/output token count) |
| `step-started` / `step-completed` | Conversation step boundaries |
| `turn-ended` | Carries final `usage` summary |
| `user-message-appended` | New user message in the conversation |
| `summary` / `summary-started` / `summary-completed` | Summary lifecycle |
| `shell-output-delta` | Shell command stdout/stderr incrementally |

See [`docs.md`](../../docs.md) for the precise field shape of each variant.

## `ConversationTurn` (from `run.conversation()` and `onStep`)

```typescript
type ConversationTurn =
  | { type: "agentConversationTurn"; turn: AgentConversationTurn }
  | { type: "shellConversationTurn"; turn: ShellConversationTurn };

interface AgentConversationTurn {
  userMessage?: UserMessage;
  steps: ConversationStep[];
}

interface ShellConversationTurn {
  shellCommand?: ShellCommand;
  shellOutput?: ShellOutput;
}

type ConversationStep =
  | { type: "assistantMessage"; message: AssistantMessage }
  | { type: "toolCall"; message: ToolCall }
  | { type: "thinkingMessage"; message: ThinkingMessage };
```

Use this for rendering history or persisting structured transcripts. No live subscription required.

## Next

- [Concepts: Stream events](../concepts/stream-events.md) — consumption patterns
- [Error handling](../guides/error-handling.md) — errors that surface during streaming
