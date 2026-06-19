SDK
Theo SDK
Public beta
The TypeScript SDK is in public beta. APIs may change before general availability.

Stability & versioning
- Architectural decisions are tracked under `.claude/knowledge-base/adrs/` in the repository (D1..D14).
- Embedding provider unions are locked by ADR D11 (`openai`, `mistral`, `openrouter`, `voyage`, `deepinfra`).
- The default model id `google/gemini-2.0-flash-001` is a runnable fallback; query `Theokit.models.list()` for the canonical catalog (ADR D4).
- `await using agent = await Agent.create(...)` is supported (ADR D5).
- Skill files require strict YAML frontmatter (`name`, `description`) (ADR D10).

The @Theo/sdk package lets you call Theo's agent from your own code. The same agent that runs in the Theo IDE, CLI, and web app is now scriptable from TypeScript. You can also use Theo's native /sdk skill to help you start building.

Overview
The SDK wraps local and cloud runtimes behind one interface. You write the same code regardless of where the agent runs.

Runtime	What it does	When to use
Local	Runs the agent inline in your Node process. Files come from disk.	Dev scripts and CI checks against a working tree.
Cloud (Theo-hosted)	Runs in an isolated VM with your repo cloned in. Theo runs the VMs.	When the caller doesn't have the repo, you want many agents in parallel, or runs need to survive the caller disconnecting.
Cloud (self-hosted)	Same shape, but you run the VMs via a self-hosted pool.	Same reasons as Theo-hosted, plus code, secrets, and build artifacts must stay in your environment.
Runtime is picked by which key you pass to Agent.create() (local or cloud). Use the same Theo_API_KEY for either.

For the REST API, see the Cloud Agents API.

Authentication
Set Theo_API_KEY (or pass apiKey) before creating an agent.

The SDK accepts user API keys and service account API keys for both local and cloud runs. Team Admin API keys are not yet supported.

User API key from Theo Dashboard → Integrations
Service account API key from Team settings. See Service accounts

export Theo_API_KEY="your-key"
Usage and billing
SDK runs follow the same pricing, request pools, and Privacy Mode rules as runs from the IDE and Cloud Agents. Spend shows up in your team's usage dashboard under the SDK tag.

Core concepts
Concept	Description
Agent	Durable container that holds conversation state, workspace config, and settings. Survives across multiple prompts.
Run	One prompt submission. Owns its own stream, status, result, and cancellation.
SDKMessage	Normalized stream events emitted during a run. Same shape across all runtimes.
Context manager	File-based or inline project context selected before each run and bounded by a token budget.
Memory	Durable facts persisted across agent instances by namespace, user, and scope.
Skills	File-based capability packs loaded from `.theokit/skills/*/SKILL.md` and exposed to the agent by name and description.
Installation

npm install @Theo/sdk
Quick start
The fastest way in: a local agent against your current working tree, streaming events as they come in. Cloud setup is in Creating agents below.


import { Agent } from "@Theo/sdk";
const agent = await Agent.create({
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
});
const run = await agent.send("Summarize what this repository does");
for await (const event of run.stream()) {
  console.log(event);
}
Each event is a discriminated SDKMessage. Streaming shows how to extract assistant text, handle tool calls, and clean up with await using. For a one-shot prompt (create, run, dispose), see Agent.prompt().

Creating agents

function Agent.create(options: AgentOptions): Promise<SDKAgent>;
Agent.create() validates options and returns a handle immediately. Pass either local or cloud to pick a runtime.


// Local agent
const agent = await Agent.create({
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: "/path/to/repo" },
});
// Cloud agent
const agent = await Agent.create({
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  cloud: {
    repos: [{ url: "https://github.com/your-org/your-repo", startingRef: "main" }],
    autoCreatePR: true,
  },
});
agent.agentId is populated immediately. Local agents get an agent-<uuid> ID; cloud agents get a bc-<uuid> ID.

Cloud agents started by the SDK are filtered out of the default agent list. To view them in Theo Web or a Theo window, click Filter > Source > SDK.

Session environment variables
For cloud agents, pass cloud.envVars when a run needs short-lived credentials or other values that should live only with that agent.


const agent = await Agent.create({
  apiKey: process.env.Theo_API_KEY!,
  cloud: {
    repos: [{ url: "https://github.com/your-org/your-repo" }],
    envVars: {
      STAGING_API_TOKEN: process.env.STAGING_API_TOKEN!,
    },
  },
});
These values are encrypted at rest, injected into the cloud agent's shell, and deleted with the agent. envVars can't be used with a caller-supplied agentId; omit agentId and read the server-minted ID from agent.agentId. Variable names can't start with Theo_.

Model parameters
Use model.params to pass per-model options such as reasoning effort. Parameter ids and values vary by model. Use Theo.models.list() to discover supported parameters and preset variants for your account.

When a selected model requires Max Mode, Theo enables it automatically for the SDK request.


const agent = await Agent.create({
  apiKey: process.env.Theo_API_KEY!,
  model: {
    id: "google/gemini-2.0-flash-001",
    params: [{ id: "thinking", value: "high" }],
  },
  local: { cwd: process.cwd() },
});

Context manager
The context manager selects project context before a run starts. It is for working-set material: README files, architecture notes, generated summaries, and other documents that help the agent understand the current task. It is not durable user memory.

Enable file-based context with `context.manager: "file"`. Local agents read `.theokit/context/<name>.md` from the workspace when `local.settingSources` includes `"project"` (legacy `.theokit/context.json` still works but is deprecated; see Configuration files section); cloud agents read committed project context from the cloned repo. Call `agent.context.snapshot()` to inspect the public, redacted context that will be offered to runs.


const agent = await Agent.create({
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd(), settingSources: ["project"] },
  context: {
    manager: "file",
    maxTokens: 1200,
  },
});
const snapshot = await agent.context.snapshot();
await agent.reload(); // re-read context (legacy .theokit/context.json or markdown form)

Legacy `.theokit/context.json` shape (deprecated since v1.5 — migrate via `theokit-migrate-config`):


{
  "sources": [
    { "name": "project-readme", "path": "README.md" },
    { "name": "architecture-note", "path": "docs/architecture.md" }
  ],
  "exclude": ["**/.env", "**/secrets/**"],
  "maxTokens": 1200
}

The snapshot must never include secrets, absolute temporary paths, or raw tokens. `maxTokens` is a hard budget; implementations may summarize or omit low-priority sources to stay under budget.

Memory
Memory stores durable facts across agent instances. It is keyed by namespace, user, and scope so agents can remember stable preferences without leaking facts across users or teams.


const agent = await Agent.create({
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  memory: {
    enabled: true,
    namespace: "my-app",
    userId: "user-123",
    scope: "user",
  },
});
await (await agent.send("Remember: my preferred test runner is Vitest.")).wait();

Use `scope: "agent"` for one agent's durable state, `"user"` for a user's stable preferences, and `"team"` only for shared team facts that are safe for every authorized caller. Memory must not store API keys, bearer tokens, passwords, authorization headers, or other credential material. Local `storePath` values must stay inside the workspace; path traversal is a `ConfigurationError`.

Skills
Skills are named capability packs. The SDK exposes their names and descriptions to the agent so it knows when to use them, but full skill prompt bodies are not included in public streams, snapshots, or `agent.skills.list()` output.

Local file-based skills live at `.theokit/skills/<name>/SKILL.md` and are loaded when `local.settingSources` includes `"project"`. Cloud agents load skills committed in the repo. `agent.reload()` re-reads skill files and fails with `ConfigurationError` if a skill is malformed instead of silently ignoring it.


const agent = await Agent.create({
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd(), settingSources: ["project"] },
  skills: {
    enabled: ["code-review", "test-architect"],
  },
});
const skills = await agent.skills.list();

Example skill:


---
name: code-review
description: Reviews TypeScript SDK changes for contract regressions.
---

Check public API compatibility, runtime behavior, and tests that can produce false positives.

SDKAgent
The handle returned by Agent.create() and Agent.resume().


interface SDKAgent {
  readonly agentId: string;
  readonly model: ModelSelection | undefined;
  readonly context?: SDKContextManager;
  readonly memory?: SDKMemoryManager;
  readonly skills?: SDKSkillsManager;
  send(message: string | SDKUserMessage, options?: SendOptions): Promise<Run>;
  close(): void;
  reload(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
  listArtifacts(): Promise<SDKArtifact[]>;
  downloadArtifact(path: string): Promise<Buffer>;
}
Member	Description
agentId	Stable agent identifier. agent-<uuid> for local, bc-<uuid> for cloud.
model	Current model selection. Updates after every successful send({ model }). undefined until something sets it (including resumed agents whose caller did not pass model).
context	Context manager handle when context is enabled. `snapshot()` returns the public, redacted context selected for runs.
memory	Memory manager handle when memory is enabled. Reserved for explicit memory inspection and deletion APIs.
skills	Skills manager handle when skills are enabled. `list()` returns public skill metadata, never full prompt bodies.
send	Start a new run with the given prompt. Returns a Run handle.
close	Begin disposal without awaiting. Fire-and-forget.
reload	Re-read filesystem config (context, skills, hooks, project MCP, subagents) without disposing.
[Symbol.asyncDispose]	Async disposal. Pair with await using for automatic cleanup.
listArtifacts	List files produced by the agent (cloud only; local returns empty).
downloadArtifact	Download a file by path (cloud only; local throws).
Agent.prompt()

function Agent.prompt(message: string, options?: AgentOptions): Promise<RunResult>;
One-shot convenience: creates an agent, sends a single prompt, waits for the run to finish, and disposes.


const result = await Agent.prompt("What does the auth middleware do?", {
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
});

**`throwOnError: true`** (v1.x+) — opt-in flag that makes `Agent.prompt` reject with `AgentRunError` (extends `TheokitAgentError`) instead of resolving with `{ status: 'error', error }`. Cancelled runs still resolve. Reduces idiomatic chat-handler snippets from ~10 lines (`if (result.status === 'error') yield ...`) to ~6 lines (`try { ... } catch (err) { yield ... }`).

```typescript
import { Agent, AgentRunError } from "@theokit/sdk";

try {
  const result = await Agent.prompt("hi", {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: { id: "claude-sonnet-4-5-20250929" },
    throwOnError: true,
  });
  // result.status === 'finished' guaranteed here
} catch (err) {
  if (err instanceof AgentRunError && err.code === "auth_failed") {
    // bad API key
  }
}
```

Default `false` (non-breaking). Defensive guard: if `result.error === undefined` despite `status: 'error'` (malformed RunResult), the option resolves normally without throwing.

Sending messages
Each agent.send() returns a Run. The agent retains conversation context across runs; the run is the unit of work for one prompt.

Run

type RunStatus = "running" | "finished" | "error" | "cancelled";
type RunOperation = "stream" | "wait" | "cancel" | "conversation" | "listArtifacts" | "downloadArtifact";
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
interface RunGitInfo {
  branches: Array<{ repoUrl: string; branch?: string; prUrl?: string }>;
}
interface RunResult {
  id: string;
  status: "finished" | "error" | "cancelled";
  result?: string;
  model?: ModelSelection;
  durationMs?: number;
  git?: RunGitInfo;
}
Streaming

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
// Follow-up. Full context is retained.
const run2 = await agent.send("Fix it and add a regression test");
await run2.wait();
To send images alongside text:


const run = await agent.send({
  text: "What's in this screenshot?",
  images: [{ data: base64Png, mimeType: "image/png" }],
});
Waiting without streaming

const result = await run.wait();
console.log(result.status);      // "finished" | "error" | "cancelled"
console.log(result.result);      // final assistant text, if any
console.log(result.model);       // resolved ModelSelection used for this run
console.log(result.durationMs);
console.log(result.git);         // { branches: [{ repoUrl, branch?, prUrl? }] } on cloud
Cancelling a run

await run.cancel();
Cancels the run. The status moves to "cancelled", the live stream aborts, in-flight tool calls stop, and run.wait() resolves with status: "cancelled". Partial output (assistant text written so far) stays on the Run object.

Cancel is supported on running local and cloud runs and is a no-op if the run already finished.

Reading run state

console.log(run.status);  // "running" | "finished" | "error" | "cancelled"
const stop = run.onDidChangeStatus((status) => {
  console.log(`status changed to ${status}`);
});
// Call `stop()` to remove the listener.
// Structured per-turn view of the conversation accumulated in this run
const turns = await run.conversation();
run.conversation() returns the run's ConversationTurn[] (an agent turn with steps, or a shell turn with command and output). Use it to render or persist the run's structured history without subscribing to the live stream.

Per-run model override
The model you pass to agent.send() overrides the agent's selection for that run, then becomes sticky: subsequent sends without an override continue to use the new model. To switch back, pass another model override or read the current selection from agent.model.


const run = await agent.send("Plan the refactor", {
  model: { id: "google/gemini-2.0-flash-001", params: [{ id: "thinking", value: "high" }] },
});
console.log(agent.model);  // updated to the override after the send succeeds
run.model and result.model reflect the selection that this specific run actually used and are immutable once the run starts.

Streaming raw deltas
run.stream() yields normalized SDKMessage events. For lower-level updates (per-token text, tool-call args streaming in, thinking deltas, step boundaries), pass onDelta and onStep callbacks to send():


const run = await agent.send("Refactor the utils module", {
  onDelta: ({ update }) => {
    if (update.type === "text-delta") process.stdout.write(update.text);
    if (update.type === "thinking-delta") process.stdout.write(update.text);
  },
  onStep: ({ step }) => {
    console.log(`[step] ${step.type}`);
  },
});
The callbacks are awaited before the next update is processed, so you can apply backpressure. InteractionUpdate covers text-delta, thinking-delta, thinking-completed, tool-call-started, tool-call-completed, partial-tool-call, token-delta, step-started, step-completed, turn-ended, and a handful of summary and shell-output deltas.

Per-send options
Property	Type	Description
model	ModelSelection	Per-send model override. If omitted, uses agent.model. Sticky: a successful send updates agent.model.
systemPrompt	string	Per-call system prompt override. Wins over AgentOptions.systemPrompt. String only — for dynamic resolvers, configure on AgentOptions. An empty string is honoured (it explicitly clears the system context).
mcpServers	Record<string, McpServerConfig>	Inline MCP server definitions. Fully replaces creation-time servers for this run.
tools	CustomTool[]	Per-call inline custom tools. Fully replaces `AgentOptions.tools` for this run (not merged). `undefined` → fall back to agent tools; `[]` → explicit clear (no custom tools for this run); `[t1, t2]` → use exactly these. Local runtime only — cloud agents throw `ConfigurationError(code: "cloud_custom_tools_rejected")`.
onStep	(args: { step }) => void | Promise<void>	Callback after each completed conversation step (text, thinking, or tool batch).
onDelta	(args: { update }) => void | Promise<void>	Callback per raw InteractionUpdate.
local.force	boolean	Local agents only. Defaults to false. Expire a stuck active run before starting this message. Cloud returns 409 agent_busy server-side, so no equivalent is needed.

SystemPromptContext
Passed to a systemPrompt resolver function (when AgentOptions.systemPrompt is a callable). Field order is a compatibility contract: new fields are appended, never reordered.

interface SystemPromptContext {
  agentId: string;
  cwd: string | undefined;
  model: ModelSelection | undefined;
  skills: ReadonlyArray<{ name: string; description: string }>;
  userMessage: string;
}

The resolver may be sync or async. Errors thrown propagate to the caller of agent.send(). The SDK does NOT impose a timeout — wrap your own Promise.race if you call into slow resources.
The next three sections are detailed reference for SDKMessage, InteractionUpdate, and ConversationTurn. Skim or skip on a first read; Resuming agents picks up the narrative.

Stream events
Events from run.stream(). Discriminate on type. All events include agent_id and run_id.


type SDKMessage =
  | SDKSystemMessage
  | SDKUserMessageEvent
  | SDKAssistantMessage
  | SDKThinkingMessage
  | SDKToolUseMessage
  | SDKStatusMessage
  | SDKTaskMessage
  | SDKRequestMessage;
type	Description	Key fields
"system"	Init metadata. Emitted once at the start of a run.	subtype? ("init"), model?, tools?
"user"	Echo of the user prompt for this run.	message.content: TextBlock[]
"assistant"	Model text output.	message.content: (TextBlock | ToolUseBlock)[]
"thinking"	Reasoning content.	text, thinking_duration_ms?
"tool_call"	Tool invocation lifecycle. Emitted at start with args, then again on completion with result.	call_id, name, status, args?, result?, truncated?
"status"	Cloud run lifecycle transitions.	status, message?
"task"	Task-level milestones and summaries.	status?, text?
"request"	Awaiting user input or approval.	request_id
Result data (final text, model, duration, git metadata) lives on the Run object after the stream completes. Use run.wait() to read it.

Tool call schema is not stable. The args and result payloads on tool_call events reflect each tool's internal shape and can change as tools evolve. Tool names can also be renamed or replaced. Treat args and result as unknown and parse defensively. The event envelope (type, call_id, name, status) is stable.

Message types

interface SDKSystemMessage {
  type: "system";
  subtype?: "init";
  agent_id: string;
  run_id: string;
  model?: ModelSelection;
  tools?: string[];
}
interface SDKUserMessageEvent {
  type: "user";
  agent_id: string;
  run_id: string;
  message: { role: "user"; content: TextBlock[] };
}
interface SDKAssistantMessage {
  type: "assistant";
  agent_id: string;
  run_id: string;
  message: {
    role: "assistant";
    content: Array<TextBlock | ToolUseBlock>;
  };
}
interface SDKThinkingMessage {
  type: "thinking";
  agent_id: string;
  run_id: string;
  text: string;
  thinking_duration_ms?: number;
}
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
interface SDKStatusMessage {
  type: "status";
  agent_id: string;
  run_id: string;
  status: "CREATING" | "RUNNING" | "FINISHED" | "ERROR" | "CANCELLED" | "EXPIRED";
  message?: string;
}
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
interface TextBlock {
  type: "text";
  text: string;
}
interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
SDKToolUseMessage is emitted twice for most tool calls: first with status: "running" and args populated, then again on completion with status: "completed" (or "error") and result populated. truncated flags whether the SDK truncated args or result because the payload was too large.

SDKStatusMessage covers cloud-side lifecycle transitions. CREATING covers VM provisioning and repo cloning; RUNNING is the agent doing work; the rest are terminal.

Interaction updates
InteractionUpdate is the raw delta type passed to the onDelta callback on agent.send(). Updates are finer-grained than SDKMessage events: text streams in token-by-token, tool calls report partial state as args accumulate, thinking arrives as it happens.


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
Update types

interface TextDeltaUpdate {
  type: "text-delta";
  text: string;
}
interface ThinkingDeltaUpdate {
  type: "thinking-delta";
  text: string;
}
interface ThinkingCompletedUpdate {
  type: "thinking-completed";
  thinkingDurationMs: number;
}
interface ToolCallStartedUpdate {
  type: "tool-call-started";
  callId: string;
  toolCall: ToolCall;
  modelCallId: string;
}
interface PartialToolCallUpdate {
  type: "partial-tool-call";
  callId: string;
  toolCall: ToolCall;
  modelCallId: string;
}
interface ToolCallCompletedUpdate {
  type: "tool-call-completed";
  callId: string;
  toolCall: ToolCall;
  modelCallId: string;
}
interface TokenDeltaUpdate {
  type: "token-delta";
  tokens: number;
}
interface StepStartedUpdate {
  type: "step-started";
  stepId: number;
}
interface StepCompletedUpdate {
  type: "step-completed";
  stepId: number;
  stepDurationMs: number;
}
interface TurnEndedUpdate {
  type: "turn-ended";
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}
interface UserMessageAppendedUpdate {
  type: "user-message-appended";
  userMessage: UserMessage;
}
interface SummaryUpdate {
  type: "summary";
  summary: string;
}
interface SummaryStartedUpdate {
  type: "summary-started";
}
interface SummaryCompletedUpdate {
  type: "summary-completed";
}
interface ShellOutputDeltaUpdate {
  type: "shell-output-delta";
  event: Record<string, unknown>;
}
PartialToolCallUpdate is emitted as the model streams arguments into a tool call before it commits. The same stability disclaimer that applies to SDKToolUseMessage.args applies here.

Conversation types
The structured per-turn view of a run, returned by run.conversation() and used in the onStep callback's argument.


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
interface AssistantMessage {
  text: string;
}
interface ThinkingMessage {
  text: string;
  thinkingDurationMs?: number;
}
interface UserMessage {
  text: string;
}
interface ShellCommand {
  command: string;
  workingDirectory?: string;
}
interface ShellOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}
ToolCall is a discriminated union over every built-in tool (shell, edit, read, write, glob, grep, ls, semSearch, mcp, task, and others). Its shape is internal-facing; see the stability note under Stream events.

