# Agent and Run

Two primitives drive the SDK:

| Concept | Description |
| --- | --- |
| **Agent** | Durable container that holds conversation state, workspace config, and settings. Survives across multiple prompts. |
| **Run** | One prompt submission. Owns its own stream, status, result, and cancellation. |

## Lifecycle

```
Agent.create() ──▶ SDKAgent ──▶ agent.send("…") ──▶ Run ──▶ run.stream() / run.wait()
                       │                                      │
                       │                                      └──▶ RunResult
                       ▼
                  agent.dispose()
```

- `Agent.create()` validates options and returns an `SDKAgent` handle immediately. Agent IDs are populated synchronously.
  - Local: `agent-<uuid>`
  - Cloud: `bc-<uuid>`
- `agent.send(message)` starts a `Run`. Each run is one prompt + response, but the agent retains conversation context across runs.
- `agent.dispose()` (or `await using` syntax) releases resources.

## The `Agent` façade

`Agent` is a static-only namespace — you never instantiate it. Methods:

| Method | Purpose |
| --- | --- |
| `Agent.create(options)` | Create a new agent |
| `Agent.prompt(msg, options)` | One-shot: create, send, wait, dispose |
| `Agent.resume(agentId)` | Reattach to an existing agent by ID |
| `Agent.list(options?)` | List agents (local or cloud) |
| `Agent.get(agentId)` | Fetch one agent's metadata |
| `Agent.listRuns(agentId)` | List runs for an agent |
| `Agent.getRun(runId)` | Fetch one run |
| `Agent.archive(agentId)` | Soft-delete a cloud agent (transcript preserved) |
| `Agent.unarchive(agentId)` | Restore an archived cloud agent |
| `Agent.delete(agentId)` | Permanently delete |

Runtime is auto-detected from the agent ID prefix where possible (`bc-` → cloud, otherwise local).

## The `SDKAgent` handle

```typescript
interface SDKAgent {
  readonly agentId: string;
  readonly model: ModelSelection | undefined;
  send(message: string | SDKUserMessage, options?: SendOptions): Promise<Run>;
  close(): void;
  reload(): Promise<void>;
  dispose(): Promise<void>;
  listArtifacts(): Promise<SDKArtifact[]>;
  downloadArtifact(path: string): Promise<Buffer>;
}
```

| Member | Notes |
| --- | --- |
| `agentId` | Stable identifier. Persists across resumes. |
| `model` | Current model selection. Updates after every `send({ model })`. `undefined` until set. |
| `send` | Start a new run. Conversation context is retained from prior runs. |
| `close` | Begin disposal without awaiting. Fire-and-forget. |
| `reload` | Re-read filesystem config (hooks, project MCP, subagents) without disposing. |
| `dispose` | Await full disposal. Implementations also expose `[Symbol.asyncDispose]` for `await using`. |
| `listArtifacts` | Files produced by the agent. Cloud-only; local returns `[]`. |
| `downloadArtifact` | Cloud-only. Local throws `UnsupportedRunOperationError`. |

## The `Run` interface

```typescript
type RunStatus = "running" | "finished" | "error" | "cancelled";

interface Run {
  readonly id: string;
  readonly agentId: string;
  readonly status: RunStatus;
  readonly result?: string;
  readonly model?: ModelSelection;
  readonly durationMs?: number;
  readonly git?: RunGitInfo;
  readonly createdAt?: number;
  stream(): AsyncGenerator<SDKMessage, void>;
  wait(): Promise<RunResult>;
  cancel(): Promise<void>;
  conversation(): Promise<ConversationTurn[]>;
  supports(operation: RunOperation): boolean;
  unsupportedReason(operation: RunOperation): string | undefined;
  onDidChangeStatus(listener: (status: RunStatus) => void): () => void;
}
```

A run can be consumed three ways:

1. **Stream** events as they come in (`run.stream()`).
2. **Wait** for the terminal result without streaming (`await run.wait()`).
3. **Inspect** the structured conversation post-hoc (`await run.conversation()`).

These are not mutually exclusive — you can stream and `wait()` the same run.

## Per-run model override

The model passed to `agent.send()` overrides the agent's selection for that run, and then becomes sticky for subsequent sends:

```typescript
const run = await agent.send("Plan the refactor", {
  model: { id: "google/gemini-2.0-flash-exp:free", params: [{ id: "thinking", value: "high" }] },
});
console.log(agent.model); // updated to the override after the send succeeds
```

`run.model` is immutable once the run starts — it always reflects what the run actually used.

## Next

- [Runtimes](./runtimes.md) — local vs cloud, when to use each
- [Stream events](./stream-events.md) — what `run.stream()` yields