Resuming agents

function Agent.resume(agentId: string, options?: Partial<AgentOptions>): Promise<SDKAgent>;
Use Agent.resume() to reattach to an existing agent by ID. Common flows: reconnecting to a long-running cloud agent that was kicked off earlier, or continuing a conversation after the local process restarted. Runtime is auto-detected from the ID prefix (bc- is cloud, anything else is local).


await using agent = await Agent.resume("bc-abc123", {
  apiKey: process.env.Theo_API_KEY!,
});
const run = await agent.send("Also update the changelog");
await run.wait();
agent.model is undefined on resume unless you pass model again. Inline mcpServers are not persisted across resume — they often carry secrets and live in memory only. Pass them again on resume, or use file-based MCP config (.Theo/mcp.json + local.settingSources) for servers that should survive.

Agent.getOrCreate()

function Agent.getOrCreate(agentId: string, options: AgentOptions): Promise<SDKAgent>;

Consolidates the resume-or-create dance into a single call (ADR D22). Tries `Agent.resume(agentId, options)` first; on `UnknownAgentError` falls through to `Agent.create({ ...options, agentId })`. On same-process race (a second caller wins the create), retries `Agent.resume` once and returns the winner's handle. Any other error propagates verbatim.

const agent = await Agent.getOrCreate(`tg-user-${userId}`, {
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "claude-sonnet-4-6" },
  local: { cwd: process.cwd() },
  memory: { enabled: true, namespace: "tg-bot", scope: "user", userId },
});

Use when: chat bots, long-running agents, any consumer that wants idempotent "give me this agent" semantics without try/catch boilerplate.

createAgentFactory()

function createAgentFactory(common: Partial<AgentOptions>): AgentFactory;
interface AgentFactory {
  forSession(agentId: string, overrides?: Partial<AgentOptions>): Promise<SDKAgent>;
  getOrCreate(agentId: string, overrides?: Partial<AgentOptions>): Promise<SDKAgent>;
}

Captures shared `AgentOptions` once and produces per-session agents with focused overrides (ADR D23). Merge rules: top-level shallow merge with overrides winning; deep merge for `local`, `memory`, `cloud`; total replace for collection-shaped fields (`mcpServers`, `agents`, `tools`, `providers`, `plugins`, `skills`, `context`). The function-level `agentId` always wins.

const factory = createAgentFactory({
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "claude-sonnet-4-6" },
  local: { cwd: process.cwd(), settingSources: ["project"] },
  systemPrompt: "You are a helpful assistant.",
});

const agent = await factory.getOrCreate(`tg-user-${userId}`, {
  memory: { enabled: true, namespace: "tg-bot", scope: "user", userId },
});

Use when: chat-bot patterns where 90% of the config is identical across users and only a handful of fields change per session.

defineTool()

function defineTool<T extends ZodType>(spec: DefineToolSpec<T>): CustomTool;
interface DefineToolSpec<T extends ZodType> {
  name: string;
  description: string;
  inputSchema: T;
  handler: (input: z.infer<T>) => string | Promise<string>;
}

Type-safe builder for custom inline tools (ADR D24). Converts a Zod schema to JSON Schema for the LLM-facing `inputSchema` field, wraps the handler with a runtime `schema.parse` step, and preserves type inference. Requires `zod` as a peer dependency.

import { z } from "zod";
import { defineTool } from "@theokit/sdk";

const rollTool = defineTool({
  name: "roll",
  description: "Roll N dice with S sides each.",
  inputSchema: z.object({
    count: z.number().int().min(1).max(100),
    sides: z.number().int().min(2).max(1000),
  }),
  handler: ({ count, sides }) => {
    // count is inferred as number — no `as` cast needed.
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
    return JSON.stringify({ rolls, total: rolls.reduce((a, b) => a + b, 0) });
  },
});

Use when: custom tools whose handlers expect typed input and benefit from automatic runtime validation. Invalid input becomes `tool_result(isError)` with a Zod message instead of silent NaN/undefined.

Agent.builder()

function Agent.builder(): AgentBuilder;

Fluent builder alternative to the options bag (ADR D25). Chainable setters mutate internal state and return `this`. Three terminals: `.build()` returns an `AgentOptions` snapshot; `.create()` calls `Agent.create`; `.getOrCreate(id)` calls `Agent.getOrCreate`. Validation runs inside the terminal — no half-built leaking.

const agent = await Agent.builder()
  .apiKey(process.env.Theo_API_KEY!)
  .model({ id: "claude-sonnet-4-6" })
  .local({ cwd: process.cwd() })
  .systemPrompt("You are a helpful assistant.")
  .tools([rollTool])
  .getOrCreate(`tg-user-${userId}`);

Use when: progressive construction, factory wiring where setters are called conditionally, or when fluent APIs are the team preference. Setters that overwrite silently are documented — last call wins.

Inspecting agents and runs
List, fetch, and reload past agents. List endpoints return { items, nextTheo? } for Theo-based pagination.

Agent.list()

function Agent.list(options?: ListAgentsOptions): Promise<ListResult<SDKAgentInfo>>;
type ListAgentsOptions = {
  limit?: number;
  Theo?: string;
} & (
  | { runtime?: undefined }
  | { runtime: "local"; cwd?: string }
  | {
      runtime: "cloud";
      prUrl?: string;
      includeArchived?: boolean;
      apiKey?: string;
    }
);

const { items, nextTheo } = await Agent.list({
  runtime: "local",
  cwd: process.cwd(),
});
Agent.get()

function Agent.get(agentId: string, options?: GetAgentOptions): Promise<SDKAgentInfo>;
interface GetAgentOptions {
  cwd?: string;       // local routing
  apiKey?: string;    // cloud routing
}
Runtime is auto-detected from the agent ID prefix (bc- → cloud, otherwise local).

Agent.listRuns()

function Agent.listRuns(agentId: string, options?: ListRunsOptions): Promise<ListResult<Run>>;
type ListRunsOptions = {
  limit?: number;
  Theo?: string;
} & (
  | { runtime?: "local"; cwd?: string }
  | { runtime: "cloud"; apiKey?: string }
);
Agent.getRun()

function Agent.getRun(runId: string, options?: GetRunOptions): Promise<Run>;
type GetRunOptions =
  | { runtime?: "local"; cwd?: string }
  | { runtime: "cloud"; agentId: string; apiKey?: string };
Cloud getRun requires the parent agentId.

Cloud agent lifecycle
Cloud agents stay in your team's workspace until you archive or delete them. Agent.list({ runtime: "cloud" }) hides archived agents by default; pass includeArchived: true to see them. Filter by prUrl to find the agent that opened a specific pull request.


function Agent.archive(agentId: string, options?: AgentOperationOptions): Promise<void>;
function Agent.unarchive(agentId: string, options?: AgentOperationOptions): Promise<void>;
function Agent.delete(agentId: string, options?: AgentOperationOptions): Promise<void>;
interface AgentOperationOptions {
  cwd?: string;
  apiKey?: string;
}

await Agent.archive(agentId);     // soft-delete; transcript stays readable
await Agent.unarchive(agentId);   // restore an archived agent
await Agent.delete(agentId);      // permanent; subsequent reads return 404
SDKAgentInfo
The metadata shape returned by Agent.list() and Agent.get().


type SDKAgentInfo = {
  agentId: string;
  name: string;
  summary: string;
  lastModified: number;
  status?: "running" | "finished" | "error";
  createdAt?: number;
  archived?: boolean;
} & (
  | { runtime?: undefined }
  | { runtime: "local"; cwd?: string }
  | {
      runtime: "cloud";
      env?: { type: "cloud" | "pool" | "machine"; name?: string };
      repos?: string[];
    }
);
Cron jobs
@theokit/sdk supports scheduling agent runs on a cron expression. Two runtimes:

Runtime	What runs the job
Local	The in-process scheduler activated via Cron.start(). Jobs fire while the host process is alive. Persisted to .theokit/cron/jobs.json.
Cloud	Theo PaaS schedules the job server-side. Fires regardless of any SDK process.

Runtime is inferred from how the job is created: pass agent.local or an agentId with agent- prefix for local; pass agent.cloud or an agentId with bc- prefix for cloud.

Cron.create()


function Cron.create(options: CronCreateOptions): Promise<CronJob>;

const job = await Cron.create({
  cron: "0 9 * * *",                 // every day at 09:00
  timezone: "America/Sao_Paulo",
  message: "Summarize yesterday's commits and post to #engineering",
  agent: {
    apiKey: process.env.THEOKIT_API_KEY!,
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: process.cwd() },
  },
});

await Cron.start();                  // required for local jobs to actually fire
Either agent (ephemeral agent created on each fire) or agentId (bound to an existing agent for context continuity) must be set, never both. Setting both is a ConfigurationError.

Supported cron expressions:

5-field POSIX cron (minute hour day-of-month month day-of-week)
Shorthand: @hourly, @daily, @weekly, @monthly, @yearly
timezone accepts any IANA identifier; defaults to UTC. Invalid expressions throw ConfigurationError synchronously at create time.

Listing and managing jobs


const { items } = await Cron.list({ runtime: "local", cwd: process.cwd() });
const job = await Cron.get(jobId);
await Cron.disable(jobId);           // pause without deleting
await Cron.enable(jobId);            // resume
await Cron.delete(jobId);            // permanent
Manual fire (off-schedule)


const run = await Cron.run(jobId);   // returns the resulting Run
for await (const event of run.stream()) {
  // ...
}
Local scheduler control
The local scheduler must be explicitly started for local jobs to fire. For 24/7 scheduling without a long-running SDK process, use the cloud runtime.


await Cron.start({ cwd: process.cwd() });
const status = await Cron.status();
// { running: true, jobCount: 3, nextFireAt: 1747... }
await Cron.stop();
Cloud jobs do not need Cron.start() — Theo PaaS fires them server-side.

CronJob


interface CronJob {
  id: string;
  name?: string;
  cron: string;
  timezone?: string;
  message: string | SDKUserMessage;
  agent?: AgentOptions;              // mutually exclusive with agentId
  agentId?: string;
  enabled: boolean;
  status: "scheduled" | "running" | "paused" | "errored";
  runtime: "local" | "cloud";
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
}
CronCreateOptions


interface CronCreateOptions {
  cron: string;
  message: string | SDKUserMessage;
  agent?: AgentOptions;
  agentId?: string;
  name?: string;
  timezone?: string;
  enabled?: boolean;                 // defaults to true
  apiKey?: string;                   // falls back to THEOKIT_API_KEY
}
CronSchedulerStatus


interface CronSchedulerStatus {
  running: boolean;
  jobCount: number;
  nextFireAt?: number;
  lastError?: { jobId: string; message: string; at: number };
}
Known cron limitations

Local cron jobs only fire while the host process is alive. Run the SDK as a systemd / launchd / pm2 service, or use the cloud runtime, for 24/7 scheduling.
Local jobs are persisted to .theokit/cron/jobs.json (and reloaded on Cron.start()), but in-flight executions are NOT resumed if the process crashes mid-fire.
Cron.run() (manual fire) does not update lastRunAt — only scheduled fires do.

The Theo namespace
Account-level and catalog reads. All methods take an optional { apiKey } and otherwise fall back to Theo_API_KEY.

Theo.me()

function Theo.me(options?: TheoRequestOptions): Promise<SDKUser>;
interface TheoRequestOptions {
  apiKey?: string;
}
interface SDKUser {
  apiKeyName: string;
  userEmail?: string;
  createdAt: string;
}
Theo.models.list()

function Theo.models.list(options?: TheoRequestOptions): Promise<SDKModel[]>;
type SDKModel = ModelListItem;
interface ModelListItem {
  id: string;
  displayName: string;
  description?: string;
  parameters?: ModelParameterDefinition[];
  variants?: ModelVariant[];
}
interface ModelParameterDefinition {
  id: string;
  displayName?: string;
  values: Array<{ value: string; displayName?: string }>;
}
interface ModelVariant {
  params: ModelParameterValue[];
  displayName: string;
  description?: string;
  isDefault?: boolean;
}
Use Theo.models.list() to discover valid model ids and per-model params before calling Agent.create() or agent.send(). Parameters are model-specific. Common examples include reasoning effort.


const models = await Theo.models.list();
const composer = models.find((model) => model.id === "google/gemini-2.0-flash-001");
console.log(composer?.parameters);
// [
//   {
//     id: "thinking",
//     displayName: "Thinking",
//     values: [
//       { value: "low", displayName: "Low" },
//       { value: "high", displayName: "High" },
//     ],
//   },
// ]
Pass selected parameter values through model.params. Preset variants already contain valid params, so you can copy them into a model selection.


const agent = await Agent.create({
  apiKey: process.env.Theo_API_KEY!,
  model: {
    id: "google/gemini-2.0-flash-001",
    params: [{ id: "thinking", value: "high" }],
  },
  local: { cwd: process.cwd() },
});
Theo.repositories.list()

function Theo.repositories.list(options?: TheoRequestOptions): Promise<SDKRepository[]>;
interface SDKRepository {
  url: string;
}
Returns the GitHub repositories connected for the calling user's team. Cloud only.

MCP servers
Agents can pick up MCP servers from several sources. Inline definitions in Agent.create() or agent.send() are the most common path. File-based and dashboard-managed configs are also supported.

What gets loaded
Local agents load servers from up to five sources, with first-match-wins precedence on conflicting names:

mcpServers on agent.send(). Fully replaces creation-time servers for that run (not merged).
mcpServers on Agent.create(). Used when no per-send override is provided.
Plugin servers, if local.settingSources includes "plugins".
Project servers from .Theo/mcp.json, if local.settingSources includes "project".
User servers from ~/.Theo/mcp.json, if local.settingSources includes "user".
Without local.settingSources, only inline servers are loaded. If a local MCP server requires OAuth login, the SDK can't prompt you to sign in. It only works if you've already signed in to that server from the Theo app, in which case the SDK reuses that saved login.

Cloud agents load servers from:

mcpServers on agent.send(). Fully replaces creation-time servers for that run (not merged).
mcpServers on Agent.create(). Used when no per-send override is provided.
Your user and team MCP servers from Theo.com/agents.
If an inline server doesn't include auth or headers and you've previously authorized that server URL on Theo.com/agents, runs authenticated with a personal API token reuse those OAuth tokens automatically. Service account API keys cannot fall back to user auth as they are not associated with a user.

local.settingSources does not apply to cloud agents.

Local

const agent = await Agent.create({
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "auto" },
  local: { cwd: process.cwd() },
  mcpServers: {
    docs: {
      type: "http",
      url: "https://example.com/mcp",
      auth: {
        CLIENT_ID: "client-id",
        scopes: ["read", "write"],
      },
    },
    filesystem: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
      cwd: process.cwd(),
    },
  },
});
Cloud
Cloud agents can receive authenticated MCP configs inline too. Use HTTP auth when Theo should proxy a remote MCP through the backend. Use stdio env when the server runs inside the cloud VM and reads credentials from environment variables.


const agent = await Agent.create({
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  cloud: {
    repos: [{ url: "https://github.com/your-org/your-repo", startingRef: "main" }],
  },
  mcpServers: {
    linear: {
      type: "http",
      url: "https://mcp.linear.app/sse",
      headers: {
        Authorization: `Bearer ${process.env.LINEAR_API_KEY!}`,
      },
    },
    figma: {
      type: "http",
      url: "https://api.figma.com/mcp",
      auth: {
        CLIENT_ID: process.env.FIGMA_CLIENT_ID!,
        CLIENT_SECRET: process.env.FIGMA_CLIENT_SECRET!,
        scopes: ["file_content:read"],
      },
    },
    github: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_TOKEN: process.env.GITHUB_TOKEN!,
      },
    },
  },
});
Use headers for static API keys or Bearer tokens — Theo passes them through on every request. Use auth for OAuth-protected servers. For cloud, Theo runs the OAuth flow once server-side and reuses the token across runs. Locally, the SDK can't open a browser to sign you in; it only reuses tokens you've already obtained by signing in through the Theo app.

HTTP headers and auth are handled by Theo's backend. Sensitive fields are redacted and do not enter the VM.
Stdio env values are passed into the VM because the server runs there. Treat them like any other runtime secret.
OAuth for MCP servers configured on Theo.com/agents stays per-user, even for team-level servers.
See MCP for the full config format and Cloud Agent capabilities for cloud-specific behavior.

Subagents
Define named subagents that the main agent spawns via the Agent tool. Pass them inline:


const agent = await Agent.create({
  model: { id: "google/gemini-2.0-flash-001" },
  apiKey: process.env.Theo_API_KEY!,
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
Subagents committed to the repo at .Theo/agents/*.md (with name, description, and optional model frontmatter) are also picked up. Inline definitions override file-based ones with the same name.

Context, memory, and skills
Context, memory, and skills are loaded before MCP tools and subagents are offered to a run:

Context is task working-set. It is selected per agent from inline config or `.theokit/context/<name>.md` (legacy `.theokit/context.json` still supported until v2.0 — see Configuration files / deprecation), bounded by `maxTokens`, and exposed through `agent.context.snapshot()`.
Memory is durable recall. It persists facts by `{ namespace, userId, scope }`, rejects stores outside the workspace, and must redact credential material.
Skills are named capability packs. They are loaded from `.theokit/skills/*/SKILL.md`, listed with `agent.skills.list()`, and only expose public metadata in streams and snapshots.

`agent.reload()` refreshes file-based context and skills without disposing the agent or losing conversation state. Invalid context files or malformed skill frontmatter raise `ConfigurationError`.

Hooks
Hooks are file-based only. There is no programmatic hook callback. Hooks are a project policy boundary, not a per-run knob.

Local: Add `.theokit/hooks/<name>.md` to the repo passed as local.cwd (one file per hook; legacy `.theokit/hooks.json` deprecated since v1.5), or add `~/.theokit/hooks/` for user-level hooks.
Cloud: Commit `.theokit/hooks/` and its scripts to the repo passed in cloud.repos. SDK-created cloud agents load project hooks automatically. On Enterprise plans, they also run team hooks and enterprise-managed hooks.
See Hooks for the configuration format and Cloud Agents hooks support for cloud behavior.

Artifacts
List and download files from the agent's workspace.


interface SDKArtifact {
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

const artifacts: SDKArtifact[] = await agent.listArtifacts();
for (const artifact of artifacts) {
  console.log(artifact.path, artifact.sizeBytes);
}
const buffer = await agent.downloadArtifact(artifacts[0].path);
Artifact support is runtime-dependent. Local SDK agents currently return no artifacts and throw for downloadArtifact.

Resource management
Always dispose agents when done. The cleanest pattern is await using:


await using agent = await Agent.create({ /* ... */ });
// disposed automatically when the block exits
To dispose explicitly:


await agent[Symbol.asyncDispose]();
agent.close() starts disposal without awaiting. agent.reload() picks up filesystem config changes (hooks, project MCP, subagents) without disposing.

Configuration reference
AgentOptions
Property	Type	Default	Description
model	ModelSelection	Required for local; cloud falls back to the server-resolved default	Model to use. See ModelSelection.
apiKey	string	Theo_API_KEY env	User API key or service account key. Team Admin keys are not yet supported.
name	string	Auto-generated	Human-readable agent name surfaced as title in Agent.list() / Agent.get().
systemPrompt	string \| (ctx: SystemPromptContext) => string \| Promise<string>	(none)	System prompt for the agent. Either a plain string or an async resolver that receives a SystemPromptContext. Priority order: SendOptions.systemPrompt (per-call override) > AgentOptions.systemPrompt (resolved if function) > undefined. An empty string in either slot is honoured (explicitly clears the system context). Subagents do NOT inherit this — they use AgentDefinition.prompt. The SDK does not impose a timeout on resolvers — wrap your own Promise.race if you call into slow resources.
local	{ cwd?: string | string[]; settingSources?: SettingSource[]; sandboxOptions?: { enabled: boolean } }		Local agent config. settingSources picks ambient settings layers: "project", "user", "team", "mdm", "plugins", or "all".
cloud	CloudOptions		Cloud agent config.
mcpServers	Record<string, McpServerConfig>		Inline MCP server definitions.
agents	Record<string, AgentDefinition>		Subagent definitions.
context	ContextOptions		Project context manager configuration.
memory	MemoryOptions		Control durable memory for this agent.
skills	SkillsOptions		Load named skills from project files or explicit paths.
tools	CustomTool[]		Inline custom tools registered with the LLM. Local runtime only — cloud agents reject any non-empty tools array (ConfigurationError code `cloud_custom_tools_rejected`). Handlers are not persisted; re-pass on Agent.resume.
agentId	string	Auto-generated	Durable agent ID. Pass to keep a stable ID across invocations.
CloudOptions
Property	Type	Default	Description
env	{ type: "cloud"; name?: string } | { type: "pool"; name?: string } | { type: "machine"; name?: string }	{ type: "cloud" }	Execution environment. cloud uses Theo-hosted VMs; pool and machine target a self-hosted pool.
repos	Array<{ url: string; startingRef?: string; prUrl?: string }>		Repositories to clone into the VM. Pass prUrl to attach the agent to an existing PR.
workOnCurrentBranch	boolean	false	Push commits to the existing branch instead of a new one.
autoCreatePR	boolean	false	Open a PR when the run finishes.
skipReviewerRequest	boolean	false	Skip requesting the calling user as a reviewer on the PR.
AgentDefinition
Property	Type	Default	Description
description	string	required	When to use this subagent. Shown to the parent agent so it knows when to spawn.
prompt	string	required	System prompt for the subagent.
model	ModelSelection | "inherit"	"inherit"	Model override. Pass "inherit" to use the parent's selection.
mcpServers	Array<string | Record<string, McpServerConfig>>		MCP servers available to this subagent. Names reference servers from the parent's mcpServers.
CustomTool
Property	Type	Default	Description
name	string	required	Tool name surfaced to the LLM. Must match `/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/`. Reserved (rejected): `shell`, `memory_search`, `memory_get`, anything `mcp_*`.
description	string	required	Description surfaced to the LLM. Drives tool-selection accuracy.
inputSchema	Record<string, unknown>	required	JSON Schema describing the `input` argument. Must declare `type: "object"`.
handler	(input: Record<string, unknown>) => string \| Promise<string>	required	Local handler invoked when the model emits `tool_use`. Return value becomes `tool_result.content`. Throws → `tool_result` with `isError: true` (loop terminates as `status: "error"`, matching shell/MCP/memory behaviour).

Tools are local-only in v1.0 — cloud agents throw `ConfigurationError(code: "cloud_custom_tools_rejected")` when `tools.length > 0`. Handlers are not persisted by `stripSecretsFromOptions`; re-pass them on `Agent.resume(id, { tools: [...] })` if you want the same tools active for the resumed agent.
ContextOptions

interface ContextOptions {
  manager: "file" | "inline";
  maxTokens?: number;
  sources?: Array<{ name: string; path?: string; content?: string; priority?: number }>;
}
`manager: "file"` reads `.theokit/context/<name>.md` (legacy `.theokit/context.json` deprecated; see Configuration files for migration); `manager: "inline"` uses `sources` passed directly in `Agent.create()`. File sources are resolved relative to the workspace. Secrets and excluded files must not appear in `agent.context.snapshot()`.

SDKContextManager

interface SDKContextManager {
  snapshot(): Promise<{
    runtime: "local" | "cloud";
    sources: Array<{ name: string; path?: string; status: "included" | "excluded" | "summarized" }>;
    budget?: { maxTokens?: number; usedTokens?: number };
  }>;
}
The snapshot is a public diagnostic view. It may summarize source content but must not expose raw credentials or full secret-bearing files.

MemoryOptions

interface MemoryOptions {
  enabled: boolean;
  namespace?: string;
  userId?: string;
  scope?: "agent" | "user" | "team";
  storePath?: string;
}
`namespace` separates application domains. `userId` isolates user memories. `scope` defaults to `"agent"` unless the implementation documents a broader default. Local `storePath` is relative to the workspace and cannot escape it.

SDKMemoryManager

interface SDKMemoryManager {
  // Reserved for explicit inspection and deletion APIs.
}
The agent can use enabled memory during runs, but public memory management APIs are intentionally narrow until deletion and audit semantics are finalized.

SkillsOptions

interface SkillsOptions {
  enabled?: string[];
  paths?: string[];
}
`enabled` names skills to load from configured skill sources. `paths` may point at explicit local skill directories. Cloud rejects local-only paths unless the files are committed in the repo.

SDKSkillsManager

interface SDKSkillsManager {
  list(): Promise<Array<{ name: string; description: string }>>;
}
`list()` returns metadata only. It must not return full `SKILL.md` prompt bodies.
ModelSelection

interface ModelSelection {
  id: string;
  params?: ModelParameterValue[];
}
interface ModelParameterValue {
  id: string;
  value: string;
}
id is the model identifier (for example, "google/gemini-2.0-flash-001"). params carries per-model parameters such as reasoning effort. Use Theo.models.list() to discover valid ids, parameter definitions, and preset variants for your account.

McpServerConfig

type McpServerConfig =
  // stdio
  | {
      type?: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;       // local only; cloud rejects this field
    }
  // HTTP / SSE
  | {
      type?: "http" | "sse";
      url: string;
      headers?: Record<string, string>;   // passed through; Authorization here works
      auth?: {
        CLIENT_ID: string;
        CLIENT_SECRET?: string;
        scopes?: string[];
      };
    };
For HTTP servers running in the cloud, headers and auth are handled by Theo's backend. Sensitive fields are redacted before the VM sees them. For stdio servers in the cloud, env values are passed into the VM (treat them like any runtime secret).

SDKUserMessage

interface SDKUserMessage {
  text: string;
  images?: SDKImage[];
}
The structured form of agent.send()'s message argument. Use it to send images alongside text.

SDKImage

type SDKImage =
  | { url: string; dimension?: SDKImageDimension }
  | { data: string; mimeType: string; dimension?: SDKImageDimension };
interface SDKImageDimension {
  width: number;
  height: number;
}
Pass either a remote url or base64 data with a mimeType.

SettingSource

type SettingSource =
  | "project"
  | "user"
  | "team"
  | "mdm"
  | "plugins"
  | "all";
Controls which on-disk settings layers a local agent loads. Cloud agents always load project / team / plugins and ignore this field.

Value	Source
"project"	.Theo/ in the workspace
"user"	~/.Theo/
"team"	Team settings synced from the dashboard
"mdm"	MDM-managed enterprise settings
"plugins"	Plugin-provided settings
"all"	Shorthand for all of the above
ListResult

interface ListResult<T> {
  items: T[];
  nextTheo?: string;
}
Returned by Agent.list() and Agent.listRuns(). nextTheo is absent when there are no more pages.

Agent.generateObject()
Returns a typed value matching a Zod schema. The SDK creates a transient local agent under the hood, registers a single synthetic `output` tool whose JSON schema is derived from the Zod schema, and forces the model to call it exactly once. The handler captures the raw input, schema-parses it, and returns the typed object. The transient agent is disposed and hard-deleted from the registry across retries (see ADR D33).


import { z } from "zod";
import { Agent } from "@theokit/sdk";

const FactCard = z.object({
  title: z.string().min(1),
  summary: z.string().min(20),
  year: z.number().int().nullable(),
  sources: z.array(z.string()).min(1).max(3),
});

const { object, raw, usage, finishReason } = await Agent.generateObject({
  apiKey: process.env.THEOKIT_API_KEY,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
  schema: FactCard,
  prompt: "Produce a fact card about: Brazilian samba.",
  systemPrompt: "Match the schema exactly. Keep summary 2-3 sentences.",
  maxRetries: 1,
});
// object is fully typed: z.infer<typeof FactCard>

GenerateObjectOptions

interface GenerateObjectOptions<T extends ZodType> {
  schema: T;
  prompt: string;
  model: ModelSelection;
  local: LocalOptions;
  systemPrompt?: string;
  apiKey?: string;
  maxRetries?: number; // default 1 (initial attempt + 1 retry)
}

GenerateObjectResult

interface GenerateObjectResult<T> {
  object: T;                  // z.infer<schema>
  raw: unknown;               // pre-parse capture
  usage: { inputTokens: number; outputTokens: number };
  finishReason: "tool_use" | "error";
}

GenerateObjectError

class GenerateObjectError extends Error {
  readonly code: "no_tool_call" | "parse_failed";
  readonly cause?: unknown;
}
Thrown when (1) the model returns plain text instead of calling the `output` tool after all retries, or (2) the Zod parse fails after all retries. Always extends `Error`. `cause` carries the last `z.ZodError` for `parse_failed`.

Notes:
- `zod` is an OPTIONAL peer dependency. The SDK loads it lazily via `createRequire`; if missing, `ConfigurationError(code: "zod_not_installed")` is thrown.
- Only the local runtime is supported in v1.1. The transient agent runs in your Node process — no cloud runtime is created.
- The same provider routing and fallback as `agent.send` applies (configure via `local.providers` or env keys).
- The schema can be `z.object(...)`, `z.array(...)`, `z.discriminatedUnion(...)`, etc. Anything Zod can stringify to JSON Schema works.

AgentOptions.telemetry
Opt-in OpenTelemetry instrumentation for `agent.send`, `llm.call`, and `tool.call` (ADR D34). Spans only emit when `@opentelemetry/api` is installed AND `telemetry.enabled === true`. Loaded lazily via `createRequire` — no runtime overhead and no peer-dep installation required to use the SDK.


import { Agent } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  telemetry: {
    enabled: true,
    exporter: "console",        // or "otlp" — or pass your own SDK
    serviceName: "my-bot",       // default: "theokit-sdk"
    includeContent: false,        // privacy default — only timing/counts emitted
  },
});

TelemetrySettings

interface TelemetrySettings {
  enabled: boolean;
  includeContent?: boolean;     // default false (privacy-by-default)
  exporter?: "console" | "otlp" | unknown;
  serviceName?: string;
}

Spans emitted:

| Span | Attributes |
|------|------------|
| `agent.send` | `agent.id`, `agent.runtime` (local|cloud), `run.id` |
| `llm.call`   | `llm.model`, `llm.provider`, `llm.stop_reason`, `llm.input_tokens`, `llm.output_tokens` |
| `tool.call`  | `tool.name`, `tool.origin` (custom|mcp|builtin), `tool.exit_code` |

Privacy contract:
- `includeContent: false` (default) — span attributes carry counts, IDs, status codes, model name. NO prompt content, NO LLM completion text, NO tool input/output payloads.
- `includeContent: true` — adds `llm.prompt`, `llm.completion`, `tool.input`, `tool.output` (truncated to 4 KB per attribute). Use with care; never enable in production logs without redaction at the exporter.

Resilience:
- All OTel calls are wrapped in a `safe()` helper. If the exporter throws or the OTel SDK misbehaves, the error is swallowed — `agent.send` NEVER fails because of telemetry.
- Open spans owned by an agent are tracked per-handle and closed in `agent.dispose()` so a missing finish event from a cancelled run does not leak.

React helpers — moved to `@theokit/react` (separate repo `theokit-react`)
The React hooks (`useTheoChat`, `useTheoCompletion`, `useTheoAssistant`) and the
`streamTheoChat` / `streamCompletion` / `streamAssistant` server handlers were extracted
to the standalone `@theokit/react` package (repo `theokit-react`) — plan monorepo-cohesion-split.
They consume `@theokit/sdk` as a published dependency. See that repo's README for the API.

Agent.streamObject() (v1.2+)
Streams a typed object alongside intermediate partial deltas as the model produces it. Same synthetic-forced-tool pattern as `Agent.generateObject` (ADR D33), but exposed as an `AsyncIterator<StreamObjectEvent<T>>` so consumers can render partial state as it arrives. ADR D39.


import { z } from "zod";
import { Agent } from "@theokit/sdk";

const FactCard = z.object({
  title: z.string().min(1),
  summary: z.string(),
  year: z.number().nullable(),
});

for await (const evt of Agent.streamObject({
  apiKey: process.env.THEOKIT_API_KEY,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  schema: FactCard,
  prompt: "Produce a fact card about: jazz music.",
})) {
  if (evt.type === "partial") render(evt.partial); // best-effort snapshot
  if (evt.type === "complete") finalize(evt.object); // z.infer<typeof FactCard>
}

StreamObjectEvent

type StreamObjectEvent<T> =
  | { type: "partial"; partial: DeepPartial<T>; attempt: number }
  | { type: "complete"; object: T; raw: unknown; usage; finishReason: "tool_use" | "error" };

Notes:
- The `complete` event always fires (or the iterator throws `StreamObjectError`). Partials are best-effort — providers that batch output (e.g., Anthropic in some modes) may emit zero partials.
- The transient agent created behind the scenes is disposed AND hard-deleted from the registry in the iterator's `finally` block — including when the consumer calls `iter.return()` mid-stream (EC-4).
- Same retry semantics as `generateObject`: `maxRetries` (default 1), `StreamObjectError(code: "no_tool_call" | "parse_failed")` taxonomy.
- The `complete.object` is identical to what `Agent.generateObject` would return for the same input — verified by compat test.

MCP OAuth 2.1 (v1.2+)
HTTP MCP servers can declare `auth.oauth` to opt into PKCE authentication. ADR D41.


import type { McpServerConfig } from "@theokit/sdk";

const notionMcp: McpServerConfig = {
  type: "http",
  url: "https://mcp.notion.com/sse",
  auth: {
    CLIENT_ID: process.env.NOTION_OAUTH_CLIENT_ID!,
    scopes: ["read"],
    oauth: {
      authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
      tokenEndpoint: "https://api.notion.com/v1/oauth/token",
      redirectMode: "localhost", // or "manual" for SSH/headless dev
    },
  },
};

McpOAuthConfig

interface McpOAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectMode: "manual" | "localhost";
  localhostPort?: number;  // 0 = random free port (default)
  timeoutMs?: number;       // default 300_000 = 5min
}

Token storage:
- Preferred: OS keychain via `keytar` (macOS Keychain / Windows Credential Manager / Linux libsecret). Install with `pnpm add keytar`.
- Fallback: `~/.theokit/mcp-tokens.json` with `chmod 600` (POSIX). Windows file fallback has no chmod equivalent — documented gotcha (EC-14).

CSRF protection:
- `state` parameter is generated per flow and validated on callback. Mismatch → `ConfigurationError(code: "oauth_state_mismatch")`. (EC-2 MUST FIX)

Refresh:
- Automatic on 401 from the MCP endpoint. Concurrent refreshes are serialized per server name to avoid `invalid_grant` from duplicate exchanges (EC-9).
- Token endpoint without `expires_in` → default conservative 3600s (RFC 6749 §5.1) (EC-10).

Telemetry auto-instrumentation (v1.2+)
When `telemetry.enabled: true`, the SDK feature-detects installed observability libs and auto-registers OTel exporters. Zero config required — install Langfuse/Sentry/PostHog, set their env keys, spans appear. ADR D42.

Supported (auto-detected via `createRequire`):
- `@langfuse/node` v3+ → `LangfuseSpanProcessor` (env: `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`)
- `@sentry/node` → event processor enriching events with OTel trace context
- `posthog-node` → custom SpanProcessor capturing `agent.send` / `llm.call` / `tool.call` events (env: `POSTHOG_API_KEY`)

Opt-out:

const agent = await Agent.create({
  telemetry: {
    enabled: true,
    autoDetect: false,             // disable ALL auto-instrumentation
    disable: ["langfuse"],          // OR per-adapter opt-out (case-insensitive)
  },
});

EC-12 (double-billing prevention): if you've already wired Langfuse manually before creating the agent, auto-instrumentation detects the existing processor and skips.

Memory backends (v1.2+)
Memory.index now accepts `backend: "sqlite-vec" | "lance"` (default `"sqlite-vec"`). ADR D43.


import { Memory } from "@theokit/sdk";

const memory = await Memory.create({
  cwd: process.cwd(),
  index: {
    backend: "lance",  // use @lancedb/lancedb for >100k facts
    embedding: { provider: "openai", model: "text-embedding-3-small" },
  },
});

Notes:
- `@lancedb/lancedb` is an OPTIONAL peer dep. If missing + `backend: "lance"` → `ConfigurationError(code: "lance_backend_unavailable")` with install instructions.
- Filters use Lance's structured filter API (object form) — NEVER string interpolation. SQL injection via namespace is impossible (EC-1 MUST FIX).
- Embedding dimension is validated when opening an existing Lance index. Mismatch (e.g., switching from OpenAI to Voyage) → `ConfigurationError(code: "embedding_dimension_mismatch")` (EC-8).

Migration CLI: `theokit-migrate-memory` (v1.2+)
Migrate an existing SQLite memory index to LanceDB without data loss. ADR D44.


# Dry-run first (preview, no writes)
pnpm exec theokit-migrate-memory --cwd . --dry-run

# Real migration with confirmation prompt
pnpm exec theokit-migrate-memory --cwd .

Algorithm:
1. Read all facts from `.theokit/memory/index.sqlite`.
2. Write to staging dir `.theokit/memory/lance-new/`.
3. Validate: count match + sample-of-10 NFC unicode-normalized text match (EC-3 MUST FIX — facts in pt-BR/zh/ja with accents/emojis migrate correctly).
4. On success: rename `lance-new/` → `lance/` (atomic commit).
5. Prompt to delete SQLite db (skip with `--keep-sqlite`).
6. On validation failure: leave SQLite intact, remove `lance-new/`.

Options:
- `--cwd <path>` — workspace directory (default: cwd)
- `--dry-run` — read SQLite, validate counts, but DO NOT write Lance
- `--keep-sqlite` — skip the delete-SQLite prompt
- `--batch-size <n>` — migration batch size (default: 100)

Errors
All SDK errors extend TheoAgentError. Use isRetryable to drive retry logic, or the `isTransientError(err: unknown): boolean` helper (exported from `@theokit/sdk`) which returns the SDK's retryability verdict for any caught value (`false` for non-SDK errors; never inspects the message).


class TheokitAgentError extends Error {
  readonly isRetryable: boolean;
  readonly code?: string;
  readonly cause?: unknown;
  readonly protoErrorCode?: string;
  readonly metadata?: ErrorMetadata; // populated for provider HTTP errors (v1.3+)
}

interface ErrorMetadata {
  provider: string;          // "anthropic" | "openai" | "openrouter" | ...
  endpoint: string;          // "/v1/messages" | "/v1/chat/completions" | ...
  code: ErrorCode;           // finite enum — see below
  statusCode?: number;       // HTTP status if applicable
  retryAfter?: number;       // seconds (only when provider returns numeric retry-after)
  raw?: unknown;             // raw response body (truncated to ~2KB)
}

type ErrorCode =
  | "rate_limit"
  | "auth_failed"
  | "invalid_request"
  | "timeout"
  | "server_error"
  | "context_too_long"
  | "content_filtered"
  | "model_unavailable"
  | "network"
  | "unknown";

Error	When
AuthenticationError	Invalid API key, not logged in, insufficient permissions (HTTP 401/403).
RateLimitError	Too many requests or usage limits exceeded (HTTP 429).
ConfigurationError	Invalid model, bad request parameters (HTTP 400; covers context_too_long, content_filtered, model_unavailable).
IntegrationNotConnectedError	Creating a cloud agent for a repo whose SCM provider is not connected.
NetworkError	Service unavailable, timeout (HTTP 5xx / 408).
UnknownAgentError	Catch-all for unclassified server or runtime errors.

### Error context (v1.3+)

When an error originates from a provider HTTP call, the SDK populates a typed `metadata` field on the thrown error so callers can react programmatically without parsing strings:

```typescript
try {
  await agent.send("...");
} catch (err) {
  if (err instanceof TheokitAgentError && err.metadata !== undefined) {
    switch (err.metadata.code) {
      case "rate_limit":
        await wait(err.metadata.retryAfter ?? 60);
        return retry();
      case "auth_failed":
        throw new Error(`Check your API key for ${err.metadata.provider}`);
      case "context_too_long":
        // trigger compression / shorter prompt
        break;
      case "content_filtered":
      case "model_unavailable":
      case "invalid_request":
      case "timeout":
      case "server_error":
      case "network":
      case "unknown":
        throw err;
    }
  }
  throw err;
}
```

#### Scope and known caveats

The following are documented design choices from the edge-case review (2026-05-18). Intentional limitations of v1.3:

- **Mid-stream errors are NOT routed through provider mappers** (EC-7). The mapper only handles `!response.ok` (pre-stream HTTP errors). When an SSE stream fails AFTER the initial 200 OK (e.g., upstream timeout mid-token), the error path stays in the original streaming flow — no `metadata` populated. A separate mid-stream error surface lands in v1.4.

- **`UnsupportedRunOperationError` does not carry `metadata`** (EC-10). This subclass is thrown when a consumer calls a `Run` operation not supported by the current runtime — not an HTTP error. `err.metadata` will be `undefined`. By design.

- **`IntegrationNotConnectedError` has its own `provider` field separate from `metadata.provider`** (EC-9). Backward compat preserves the existing `err.provider` (public field, used by callers since pre-v1.3). The new `err.metadata?.provider` is populated when the error originated from an HTTP call. Two fields with similar name on one error instance — read `err.provider` first for connection-state semantics; `err.metadata?.provider` is HTTP-origin metadata.

- **`cause` chain depth is not capped** (EC-6). Errors may wrap multiple times: fetch err → mapper err → router err → caller err. ES2022 `cause` is supported in Node 20+ and you can walk it manually. Stack traces can be long; no native limiter.

- **Embedding `parseEmbedResponse` "no data" maps to `code: "invalid_request"`** (EC-8). Semantically it's "invalid response" from provider, but the `ErrorCode` enum does not yet have that exact label. Closest existing code wins. A future release may add `"invalid_response"` if usage justifies.
IntegrationNotConnectedError

class IntegrationNotConnectedError extends ConfigurationError {
  readonly provider: string;   // e.g. "github", "gitlab", "azuredevops"
  readonly helpUrl: string;    // dashboard link to reconnect
}
Use helpUrl to point the user at the right reconnect flow. New providers will be added without an SDK release.

UnsupportedRunOperationError

class UnsupportedRunOperationError extends TheoAgentError {
  readonly operation: RunOperation;
}
Thrown when a Run or agent operation is not available on the current runtime. Extends `TheoAgentError` with `isRetryable: false` and `code: "unsupported_run_operation"`. Use `run.supports(operation)` and `run.unsupportedReason(operation)` to check before calling. The `operation` field includes Run operations (`stream`, `wait`, `cancel`, `conversation`) and agent-level operations (`listArtifacts`, `downloadArtifact`).

Known limitations
Inline mcpServers are not persisted across Agent.resume(). Pass them again on resume if needed.
Artifact download is not implemented for local agents (agent.listArtifacts() returns an empty list and agent.downloadArtifact() throws).
local.settingSources (and the file-based MCP / subagent paths it gates) does not apply to cloud agents. Cloud always loads project / team / plugins.
Hooks are file-based only (`.theokit/hooks/<name>.md`; legacy `.theokit/hooks.json` deprecated). No programmatic callbacks.
Inline memory, context, and skill config should be treated as process-local unless documented otherwise. Durable behavior comes from memory stores and committed file-based context / skills.
Skill prompt bodies are not stable public output. Use `agent.skills.list()` for metadata and avoid scraping streams for full skill text.

## Security — secret redaction (v1.3+)

Every output boundary the SDK controls — thrown errors (`metadata.raw`), telemetry span attributes, transcript JSONL appends, migration logger output — passes through a canonical redactor before persisting or emitting. Builtin patterns cover 12 well-known credential prefixes (OpenAI `sk-`, Anthropic `sk-ant-`, GitHub PAT classic + fine-grained, GitLab `glpat-`, AWS `AKIA`, Google `AIza`, Slack `xox*-`, Sentry `sntrys_`, Stripe `sk_live_` / `rk_live_`) plus a parametric `key=value` matcher that masks `access_token=`, `api_key=`, `password=`, `x-api-key=`, and `Authorization: Bearer <token>` in URLs, JSON bodies, and HTTP headers.

```typescript
import { Security } from "@theokit/sdk";

// Add a custom pattern (e.g., org-internal token shape):
Security.addPattern(/MYORG-[A-Z0-9]{32}/g);

// Subsequent error metadata, telemetry attrs, transcript lines, migration
// logs containing `MYORG-AAAA...AAAA` will have it masked alongside
// builtin patterns.
```

**Two-bucket masking.** Tokens shorter than 18 characters are fully replaced with `***`; longer tokens preserve a 6-character prefix and a 4-character suffix (`sk-abc...wxyz`). The preserved bookends help operators tell two leaked keys apart in incident reports without revealing the secret middle.

**Default ON, opt-out via env.** Redaction is enabled by default. Set `THEOKIT_REDACT_SECRETS=false` to disable; the SDK prints a one-time warning to stderr so the operator knows the process is vulnerable. The env var is snapshotted at module init — runtime mutation (e.g., via a prompt-injection that runs `process.env.THEOKIT_REDACT_SECRETS = "false"`) cannot disable it.

**What is NOT redacted.** Redaction applies on *egress*, never on storage. Agent runtime memory, in-process state, and files written with explicit acceptance (such as `.env` files the user creates) are left alone. The principle is "store originals; redact on each output".

**Coverage limits.** Custom credentials that lack a structural marker (e.g., free-form passwords inside arbitrary prose like "the password is hunter2") are NOT detected. Add an `addPattern` matcher when you ship a new internal token shape. Base64-encoded or URL-encoded credentials may slip through built-in patterns; report a missed shape and we'll extend the list.

## Security — path traversal + TOCTOU (v1.6+)

Every callsite that joins user-supplied input with a path passes through a canonical guard (ADRs D79-D85). The SDK ships four primitives and two typed errors. From v1.x they are part of the **public API** via the `@theokit/sdk/path-safety` sub-export, so consumer agents (TheoKit Studio, cli-bot, custom coding agents) can validate user-supplied paths without reinventing the guard.

**Path traversal defense:**

- `safePathJoin(base, ...parts)` — resolves the path THEN prefix-checks against `base`. Throws `PathTraversalError` (extends `ConfigurationError` with code `"path_traversal"`) if the resolved target escapes. Defeats literal `..`, normalized escape (`subdir/.\\./..`), absolute segment overrides, and null-byte injection.
- `assertNoSymlinkEscape(path, base)` — uses `realpathSync` to follow the entire symlink chain (multi-level A → B → C) and reject targets outside `base`.
- `isForbiddenPath(input)` (v1.x+) — universal blocklist for coding agents. Returns `true` for `.env*` (except `.env.example`), `.git/**`, `node_modules/**`, `.theo/**`, and lock files (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`). Cross-platform: backslashes normalised before matching.
- `sanitizeIdentifier(input, { maxLen })` — strict grammar `^[a-z0-9][a-z0-9-_]*$` (case-insensitive on input, lowercase on output). Rejects path separators, `..`, leading `-`/`_`, control chars. Default `maxLen` is 64; agent IDs use 128. (Still `@internal` — used by SDK identifier surfaces.)
- `safeFilenameForId(id, { maxLen })` — total id→filename helper (public via `@theokit/sdk/path-safety`). Unlike `sanitizeIdentifier`, it NEVER throws on a non-empty string: it returns the lowercased id when it already matches the safe grammar (UUIDs/hashes/slugs stay readable) and a deterministic `h-<16 hex>` sha256 token otherwise. Output charset is always `[a-z0-9_-]`. Default `maxLen` is 128. Use it to turn arbitrary opaque ids (run ids, emails, namespaces) into safe path segments.

Wired in: `plugins-manager` (plugin entry files), `agent-session-store` (session JSONL paths), `skills-manager` (skill directory entries), `legacyMemoryJsonPath` (memory namespace/scope/userId), `mcp/client` (MCP stdio `cwd` for relative paths). CI lint gate `tests/lint/no-unguarded-path-input.test.ts` flags regressions.

**TOCTOU defense:**

- `createExclusive(path, data, { mode })` — atomic create-if-absent via `O_EXCL` (`open(path, "wx", mode)`). Default mode is `0o600` (owner-only) — token files, lockfiles, PID files must not default to world-readable. Returns `true` if created, `false` if it already existed.
- `casUpdate(db, sql, params, expectedChanges)` — SQLite optimistic compare-and-swap. Caller writes the full SQL (including `WHERE version = ?` predicate); helper executes and returns boolean based on `result.changes`. Caller handles retry/backoff. Canonical pattern: `UPDATE registry SET status = ?, version = version + 1 WHERE id = ? AND version = ?`.

```typescript
import {
  safePathJoin,
  assertNoSymlinkEscape,
  isForbiddenPath,
  PathTraversalError,
  ForbiddenPathError,
} from "@theokit/sdk/path-safety";

// Inside a custom tool handler:
function readUserFile(projectRoot: string, userPath: string): string {
  if (isForbiddenPath(userPath)) {
    throw new ForbiddenPathError(userPath); // .env, .git/, etc.
  }
  const safe = safePathJoin(projectRoot, userPath);
  assertNoSymlinkEscape(safe, projectRoot); // EC-1 — symlink chain check
  return readFileSync(safe, "utf-8");
}

// At the catch boundary:
try { /* ... */ } catch (err) {
  if (err.code === "path_traversal") { /* user input tried to escape */ }
  else if (err.code === "forbidden_path") { /* sensitive file blocked */ }
  else if (err.code === "invalid_identifier") { /* grammar failed */ }
}
```

Adversarial coverage: ~1200 random inputs via `fast-check` cover 5 traversal vector families + identifier grammar surface. `isForbiddenPath` adds a 15-case suite covering each blocklist family + cross-platform path normalisation.

#### Concurrency — `@theokit/sdk/concurrency`

In-house bounded-concurrency primitives (no `p-limit`/`p-map` dependency), public from the `@theokit/sdk/concurrency` sub-path so agent builders bound parallel work without re-implementing a pool:

- `createSemaphore(permits)` — N-permit async-aware counting semaphore. `acquire()` returns a release function (call once, typically in `finally`). Release is idempotent.
- `mapWithConcurrency(items, concurrency, fn, { signal? })` — map `fn` over `items` with at most `concurrency` invocations in flight, **preserving input order** in the result array. Fail-fast (rejects with the first task error); an aborted `signal` stops new work from starting. Throws `ConfigurationError` (`invalid_concurrency`) when `concurrency` is not a positive integer.

```ts
import { mapWithConcurrency } from "@theokit/sdk/concurrency";

const results = await mapWithConcurrency(urls, 4, (url) => fetchJson(url)); // ≤4 in flight, ordered
```

## Built-in tools for coding agents (v1.x+)

Drop-in toolkit available at `@theokit/sdk/tools`. Each factory takes `{ projectRoot }` and returns a `CustomTool` ready to plug into `Agent.create` or `createAgentFactory({ tools: [...] })`. All five share the same three rules:

1. **Project-scoped.** Every I/O call passes through `safePathJoin` + `assertNoSymlinkEscape`.
2. **Sensitive files refused.** `.env*` (except `.env.example`), `.git/`, `node_modules/`, `.theo/`, lock files via `isForbiddenPath`.
3. **JSON returns, never throws on user mistakes.** Handlers always return a JSON string. Real exceptions reserved for SDK-side bugs (input parse errors).

```typescript
import { createAgentFactory } from "@theokit/sdk";
import {
  createReadFileTool,
  createListDirTool,
  createSearchTextTool,
  createGitDiffTool,
  createRunVitestTool,
} from "@theokit/sdk/tools";

const projectRoot = process.cwd();
const factory = createAgentFactory({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: { id: "claude-3-5-sonnet-20241022" },
  systemPrompt: "You are a coding agent. Use the tools.",
  tools: [
    createReadFileTool({ projectRoot }),
    createListDirTool({ projectRoot }),                       // default max=500
    createSearchTextTool({ projectRoot, maxMatches: 100 }),
    createGitDiffTool({ projectRoot, timeoutMs: 30_000 }),
    createRunVitestTool({ projectRoot, timeoutMs: 120_000 }), // EC-12 stdout parser
  ],
});
```

**Tool reference:**

| Tool | Returns |
|---|---|
| `read_file` | `{ ok, content, size }` or `{ ok: false, error: 'path_traversal' \| 'forbidden_path' \| 'binary_file' \| 'not_found' \| 'too_large' }` |
| `list_dir` | `{ ok, entries: [{ name, type }], truncated, totalCount }` or `{ ok: false, error }` |
| `search_text` | `{ ok, matches: [{ file, line, preview }], truncated, totalMatches }` or `{ ok: false, error }` |
| `git_diff` | `{ ok, diff, truncated }` or `{ ok: false, error: 'not_a_repo' \| 'timeout' \| 'git_failed' \| 'path_traversal' }` |
| `run_vitest` | `{ ok, summary: { numTotalTests, numPassedTests, numFailedTests, success } }` or `{ ok: false, error: 'no_vitest' \| 'timeout' \| 'unparseable_output' \| 'path_traversal' \| 'forbidden_path' }` |

**Hardening notes:**

- `read_file` rejects binary files via null-byte detection in the first 8 KB. Caps at 5 MB.
- `list_dir` caps at 500 entries by default (`max` override available). Result carries `truncated + totalCount` so the agent can decide to refine.
- `search_text` skips binary files (same 8 KB probe), files > 1 MB, and forbidden dirs (so the agent never burns context on `node_modules/`).
- `git_diff` and `run_vitest` spawn in a detached process group (`detached: true`); on timeout they kill the whole group (`process.kill(-pid, SIGKILL)`) so vitest workers / git subprocesses don't survive as zombies.
- `run_vitest` parses stdout bottom-up to extract the last valid JSON line — node deprecation warnings that vitest prepends are skipped.

44 tests cover the five tools end-to-end (each tool's safety boundaries, happy paths, and hardening modes) + 5 smoke tests pinning the public barrel exports.

## Configuration files (v1.5+)

User-edited config files in `.theokit/` use **markdown + YAML frontmatter** — same shape as `skills/<name>/SKILL.md`, Claude Code commands, and Cursor rules. One file per entity gives per-entity git diff, prose body for rationale ("why this hook exists"), and type-safe frontmatter via Zod.

```
.theokit/
├── hooks/                         # one .md per hook (ADR D74)
│   └── shell-policy.md
├── context/                       # one .md per context source
│   └── bot-readme.md
├── plugins/<name>/                # PLUGIN.md per plugin (nested)
│   └── PLUGIN.md
└── skills/<name>/SKILL.md         # unchanged; already markdown
```

Example hook:

```markdown
---
event: preToolUse
matcher: ^shell$
command: node .theokit/policy.js
---

# Shell tool policy gate

Vets shell tool invocations before spawn. Reason: multi-user chat can't
trust arbitrary shell calls.
```

**Migration.** A standalone CLI converts legacy `.theokit/hooks.json` /
legacy `.theokit/context.json` / legacy `.theokit/plugins/<name>/plugin.json`
to the markdown form:

```bash
npx theokit-migrate-config --apply
```

Dry-run by default; `--apply` writes. Backs up originals to
`<file>.json.<unix-ts>.bak` and uses atomic writes (crash mid-write
leaves previous MD files intact).

**Backward compatibility.** The legacy JSON shape still works in v1.x —
if the MD directory is absent or empty, the SDK falls back to the JSON
file and emits a one-time stderr deprecation warn pointing at
`theokit-migrate-config`. **JSON is removed in v2.0 (planned Q2 2027).**

**Restart required after migration.** A long-running bot process holds
the old config in memory until restarted. Run the CLI when the bot is
stopped, or stop + start after migration.

**Disabling an entry.** Rename `<name>.md` → `<name>.md.disabled`
(suffix sits outside the `.md` match) — the loader silently skips it.
Same effect as `enabled: false` in frontmatter but avoids editing the
file.

## Local models — Ollama (v1.14+)

The SDK ships **Ollama as a builtin provider** (ADR D182). After
`ollama serve` is running, point your agent at any local model with
**zero configuration**:

```typescript
import { Agent } from "@theokit/sdk";

// 1) Start Ollama (one-time, in another terminal):
//      ollama serve
// 2) Pull a model:
//      ollama pull llama3.2
// 3) Use it from the SDK:
const agent = await Agent.create({
  model: "ollama/llama3.2",
});

await agent.send("Explain dependency injection in two sentences.");
```

No API key is required for local Ollama. The provider profile declares
`authType: "none"` and the router forwards a placeholder bearer token —
local Ollama ignores the `Authorization` header.

**Overrides for advanced setups:**

| Env var | Purpose | Default |
| --- | --- | --- |
| `OLLAMA_HOST` | Base URL of the Ollama server (use this when Ollama runs on a different machine). | `http://localhost:11434` |
| `OLLAMA_API_KEY` | Bearer token forwarded in the `Authorization` header. Set this when you run Ollama Cloud or put Ollama behind a reverse-proxy with auth. | (none) |

```bash
# Point at a remote Ollama box:
export OLLAMA_HOST=http://192.168.1.50:11434

# Or use Ollama Cloud (paid tier with auth):
export OLLAMA_API_KEY=sk-ollama-cloud-token
```

**Fallback chain.** Ollama works as a primary or a fallback provider:

```typescript
const agent = await Agent.create({
  model: "anthropic/claude-3-5-sonnet-latest",
  providerRouting: {
    fallback: ["ollama/llama3.2"], // local fallback if Anthropic is down
  },
});
```

**Tool calling and streaming.** Ollama exposes the OpenAI-compatible
`/v1/chat/completions` endpoint, so the SDK reuses the same transport
used for OpenAI and OpenRouter — streaming, tool calls, and finish
reasons all work the same way. Tool-calling quality depends on the
underlying model (Llama 3.1+, Mistral, Qwen2.5 work well; older models
may not).

## Eval suite (v1.15+) — `Eval.create / .run`

Eval-as-code primitive for production deploy gates. ADRs D202-D213.

```typescript
import { Eval, Scorers } from "@theokit/sdk";

const run = await Eval.create({
  name: "qa-smoke",
  dataset: [
    { input: "Reply with the word: ok.", expected: "ok" },
    { input: "Say jazz in one word.", expected: "jazz" },
  ],
  scorers: [
    Scorers.containsExpected({ caseSensitive: false }),
    Scorers.regex(/[a-zA-Z]/),
  ],
  agent: {
    apiKey: process.env.OPENROUTER_API_KEY,
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
  },
  concurrency: 4,
}).run();

console.log(run.aggregate.meanScore);     // 0.95
console.log(run.aggregate.passRatio);     // 1.0 (rows with meanScore >= 0.5)
console.log(run.aggregate.tokensInTotal); // 142 (cost forecasting input)
console.log(run.aggregate.durationMsP95); // 1830 (latency tail)
```

### Built-in scorers (`Scorers`)

| Scorer | Purpose | EC notes |
|---|---|---|
| `Scorers.exactMatch({ caseSensitive? })` | `output.trim() === expected.trim()` | EC-1: refuses empty expected |
| `Scorers.containsExpected({ caseSensitive? })` | `output.includes(expected)` | EC-1: refuses empty expected |
| `Scorers.regex(pattern)` | `pattern.test(output)` | EC-10: user-supplied pattern; test against adversarial outputs to avoid ReDoS |
| `Scorers.jsonShape(zodSchema, { strict? })` | `JSON.parse(output)` + Zod validation | EC-2: caps output at 1 MB before parse |
| `Scorers.llmJudge({ model, apiKey, criteria, rubric? })` | Second LLM scores against criteria | EC-12: doubles per-row cost; requires SEPARATE apiKey (D205) |

### `EvalRun` shape

```typescript
interface EvalRun {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  aggregate: EvalAggregate;
  rows: ReadonlyArray<EvalRowResult>;
  metadata?: Record<string, unknown>;
}

interface EvalAggregate {
  meanScore: number;
  medianScore: number;
  passRatio: number;          // rows where meanScore >= 0.5
  perScorer: Record<string, { mean; median; min; max }>;
  totalRows: number;
  errorRows: number;
  durationMsP50: number;
  durationMsP95: number;
  tokensInTotal: number;      // EVAL agent's tokens (not judge's)
  tokensOutTotal: number;
}
```

`EvalRun` is plain JSON (D209) — `JSON.stringify(run)` direct, no class methods.

### Scale & cost

- **Dataset size:** v1 materializes the dataset in memory before fanout.
  Recommended ceiling: ~10k rows. For larger evals, partition into multiple
  `Eval.run` calls or wait for streaming aggregate (v2). [EC-11]
- **Cost forecasting:** `aggregate.tokensInTotal × provider_input_price`
  + `aggregate.tokensOutTotal × provider_output_price`. With `llmJudge`,
  add ~1 judge call per row (`gpt-4o-mini` baseline: $0.15/$0.60 per
  million in/out tokens at 2026 rates). 1000 rows × gpt-4o-mini ≈ $1.50
  base + $1.50 judge = $3.00 total.

### Concurrency

`EvalOptions.concurrency` defaults to 4 (matches `Agent.batch` D136).
Allowed range: `[1, 64]` integer (EC-3 — 0 deadlocks the semaphore,
Infinity DoSs the provider; both rejected at `Eval.create` time).

### CLI integration

The `theokit eval` CLI (D199 → D212) now invokes `Eval.run` internally.
User-authored `eval.config.{ts,mjs}` files are forward-compatible — the
public `EvalConfig` shape is a subset of `EvalOptions`.

### Telemetry

When `agent.telemetry.enabled === true`, `Eval.run` emits a parent
`eval.run` OTel span; existing `agent.send` / `llm.call` spans nest
under it (D206). OTel is loaded lazily via `@opentelemetry/api` peer
dep — no install required when telemetry is off.

### Concurrent runs

Per-process single-flight per name (D213). Two `Eval.run` calls with the
same `name` running at the same time throw `EvalAlreadyRunningError`.
Use unique names per matrix run (e.g. include model id in name).

## Agent handoffs (v1.16+) — `handoffs[]` + `Handoff.create`

Peer-to-peer agent handoff primitive. ADRs D214-D229.

```typescript
import { Agent, Handoff, RECOMMENDED_HANDOFF_PROMPT_PREFIX } from "@theokit/sdk";

const billing = await Agent.create({
  name: "billing",
  systemPrompt: "You handle billing questions.",
  model: { id: "openai/gpt-4o-mini" },
  apiKey: process.env.OPENROUTER_API_KEY,
});

const triage = await Agent.create({
  name: "triage",
  systemPrompt: `${RECOMMENDED_HANDOFF_PROMPT_PREFIX}
You classify the user's intent and transfer to the right specialist.`,
  model: { id: "openai/gpt-4o-mini" },
  apiKey: process.env.OPENROUTER_API_KEY,
  handoffs: [
    billing,                                                     // auto-wrapped
    Handoff.create(supportAgent, { inputFilter: redactCC }),    // customized
  ],
  maxHandoffDepth: 5,
});

const run = await triage.send("Why was I charged twice?");
const result = await run.wait();
// result.result contains the receiver's reply (billing agent answered).
```

### Pattern: handoff-as-tool (D214)

Each entry in `handoffs[]` becomes a synthetic `transfer_to_<name>` function
tool exposed to the LLM (default name; override via `{ toolName }`). The LLM
decides when to invoke based on the user's request; the runtime dispatches
to the receiver, which produces the actual reply.

### `Handoff.create(target, options?)` — D222

| Option | Purpose |
|---|---|
| `toolName?` | Override the default `transfer_to_<receiver>` name |
| `toolDescription?` | Override the synthetic tool description |
| `onHandoff?(ctx, parsed)` | Side-effect callback **OR** validation gate — throw aborts (D227) |
| `inputType?: ZodType` | Structured payload schema for the handoff tool call (D223) |
| `inputFilter?(history)` | Filter conversation history passed to receiver (D219); throw → fallback to full history (D228) |
| `tools?: string[]` | Restrict receiver tools for the post-handoff turn (D224) |
| `isEnabled?: boolean \| (ctx) => boolean` | Dynamic enable/disable predicate |

### Loop protection (D218 + D221)

Two layers protect against runaway chains:

- **`maxHandoffDepth`** (default 5): cumulative hops per `send()`. Throws `HandoffLoopError(depth, chain)` when exceeded. Set to `0` to disable handoffs entirely.
- **Pair single-flight (D221)**: same `(sender, receiver)` pair within one `send()` throws `HandoffPairLoopError`. A→B→A is caught at the second hop with a clear diagnostic.

### Cost tradeoff for long chains

Default = full history transferred to receiver (D216). For depths > 2,
add `inputFilter` to summarize / truncate — token cost multiplies per hop:

```typescript
Handoff.create(escalation, {
  inputFilter: (h) => ({ messages: h.messages.slice(-3) }),  // last 3 only
});
```

### Imperative escape hatch (D225)

`handoffTo(sender, target, message, options?)` is the standalone helper for
programmatic flows / tests:

```typescript
import { handoffTo } from "@theokit/sdk";

const reply = await handoffTo(triage, billing, "Why was I charged twice?");
```

### Errors

| Error | When |
|---|---|
| `HandoffLoopError` | Chain depth exceeded `maxHandoffDepth` |
| `HandoffPairLoopError` | Same `(sender, receiver)` pair invoked twice in one `send()` |
| `HandoffSelfReferenceError` | Agent has itself in `handoffs[]` (caught at `Agent.create`) |
| `HandoffNameCollisionError` | Two handoffs share the same resolved tool name |
| `HandoffReceiverDisposedError` | Receiver disposed before dispatch attempt |

### Model quality dependency

Handoffs require reliable function-calling. `gpt-4o-mini` / `claude-3-5-haiku`
work excellently; local models < 7B params often skip the transfer tool. See
`examples/handoffs/README.md` for the full compatibility table.

### Telemetry (D220)

When OTel is available and agent telemetry is enabled, each handoff emits a
`handoff.transfer` span with attributes `handoff.from`, `handoff.to`,
`handoff.reason`, `handoff.depth`, `handoff.tool_name`.

## Squad (sequential agent teams) — `createSquad`

`createSquad` is a thin convenience for the common "run a team of agents in
order" case. It **composes `Workflow` + `agentStep`** under the hood — it adds
no new orchestration engine. Each agent's output is threaded into the next
agent's prompt; `run()` returns the final result plus a per-agent trace.

```typescript
import { Agent, createSquad } from "@theokit/sdk";

const researcher = await Agent.create({ /* ... */ });
const writer = await Agent.create({ /* ... */ });
const editor = await Agent.create({ /* ... */ });

const squad = createSquad({ agents: [researcher, writer, editor] }); // process defaults to "sequential"
const run = await squad.run("Write a post about TypeScript agents.");
console.log(run.result);  // final (editor's) output
console.log(run.steps);   // StepResult[] — one per agent
```

- **Sequential is the only `createSquad` process.** For branching/parallel/foreach
  teams use `Workflow` + `agentStep` directly (more expressive). For
  manager→worker delegation use **subagents** or **`@theokit/sdk-handoff`** —
  passing `process: "hierarchical"` throws a `ConfigurationError` pointing you
  there.
- Invalid input fails fast: empty `agents` → `ConfigurationError(code: "invalid_squad")`.

## Decorator-driven workflows — moved to `@theokit/di-agent` (repo `theokit-di`)

The decorator authoring style (`@Workflow` + `@Step` + `buildWorkflow`, and `@Squad`) was
extracted to `@theokit/di-agent` in the `theokit-di` repo (plan monorepo-cohesion-split;
ADR D431 made decorators an optional layer, not a Harness requirement). It compiles a decorated
class into a `@theokit/sdk` `Workflow` — the SDK ships the `Workflow` + `agentStep` + `createSquad`
primitives below; the decorator sugar is opt-in via that package.

## Workflows (v1.17+) — `Workflow.create / .run / .resume`

Declarative multi-step orchestration over `Agent.send`, `Handoff`, `Agent.batch`
and friends. ADRs D230-D248. Inspired by a peer framework workflows v1; uses explicit
input/output state propagation (not a framework state-machine).

```typescript
import { Agent, Workflow, fn, agentStep } from "@theokit/sdk";

const classifier = await Agent.create({ /* ... */ });
const billingExpert = await Agent.create({ /* ... */ });

const wf = Workflow.create<{ claim: string }, string>({ name: "refund-pipeline" })
  .then(fn("validate", (input) => {
    if (!input.claim) throw new Error("missing claim");
    return input;
  }))
  .then(agentStep("classify", classifier, (i) => `Classify: ${JSON.stringify(i)}`))
  .branch([
    [(out) => String(out).includes("BILLING"), [agentStep("resolve", billingExpert, "Handle it")]],
  ], { fallback: [fn("escalate", () => "escalated")] })
  .commit();

const run = await wf.run({ claim: "I was charged twice" });
console.log(run.status, run.output);
```

### Control-flow primitives (D233)

| Primitive | Purpose | Example |
|---|---|---|
| `.then(step)` | Sequential | `.then(fn("a", ...))` |
| `.parallel([branchA, branchB], { concurrency })` | Fan-out concurrent branches | `errorPolicy: "fail-fast" \| "collect"` |
| `.branch([[pred, [...]], ...], { fallback })` | First-match-wins routing | EC-2: predicate throw → no-match |
| `.foreach(srcStepId, step, { concurrency })` | Map over upstream array | default concurrency 4 |
| `.dowhile(step, cond, { maxIterations })` | Loop until cond=false | default cap 100 |
| `.sleep(durationMs, id?)` | Pause | abortable |
| `.suspend({ payloadSchema })` | Pause until `Workflow.resume(...)` | human-in-the-loop |

### Step types (D232)

```typescript
import { fn, agentStep } from "@theokit/sdk";

// fn step — pure function with optional Zod schemas + retry
fn("validate", (input, ctx) => {...}, {
  inputSchema: z.object({...}),
  outputSchema: z.object({...}),
  retry: { maxAttempts: 3, initialBackoffMs: 1000, backoffCoefficient: 2.0 },
});

// agent step — agent.send with rendered prompt + optional retry
agentStep("classify", agent, (input) => `prompt: ${input}`, { retry: {...} });
```

### Retry policy (D237)

```typescript
retry: {
  maxAttempts: 3,              // 1..20, REQUIRED if retry is set
  initialBackoffMs: 1000,      // default 1000
  backoffCoefficient: 2.0,     // default 2.0
  maximumBackoffMs: 30_000,    // default 30s
  nonRetryableErrors: ["ConfigurationError", "AbortError"], // default includes WorkflowSnapshotNotFoundError too
}
```

Retry sleeps are abortable via `AbortSignal`; non-retryable errors skip the loop.

### Suspend/resume (D236)

```typescript
const wf = Workflow.create({ name: "approval" })
  .then(fn("draft", async () => "draft text"))
  .then(fn("wait_for_approval", async (input, ctx) => {
    await ctx.suspend({ awaiting: "human-approval", draft: input });
    return "never returns"; // sentinel terminates this fn
  }))
  .then(fn("publish", async (payload) => `published with ${JSON.stringify(payload)}`))
  .commit();

const first = await wf.run(undefined);
// first.status === "suspended", first.id is the runId

// Later, after human approves:
const resumed = await Workflow.resume({
  runId: first.id,
  workflow: wf,
  payload: { approved: true, by: "manager" },
});
// resumed.status === "completed"
```

### Persistence (D235)

| Backend | When | How |
|---|---|---|
| `memory` (default) | Same-process suspend/resume | `Workflow.create({ name })` |
| `json` | Survive process restart | `Workflow.create({ name, persistence: { backend: "json", dir: ".theokit/workflows" } })` |

SQLite/Postgres backends ship in v1.x. Snapshots are JSON-only — BigInt,
circular refs, and class instances with cycles fail with
`WorkflowNotSerializableError` (EC-4).

### Cancellation (D245)

```typescript
const ctrl = new AbortController();
const promise = wf.run(input, { signal: ctrl.signal });
// somewhere else:
ctrl.abort("user cancelled");
const run = await promise;
// run.status === "cancelled"
```

`AbortSignal` is checked at step boundaries AND mid-backoff sleep.
`ctx.signal` is passed to step.fn so fetch/agent.send can be cancelled too.

### Telemetry (D241)

When OTel is installed, each `wf.run` emits a `workflow.run` root span and per-step
`workflow.step.<id>` child spans with attributes `workflow.name`, `workflow.run_id`,
`step.kind`, `step.attempts`, `step.status`. Zero cost when OTel is absent.

### v1 limitations

- **LocalAgent only** — `CloudAgent` workflow steps throw `UnsupportedRunOperationError` (D244).
- **Saga compensation deferred to v1.2** — `compensate?` field reserved on `FnStep` but throws `WorkflowCompensateNotImplementedError` if set (D238).
- **No cron-trigger integration** — wire workflows via `Cron.create({ task })` calling `wf.run` directly.

### Errors (named)

| Class | Cause |
|---|---|
| `WorkflowDuplicateStepIdError` | Two steps with same id at `.commit()` time |
| `WorkflowAlreadyRunningError` | Concurrent `.run()` with same `(workflowId, runId)` |
| `WorkflowSnapshotNotFoundError` | `Workflow.resume(runId)` with unknown runId |
| `WorkflowMaxIterationsExceededError` | `.dowhile` over `maxIterations` |
| `WorkflowNotSerializableError` | `ctx.suspend(payload)` with non-JSON value (EC-4) |
| `WorkflowResumeStepNotFoundError` | Resume against a workflow whose definition diverged (EC-8) |
| `WorkflowParallelError` | Aggregate of branch failures in fail-fast mode |
| `WorkflowCompensateNotImplementedError` | Step declares `compensate` (saga deferred to v1.2) |

## Semantic cache (v1.18+) — `Cache.semantic / .consult / .remember`

LLM response cache with cosine-similarity matching. ADRs D249-D266.
Inspired by Helicone (KV), LangCache (Redis Vector), GPTCache (layered architecture).

### Quickstart

```typescript
import { Agent, Cache } from "@theokit/sdk";

// Reuse any MemoryEmbeddingProviderAdapter (D11) — openai / mistral / voyage / etc.
// For a quick test, plug a deterministic toy embedder; production uses a real adapter.
const embedder = {
  id: "openai-text-embedding-3-small",
  model: "text-embedding-3-small",
  dimension: 1536,
  embed: async (texts) => { /* call your provider */ return [/* vectors */]; },
};

const cache = Cache.semantic({
  embedder,
  threshold: 0.85,                            // cosine distance; lower = stricter
  ttl: {
    default: "1h",
    exclude: /\b(weather|today|now|current|stock)\b/i,
  },
  namespace: "my-app",                         // multi-tenant isolation
  modelId: "openai/gpt-4o-mini",               // cross-model isolation
  maxEntries: 1000,                            // LRU eviction cap
});

// Plugin mode — registers pre_user_send / post_assistant_reply hooks
const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  plugins: [cache.asPlugin()],
});
```

### Two integration modes

**1. Plugin mode (transparent):**

```typescript
plugins: [cache.asPlugin()]
```

The cache registers `pre_user_send` (lookup) and `post_assistant_reply` (store)
hooks. On semantic hit, the cached response is **injected as `<memory-context>`**
into the LLM call (recall + inject). The LLM still runs but pre-loaded with the
cached answer — usually echoes it cheaply.

**2. Direct mode (true short-circuit):**

```typescript
const m = await cache.consult(prompt);
if (m.hit) {
  return m.response;            // zero LLM call
}
const run = await agent.send(prompt);
const result = await run.wait();
await cache.remember(prompt, result.result ?? "");
```

Use direct mode when you need to GUARANTEE the LLM is skipped on hit.

### Composite cache key (D253)

`${namespace}:${embedderId}:${modelId}:hash(prompt)`. Resolves multi-tenant
isolation + cross-embedder invalidation + cross-model isolation in one decision
(rationale documented in CacheAttack paper, arxiv 2601.23088).

### TTL configuration (D255)

```typescript
ttl: {
  default: "1h",                                  // "30s" | "15m" | "1h" | "7d" | "2w" | <seconds>
  exclude: /\b(weather|today|now|current)\b/i,    // bypass cache for time-sensitive queries
}
```

Exclusion regex makes the cache **always miss** for matching prompts (never stored, never recalled).

### Composing with Anthropic prompt caching (D263)

Cache.semantic resolves paraphrases BEFORE the LLM. Anthropic's prompt_caching gives
**90% discount** on prefix-identical input AFTER hitting the LLM. They're orthogonal:

```
[user query]
  → cache.consult() → HIT → return cached       (zero LLM call, ~10ms)
                    → MISS → agent.send() with cache_control on system/tools
                            → 90% input discount on subsequent identical prefixes
```

Compound savings reach ~95% in ideal workloads (FAQ, classify, summarize).

### Persistence backends (D265)

| Backend | When | How |
|---|---|---|
| `memory` (default) | Same-process; ephemeral | `Cache.semantic({ embedder })` |
| `json` | Survive process restarts | `Cache.semantic({ embedder, persistence: { backend: "json", dir: ".theokit/cache" } })` |

JSON file per namespace at `<dir>/<namespace>.json`. Atomic writes via D60.
Corrupt files (EC-7) are treated as empty cache — no crash on startup.

### Telemetry (D262)

When `@opentelemetry/api` is installed, every lookup emits a `cache.lookup` span
with attributes `cache.namespace`, `cache.embedder_id`, `cache.hit` (kv|semantic|miss),
`cache.distance` (semantic hits only), `cache.ttl_remaining_s`. Zero cost when OTel absent.

### v1 limitations (D254 / D256 / D266)

- **Plugin mode is recall+inject, not zero-LLM short-circuit** — use `cache.consult()` directly for that.
- **No streaming cache** (D256) — only non-streaming `agent.send` is cached.
- **No adaptive per-entry threshold** (D254) — tune the global threshold for high-stakes scenarios (0.95+).
- **Tool-use runs are NEVER cached** (D266 / EC-10) — replay would lose side-effects (file delete, API call, etc.).
- **Embedder change invalidates cache** (D258) — `embedder.id` is part of the key; no cross-embedder rerank.
- **False positive risk** (D264) — dense embeddings collapse negation ("delete X" ≈ "don't delete X"). Use higher thresholds + exclude regex for safety-critical scenarios.

### Errors (named)

| Class | Cause |
|---|---|
| `CacheEmbedderError` | Embedder throw surfaced (rare; usually swallowed via EC-1 graceful degradation) |
| `CacheInvalidTtlError` | Bad TTL format passed to `parseTtlMs` (e.g. `"1y"`, `-30`, `Infinity`) |


## Bedrock provider (v1.20+) — Claude on AWS Bedrock

AWS Bedrock provider via Bearer token + native `fetch`. ADRs D286-D302.
No SigV4, no `@aws-sdk/client-bedrock-runtime` peer dep.

### Quickstart

```typescript
import { Agent } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK,
  model: { id: "bedrock/us.anthropic.claude-sonnet-4-5-v1:0" },
});

const run = await agent.send("Hello, Claude on Bedrock!");
const result = await run.wait();
console.log(result.result);
```

### Auth (3 paths)

1. **Env var only** (zero peer dep): `AWS_BEARER_TOKEN_BEDROCK=<token>`. Generate via AWS Console (IAM → Users → Security credentials → Bedrock API keys) or `aws iam create-service-specific-credential`.
2. **Caller-provided** (overrides env): `Agent.create({ apiKey: token })`.
3. **Auto-refresh** (optional peer dep): `pnpm add @aws/bedrock-token-generator`. SDK lazy-loads it via `createRequire`; caches the short-term token for 1.5h.

### Model ID convention (D290 + EC-13)

Format: `bedrock/{regionPrefix}.anthropic.{model}-v{N}:{rev}`.

| Region prefix | Resolved AWS region |
|---|---|
| `us.` | `AWS_REGION` env, default `us-east-1` |
| `eu.` | `AWS_REGION` env, default `eu-west-1` |
| `apac.` | `AWS_REGION` env, default `ap-southeast-1` |
| `jp.` | hardcoded `ap-northeast-1` |
| `global.` | `us-east-1` (AWS default entrypoint) |

Examples: `bedrock/us.anthropic.claude-sonnet-4-5-v1:0`, `bedrock/global.anthropic.claude-opus-4-7-v1:0`.

### Error mapping (D300)

| AWS error / status | Canonical | Code |
|---|---|---|
| `429` / `ThrottlingException` | `RateLimitError` | `rate_limit` |
| `401`/`403` / `AccessDeniedException` | `AuthenticationError` | `auth_failed` |
| `400` / `ValidationException` | `ConfigurationError` | `invalid_request` |
| `408` / `Timeout*` | `NetworkError` | `timeout` |
| `5xx` | `NetworkError` | `server_error` |
| other | `UnknownAgentError` | `unknown` |

### v1 limitations

- **Non-streaming only** (D302) — `/invoke-with-response-stream` (AWS Event Stream binary format) deferred to v1.x. Full response arrives at once.
- **Bearer auth only** (D286, D298) — SigV4 deferred.
- **Claude only** — Converse API + Llama / Cohere / Mistral deferred (D296).
- **No Bedrock Agents / Knowledge Bases / Computer Use** (D282 escape-hatch pattern).

## Vertex AI provider (v1.20+) — Gemini + Claude on GCP

Vertex AI provider via OAuth (ADC) + native `fetch`. ADRs D286-D302.
Required peer dep: `google-auth-library`.

### Quickstart (Gemini)

```typescript
import { Agent } from "@theokit/sdk";

// `gcloud auth application-default login` first; GOOGLE_CLOUD_PROJECT in env.
const agent = await Agent.create({
  apiKey: "vertex-adc",   // placeholder — ADC resolves the real token
  model: { id: "vertex/google/gemini-2.0-flash-001" },
});

const run = await agent.send("Hello, Gemini!");
console.log((await run.wait()).result);
```

### Claude on Vertex

```typescript
const agent = await Agent.create({
  apiKey: "vertex-adc",
  model: { id: "vertex/anthropic/claude-sonnet-4-5@20250929" },
});
```

### Auth (ADC chain, in order)

1. `GOOGLE_APPLICATION_CREDENTIALS` env (path to Service Account JSON).
2. `gcloud auth application-default login` cached credentials.
3. Metadata server (running in GCE/GKE/Cloud Run/Cloud Functions).
4. Workload Identity Federation (configured via SA JSON).

`google-auth-library` handles all of these transparently. The SDK calls `getAccessToken()` per request — the library caches internally (TTL ~50min).

### Model ID conventions

- **Gemini (OpenAI-compat, D291):** `vertex/google/gemini-2.0-flash-001` — routes to `/endpoints/openapi/chat/completions`, reuses `OpenAIClient`.
- **Claude (`:rawPredict`, D292):** `vertex/anthropic/claude-sonnet-4-5@20250929` — routes to `/publishers/anthropic/models/<id>:rawPredict` with body massage.

### `global` location (D293)

When `GOOGLE_CLOUD_LOCATION=global`, the SDK uses `https://aiplatform.googleapis.com/...` (no `global-` host prefix). Known fix for the `streamRawPredict` 404 bug at `global-aiplatform.googleapis.com` (a peer#10287).

### Error mapping (D300)

| GCP status | Canonical | Code |
|---|---|---|
| `429` / `RESOURCE_EXHAUSTED` | `RateLimitError` | `rate_limit` |
| `401` / `UNAUTHENTICATED` | `AuthenticationError` | `auth_failed` |
| `403` / `PERMISSION_DENIED` | `AuthenticationError` | `auth_failed` |
| `400` / `INVALID_ARGUMENT` | `ConfigurationError` | `invalid_request` |
| `408` / `DEADLINE_EXCEEDED` | `NetworkError` | `timeout` |
| `5xx` | `NetworkError` | `server_error` |
| other | `UnknownAgentError` | `unknown` |

### v1 limitations

- **`google-auth-library` required peer dep** (D288, 572KB). Repo archived Nov 2025 but security-patched.
- **OpenAI-compat path drops unsupported params silently** (D291) — recursive JSON schemas, `detail` field in old multimodal, etc.
- **Anthropic on Vertex is non-streaming in v1** — `:streamRawPredict` deferred.
- **WIF walkthrough deferred to v1.x** (D297) — ADC resolves it transparently when configured GCP-side.
- **No Service Account JSON tooling** (D299) — user provides via `GOOGLE_APPLICATION_CREDENTIALS`.

### Composing Bedrock + Vertex with other features

Both profiles work with all SDK features: handoffs (D214-D229), workflows (D230-D248), semantic cache (D249-D266), eval suite (D202-D213), batch (D134-D140). Pick the model id at agent construction; the rest of the SDK is provider-agnostic.

## Conversation storage (v1.21+) — `ConversationStorageAdapter`

Pluggable conversation persistence. Default behavior is unchanged (`<cwd>/.theokit/agents/<id>/messages.jsonl`). For serverless deploys (a peer vendor, Cloudflare Workers, Lambda) and multi-host setups (K8s replicas, TheoCloud canary), pass a custom adapter.

### Interface

```ts
interface ConversationStorageAdapter {
  getMessages(conversationId: string): Promise<readonly StoredMessage[]>;
  appendMessage(conversationId: string, message: StoredMessage): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  listConversationIds?(opts?: { limit?: number }): Promise<readonly string[] | undefined>;
  compact?(conversationId: string, maxTurns: number): Promise<void>;
  dispose?(): Promise<void>;
}

interface StoredMessage {
  role: "user" | "assistant" | "system" | "tool_call" | "tool_result";
  content: string;
  at?: number; // epoch ms
}
```

### Default behavior (no configuration)

```ts
// Existing apps unchanged — FS adapter at cwd
const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd() },
});
// writes to <cwd>/.theokit/agents/<id>/messages.jsonl
```

### Built-in adapters

```ts
import {
  Agent,
  FileSystemConversationStorage,
  InMemoryConversationStorage,
} from "@theokit/sdk";

// Tests / ephemeral dev
const ephemeral = new InMemoryConversationStorage();

// Explicit FS (same as default but with custom root)
const fs = new FileSystemConversationStorage({ root: "/var/lib/myapp" });

const agent = await Agent.create({
  apiKey,
  model,
  conversationStorage: ephemeral, // or fs
});
```

### Postgres / Redis / Durable Objects

See `docs/recipes/conversation-storage-postgres.md` and `docs/recipes/conversation-storage-redis.md` for copy-paste templates. Both ship Node + Edge variants.

### Strict resume integrity (D325)

When `Agent.create({ conversationStorage })` is used, the registry marks the agent with `requiresCustomStorage: true`. **`Agent.resume` REJECTS** with `ConfigurationError(code: "conversation_storage_required")` if the marker is set and the caller does not pass `conversationStorage` again.

```ts
// First call (creates + marks):
await Agent.create({
  agentId: "user-42",
  conversationStorage: pgAdapter,
  apiKey,
  model,
});

// Process restart later:
// ❌ throws — silently falling back to FS would lose Postgres history
await Agent.resume("user-42");

// ✓ correct — pass adapter again
await Agent.resume("user-42", { conversationStorage: pgAdapter });
```

This is intentional. Silent FS fallback would corrupt the conversation (read empty `messages.jsonl`, continue as if fresh). Wire the adapter at the route-handler level so every request reaches `getOrCreate` with the storage in place.

### What does NOT serialize across resume

`conversationStorage` is a runtime closure — not stored in `registry.json`. Same pattern as `AgentOptions.tools` handlers. The marker is the only thing that survives.

## Agent registry lifecycle (v1.21+) — `Agent.registry`

Live-agent cache for production deploys. Solves OOM in long-running Node servers by evicting idle agents and capping the working set.

`Agent.registry` is **distinct from** the internal metadata registry (which persists `RegisteredAgent` to `registry.json`). The metadata registry is the address book; `Agent.registry` is the live working set.

### Defaults

| Option | Default | Meaning |
|---|---|---|
| `maxAgents` | 100 | LRU eviction kicks in above this |
| `idleTimeoutMs` | 1_800_000 (30 min) | Agents not used in this window are evicted |
| `sweepIntervalMs` | 60_000 (60s) | How often idle sweep runs |
| `onEvict` | undefined | Observability listener `(id, reason) => void` |

### Tune for production

```ts
import { Agent } from "@theokit/sdk";

// At app boot:
Agent.registry.configure({
  maxAgents: 1000,                  // high-traffic SaaS
  idleTimeoutMs: 15 * 60 * 1000,    // 15 minutes
  onEvict: (id, reason) => {
    metrics.increment("agent.evicted", { reason });
  },
});

// Graceful shutdown:
process.on("SIGTERM", async () => {
  await Agent.registry.evictAll();
  process.exit(0);
});
```

### Disable the cache

```ts
Agent.registry.configure({ maxAgents: 0 });
// Every Agent.getOrCreate re-initializes — predictable memory at the cost of re-init time.
```

### Inspect

```ts
Agent.registry.size();   // current count
Agent.registry.ids();    // ids in recency order (newest first)
Agent.registry.evict("agent-42"); // explicit eviction
```

### How it interacts with `Agent.getOrCreate`

`Agent.getOrCreate(id, options)`:
1. Calls `Agent.registry.get(id)` — cache hit returns immediately, refreshes recency.
2. On miss, calls `Agent.resume` → on UnknownAgentError, `Agent.create`.
3. After successful resume/create, calls `Agent.registry.set(id, agent)`.

If `maxAgents` is `0`, step 1 returns undefined and step 3 is a no-op — every call re-initializes.

### Eviction calls `agent.dispose()`

Every eviction (LRU, idle, explicit) awaits `agent.dispose()`. Dispose errors are swallowed (stderr warn) so a misbehaving dispose doesn't block the cache. Watch the `onEvict` listener + stderr for disposal failures.

## Error codes (v1.21+) — `AgentRunErrorCode`

16 finite codes for `AgentRunError.code`. Use exhaustive `switch` for proper UI branching. Full reference: `docs/error-codes.md`.

### Discriminate by code

```ts
import { AgentRunError } from "@theokit/sdk";

try {
  await agent.send(message);
} catch (err) {
  if (!(err instanceof AgentRunError)) throw err;
  switch (err.code) {
    case "auth_failed":      // login UI
    case "rate_limit":       // wait err.retryAfterMs
    case "quota_exceeded":   // upsell
    case "invalid_model":    // hint correct model
    case "context_too_long": // shorten history
    case "tool_runtime_error": // log + show generic
    case "aborted":          // suppress UI noise
    default: /* generic */
  }
}
```

### `retryAfterMs` — ms, not seconds

```ts
if (err.retryAfterMs !== undefined) {  // NOT truthy check — 0 is valid
  setTimeout(retry, err.retryAfterMs);
}
```

### `requestId` for support tickets

```ts
console.log({
  conversation: err.conversationId,
  provider: err.provider,
  request: err.requestId,  // x-request-id / request-id
  retriable: err.retriable,
});
```

### Anti-leak invariant

`err.message` NEVER contains `err.providerError` content. The raw response body is reachable via `err.providerError` (= `err.metadata?.raw`), already redacted (D68). Safe to log.

See `docs/error-codes.md` for the full provider→code mapping table.

## Cancellation (v1.21+) — `SendOptions.signal`

Wire `AbortSignal` from your route handler / job runner so token billing stops the moment the caller disconnects (Production-Readiness #5, ADRs D318-D321).

### Pass user signal

```ts
import { Agent, AgentRunError } from "@theokit/sdk";

// Express + Node: request.on('close') fires AbortSignal on disconnect
const agent = await Agent.getOrCreate(conversationId, { apiKey, model });
try {
  const run = await agent.send(message, { signal: request.signal });
  return run.stream();
} catch (err) {
  if (err instanceof AgentRunError && err.code === "aborted") {
    // user cancelled — no UI noise
    return;
  }
  throw err;
}
```

### Compose with timeout

```ts
const timeout = AbortSignal.timeout(30_000);
const composed = AbortSignal.any([request.signal, timeout]);
await agent.send(message, { signal: composed });
```

### What happens on abort

1. `fetch()` to the LLM provider is canceled at the transport layer — tokens stop billing mid-stream
2. The user message persists in conversation storage; the assistant message does NOT (D320 — history invariant)
3. `agent.send()` rejects with `AgentRunError({ code: "aborted", retriable: false, cause: DOMException })`
4. Tools in mid-execution still complete (their handlers don't see the signal unless they accept it explicitly)

### Cleanup via `agent.dispose()` also aborts

When `Agent.registry` evicts an agent (LRU / idle), or when you `await agent.dispose()` explicitly, the agent's lifecycle controller fires and in-flight `send()` calls are aborted with the same `code: "aborted"`. The `err.cause.message` carries the dispose context.

### Runtimes without native `AbortSignal.any`

The SDK ships a ponyfill (`anySignal`, D324). a peer vendor Edge consumers + older Bun get correct behavior without polyfill installation.

## Tool lifecycle hooks (v1.21+) — `onToolStart` / `onToolEnd` / `onToolError`

Observe every tool dispatch for cost tracking, audit log, latency telemetry (Production-Readiness #4, ADRs D315-D317).

```ts
const agent = await Agent.create({
  apiKey, model,
  onToolStart: ({ toolName, callId, args, conversationId }) => {
    metrics.recordToolStart({ toolName, callId, conversationId });
  },
  onToolEnd: ({ toolName, callId, durationMs, result }) => {
    metrics.recordToolEnd({ toolName, callId, durationMs });
  },
  onToolError: ({ toolName, callId, error, durationMs, attempt }) => {
    metrics.recordToolError({ toolName, callId, error: error.message, durationMs });
  },
});
```

### Semantics

- `callId` is the same value across the start/end (or start/error) pair — correlate logs without managing your own counter.
- `durationMs` is wall-clock from start hook → end (or error) hook fire.
- `event.error` in `onToolError` is ALWAYS an `Error` instance (validation reasons wrapped in `new Error(reason)`).
- `attempt` is always `1` in v1 — reserved for future tool retry policy.
- **Hook errors are SWALLOWED** with stderr warn. Listener bugs do NOT crash the agent run.

## Quota / abuse hooks (v1.21+) — `onBeforeCreate` / `onBeforeSend`

Multi-tenant SaaS quota enforcement at the SDK boundary (Production-Readiness #6, ADRs D322-D323).

```ts
const agent = await Agent.create({
  apiKey, model,
  agentId: `user-${userId}`,
  metadata: { userId },
  onBeforeCreate: async ({ conversationId, userId }) => {
    const count = await db.countConversations(userId);
    if (count >= 100) {
      throw new Error("100 conversations per user max");
    }
  },
  onBeforeSend: async ({ conversationId, previousMessageCount }) => {
    if (previousMessageCount >= 50) {
      throw new Error("conversation too long — start a new one");
    }
  },
});
```

### Distinction from tool hooks

These hooks are **admission gates**, not observers. Their throws **propagate** as rejection on `Agent.create` / `agent.send` — they are designed to block operations (quota, abuse, policy).

### Order

- `onBeforeCreate` fires AFTER `validateAgentOptions` but BEFORE registry insert + storage write. Rejected hooks leave zero orphan state.
- `onBeforeSend` fires AFTER cache invalidation check but BEFORE `pre_user_send`, storage write, and LLM call.

### Cache hit semantics

`Agent.getOrCreate` cache hit (`Agent.registry`) skips `onBeforeCreate` — cache is per-process, so cold path always runs the hook. Per-user quotas backed by an external DB survive process restart.

## Test fault injection (v1.22+) — `THEOKIT_TEST_RESPONSE_OVERRIDE`

Deterministic chaos testing without burning provider quota or hitting the network. Every LLM client returned by the internal router is wrapped with a fault-injection decorator that short-circuits the real call when both gates are satisfied:

1. `process.env.NODE_ENV === "test"` (fail-safe — production deployments are unaffected; the wrapper is a cheap noop)
2. `process.env.THEOKIT_TEST_RESPONSE_OVERRIDE` is a non-empty JSON string of shape `{"status": number, "body": object | string}`

```bash
# 429 rate-limit — deterministic, zero quota burn
export NODE_ENV=test
export THEOKIT_TEST_RESPONSE_OVERRIDE='{"status":429,"body":{"error":{"code":"rate_limit_exceeded","message":"Rate limit hit; retry in 60s"}}}'

# Now `agent.send(...)` throws RateLimitError without any HTTP roundtrip.
```

### Supported status classes (errors)

| HTTP status | Thrown error class | Use case |
|---|---|---|
| 401 / 403 | `AuthenticationError` | Invalid-key scenarios |
| 408 | `NetworkError` (timeout) | Timeout handling |
| 400 | `ConfigurationError` | Bad-request scenarios |
| 429 | `RateLimitError` | Rate-limit handling without quota burn |
| 5xx | `NetworkError` (server_error) | Retry / circuit-breaker tests |

Error mapping reuses `mapOpenAICompatibleError` — the injected errors are byte-equal to what the real provider would raise.

### Supported body shapes (status 200)

| Body shape | Behavior |
|---|---|
| `{"choices":[{"message":{"content":"hello"}}]}` (OpenAI shape) | yields `text_delta` with `"hello"` + `stop: "end_turn"` |
| `"raw string"` | yields the string verbatim |
| `{"text":"hello"}` | yields `text_delta` with `"hello"` |
| anything else | yields empty text + `stop: "end_turn"` |

### Graceful degradation

If the env var is set but the JSON is malformed (parse error, missing `status`, wrong type), the wrapper emits a one-shot stderr warn AND falls through to the real LLM client. The feature never throws on bad config.

### When to use this

- **Chaos tests** — exercise `RateLimitError` / `AuthenticationError` retry paths without OpenRouter quota burn.
- **Snapshot tests** — pin a deterministic LLM reply for golden-file comparison.
- **CI fault injection** — verify your app handles 5xx upstream gracefully.

### When NOT to use this

This is NOT a replacement for `fixture-mode` (the `theo_test_*` API key path). Fixture mode is a product feature for SDK consumers' tests; `THEOKIT_TEST_RESPONSE_OVERRIDE` is a chaos seam for the SDK + framework's own test pipelines. Per the `real-llm-validation.md` rule, **fixture mode and `THEOKIT_TEST_RESPONSE_OVERRIDE` are both insufficient evidence for "validated against real LLM"** claims.
