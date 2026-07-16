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

> **Cloud runtime — pre-release.** The cloud runtime depends on **Theo PaaS**, currently pre-release. The **local runtime is the primary, fully-tested path** and works without it. Every cloud API in this document describes the **contract for when Theo PaaS reaches general availability** — it is validated against the SDK's contract tests (payload shape, determinism, secret filtering, HTTP protocol) but **not yet against a live PaaS endpoint**. Cloud-only surfaces (`cloud.envVars`, `cloud.autoCreatePR`, `result.git`, artifacts) are labeled inline below; treat them as contract-only until PaaS ships.

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
  model: "google/gemini-2.0-flash-001",
  local: { cwd: process.cwd() },
});
const run = await agent.send("Summarize what this repository does");
for await (const event of run.stream()) {
  console.log(event);
}
Each event is a discriminated SDKMessage. Streaming shows how to extract assistant text, handle tool calls, and clean up with await using. For a one-shot prompt (create, run, dispose), see Agent.prompt().

Model selection (SE8). `model` accepts a bare-string id — `model: "openai/gpt-4o-mini"` — as well as the `{ id }` object; both `AgentOptions.model`, `SendOptions.model` (per-send override), and `AgentBuilder.model()` take either. The string is the ergonomic default; use the object form when you need `params` (reasoning/temperature tuning): `model: { id: "…", params: [...] }`. An empty string throws a typed `ConfigurationError`.

Integrated structured output — agent.generate (SE9). When you want a validated, typed object back — not just text — call `agent.generate(input, { output: schema })`. It runs the normal tool loop (your tools run first) and then coerces the final answer into the Zod schema, returning `{ object, result, raw, usage }` where `object` is fully typed:

  import { z } from "zod";
  const Invoice = z.object({ total: z.number(), date: z.string() });
  const { object, result } = await agent.generate("Extract the invoice fields", {
    output: Invoice,
    // ...any SendOptions (tools, toolChoice, maxIterations) drive the tool loop
  });
  // object: { total: number; date: string }  ← inferred + Zod-validated
  // result: the underlying tool-loop RunResult (status / usage / model)

It is sugar over `Agent.generateObject` (the synthetic forced-`output`-tool machinery), not a fork: phase 1 is your own `agent.send()` run, phase 2 structures the final answer. `SendOptions` drive phase 1; `maxRetries` / `errorStrategy` (`"throw"` | `"return-partial"` | `"return-raw"`) tune the structuring phase. A run that errors before an answer surfaces a typed `GenerateObjectError` — never structuring over a failed run. Available on both local and cloud agents. For a standalone structuring call without a tool loop, use `Agent.generateObject({ schema, prompt, model })`.

Creating agents

Agent.create(options: AgentOptions): Promise<SDKAgent>;
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
**Cloud-only, pre-release.** For cloud agents, pass cloud.envVars when a run needs short-lived credentials or other values that should live only with that agent. These are sent to Theo PaaS at agent-create time over TLS (never in the redacted per-run cloudPayload). This is the contract for when Theo PaaS ships; it is not yet wired to a live endpoint.


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

## Reasoning (SE37)

Three ways to make an agent reason before answering:

1. **Native reasoning models** — set `model.params: [{ id: "thinking", value: "high" }]` (above). The model reasons internally; the trace streams as `thinking` deltas (`onDelta`) / `SDKThinkingMessage` (`run.stream()`) and counts under `usage.reasoningTokens`. Use this when the model supports it.
2. **Reasoning tools** — `ReasoningTools.create()` returns a `think` and an `analyze` scratchpad tool (no side effects — they echo the model's structured reasoning back as an observation). Import from `@theokit/sdk-tools` and add to any model: `tools: [...ReasoningTools.create()]`.
3. **`reasoning: true`** — a lightweight flag that turns a NON-reasoning model into a reason→act→observe loop using the SAME model: it prepends a chain-of-thought preamble to the system prompt AND auto-attaches the `think` reasoning tool. Default off; byte-identical when unset.

```typescript
const reasoningAgent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },   // a non-reasoning model
  reasoning: true,                        // CoT preamble + think/analyze auto-attached
});
```

`reasoning: true` is **inert (with a one-time warn)** when a native reasoning model is configured (`model.params` carries a `thinking`/`reasoning`/`reasoning_effort` id) — native reasoning wins, so the two never stack (no double-reasoning). For a native reasoning model, use `model.params` directly instead of `reasoning: true`.

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

Beyond `.theokit/context/*.md`, the file-based context manager auto-discovers instruction files across the 2026 industry-standard set — `AGENTS.md`, `GEMINI.md`, `CLAUDE.md` (git-root walk, `@import` followed for the latter two), `.cursor/rules/*.mdc`, `.theokit/rules/*.md`, and `.theokit/THEO.md` — merged by priority into the context block.

Path-scoped rules — `.theokit/rules/*.md`. Theokit-native rule files, mirroring Claude Code's `.claude/rules/`. Each file carries frontmatter that gates when the rule loads:

```
---
description: API endpoint rules
paths:                     # glob patterns (Claude Code parity); `globs:` is an accepted alias
  - src/api/**/*.ts
alwaysApply: false         # true → load on every send regardless of scope
enabled: true              # false → disable the rule entirely
---
Every endpoint must validate its input.
```

A rule with `alwaysApply: true` loads into the context on every send. A path-scoped rule (`paths:`/`globs:`) loads only when a file in the current send's scope matches one of its glob patterns. The scope is declared per send via `SendOptions.contextPaths` — the repo-relative files the host is working on:

```
await agent.send("Add an endpoint.", { contextPaths: ["src/api/users.ts"] });
// → the src/api/** rule activates for this send; alwaysApply rules always load.
await agent.send("Tweak the button.", { contextPaths: ["src/ui/button.tsx"] });
// → the src/api/** rule stays dormant (no leak); alwaysApply rules remain.
```

Omit `contextPaths` and only unconditional rules load (the create-time snapshot is untouched — non-users pay nothing). Glob matching supports `**` (any depth, collapsing so `src/**/*.ts` matches `src/x.ts` and `src/a/b/x.ts`), `*` (single segment), and `?`. The same `contextPaths` signal also activates conditional `.cursor/rules/*.mdc` globs. `paths:` and `globs:` are unioned; both are glob-pattern arrays (not exact paths). Local runtime.

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

Local file-based skills live at `.theokit/skills/<name>/SKILL.md` and are loaded when `local.settingSources` includes `"project"`. Cloud agents load skills committed in the repo. `agent.reload()` re-reads skill files; a skill whose frontmatter is malformed (missing the required `name`/`description`, or invalid YAML) is **skipped with a stderr warning and excluded from `agent.skills.list()`** — reload does **not** throw for a bad skill (graceful-degrade: one broken skill file never blocks the agent). The valid skills stay loaded.


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
  // true when the run stopped at the agent loop's iteration ceiling
  // (SendOptions.maxIterations or the default) with the model still
  // wanting to call tools — i.e. silently truncated, not finished.
  stoppedAtIterationLimit?: boolean;
  // true when the run stopped because the DOOM-LOOP GUARD detected the model
  // repeating IDENTICAL tool calls (same name + input) to the hard threshold —
  // making no progress. Surfaces as terminal "no_progress" through the driver.
  stoppedByDoomLoop?: boolean;
  // SE3 — provenance of the turn (WHO triggered it), forwarded from
  // SendOptions.origin. undefined = a direct human turn.
  origin?: MessageOrigin;
}
type MessageOrigin =
  | { kind: "human" }
  | { kind: "peer"; from: string }          // a Squad peer / an a2a sender
  | { kind: "task-notification" }           // a background follow-up re-entered send
  | { kind: "coordinator"; from?: string }  // a delegating/handoff coordinator
  | { kind: "auto-continuation" };          // the loop's continuation driver
Multi-agent provenance (origin)

SE3. In a multi-agent app you want to know WHO triggered a turn — a human, a peer agent, a background task, a coordinator. MessageOrigin is that provenance, stamped by SendOptions.origin and forwarded onto RunResult.origin (metadata-only — it never changes routing or dispatch; mirrors the Anthropic Agent SDK's origin shape). An absent origin (undefined) means the turn was not stamped (a plain agent.send()); pass { kind: "human" } to positively mark a human turn — the two are distinct (unstamped vs explicitly human).

The multi-agent primitives stamp it for you: a Squad stamps { kind: "peer", from: "agent-<i-1>" } on every step after the first (the first receives the human input); every a2a A2AMessage carries origin: { kind: "peer", from } as a thin projection of the sender address. Background-delegation and handoff are host-driven — pass the origin yourself on the follow-up send (agent.send(input, { origin: { kind: "task-notification" } })) and read it back on result.origin.

Session persistence (native Claude-shaped transcript)

SE40 (v4.0). A local agent's conversation IS a native Claude Code `.jsonl` transcript on disk — a `uuid`/`parentUuid` DAG of records with structured `text` / `thinking` / `tool_use` / `tool_result` blocks. There is no pluggable storage adapter and no session-metadata surface; the transcript is the single source of truth. The path is `<baseDir>/projects/<encoded-cwd>/<agentId>.jsonl`.

  const agent = await Agent.create({
    local: { cwd, baseDir: "~/.theokit" },   // baseDir default is ~/.theokit
  });
  await (await agent.send("first message")).wait();
  await agent.dispose();

  // A fresh process resumes by reconstructing the transcript DAG.
  const resumed = await Agent.resume(agent.agentId, { local: { cwd, baseDir: "~/.theokit" } });

- WRITE: after each send the whole turn (user text + assistant text/thinking + paired tool_use/tool_result blocks, from `run.conversation()`) is written as native records, append-only. Secrets are redacted before disk.
- READ / resume: hydration walks the transcript DAG (leaf → root via parentUuid) and reconstructs the conversation; tool turns fold into assistant-role context so a resumed agent keeps its tool history.
- COMPACTION is append-only: a `compact_boundary` system record (a new root) is appended; the transcript is NEVER shrunk. A resume after a boundary replays only the post-boundary continuation.
- `local.baseDir` controls the root: default `~/.theokit` isolates our sessions; set `~/.claude` to write sessions the Claude Code CLI can `--continue`. Extended-thinking signatures are written but dropped on read (functional `--continue` for thinking is out of scope — issue #122).

Removed in v4.0: the `Session` namespace (`renameSession` / `tagSession` / `listSessions`), `SessionMeta` / `SessionMetaPatch`, the `ConversationStorageAdapter` contract (and `FileSystemConversationStorage` / `InMemoryConversationStorage`), and `AgentOptions.conversationStorage`. Persistence is now exclusively the native transcript above.

Reliable continuation (local agents)

A single agent.send() runs the tool-calling loop up to a ceiling — SendOptions.maxIterations (a positive integer; invalid values throw ConfigurationError) or the default. When the model still wants to call tools at that ceiling, the run stops with result.stoppedAtIterationLimit === true rather than a finished answer.

Doom-loop guard. Independently, the loop stops early when the model repeats IDENTICAL tool calls (same name + same input) that make no progress — e.g. a tool that keeps failing and is retried unchanged. This is on by default with generous thresholds (soft 3 / hard 5): at the soft threshold a one-time guidance nudge is injected as a user message in the transcript; at the hard threshold the run stops with result.stoppedByDoomLoop === true (surfacing as terminal "no_progress" through runToCompletion — a controlled stop, not a truncation to re-send). Because it is on by default, a run that previously ground to the iteration ceiling on an identical-repeat loop now terminates earlier with stoppedByDoomLoop instead of stoppedAtIterationLimit. Tune or disable per call with SendOptions.doomLoop: false to disable, or { softThreshold, hardThreshold } to tune (each a positive integer; invalid values throw ConfigurationError). It complements stoppedAtIterationLimit (a different failure mode: model stuck repeating vs work truncated at the ceiling).

Per-tool timeout and cancellation (#58). SendOptions.perToolTimeoutMs (a positive integer, undefined = no timeout) bounds each individual tool call: a hung tool yields a typed timeout result (exitCode 124, "tool execution timed out") instead of wedging the run, while other tools continue. Independently, cancelling the run's SendOptions.signal interrupts an in-flight tool and stops the loop between iterations (the current turn's own abort UX is preserved). Tool handlers defined with Tool.create receive an optional 2nd ToolContext argument ({ signal, context, threadId }) so a cooperative handler can stop early (signal), read the run's shared `SendOptions.context`, and scope per-session state by `threadId` (the run's session identity — the key passed to `Agent.getOrCreate(sessionId, …)`, or the agent's own id); single-argument handlers are unaffected. `ctx.threadId` (#119) lets a stateful tool shared across sessions in one process (e.g. the built-in `todolist`) isolate each session's state instead of leaking it. The JobQueue primitive is likewise bounded — new JobQueue({ maxConcurrency }) caps concurrent jobs (omit for unbounded) and cancel(id) now aborts a running job's signal, not just its status.

Tool-result content guard (#57). SendOptions.toolResultGuard opts into a built-in defense applied before tool output reaches the LLM: { delimit: true } frames untrusted tool output in explicit <untrusted-tool-output> data boundaries (a forged closing marker inside the content is neutralized) so the model treats it as data, not instructions; { redactPii: true } redacts email/phone PII. Both are off by default (undefined = unchanged behavior). Import the ToolResultGuardOptions type from @theokit/sdk.

Plugin hooks (#65). All ten declared HookName hooks are now invoked by the loop: pre_tool_call, post_tool_call, pre_llm_call, post_llm_call, on_session_start, on_session_end, transform_tool_result, transform_llm_output, pre_user_send, post_assistant_reply. Fire-and-forget hooks run in order (a handler error is logged, never thrown); the two transform_* hooks fold over their payload (a handler's return value replaces it — undefined keeps the prior value). transform_tool_result runs on the tool-result content before it reaches the LLM (the seam the built-in guard uses); transform_llm_output rewrites the assistant text recorded into the tool-turn loop context.

agent.runToCompletion(message, options?) drives past that truncation. It re-sends a short continuation prompt — the agent's stateful session preserves the conversation, so the prompt need not repeat the task — until a genuine terminal. Local agents only; cloud agents throw UnsupportedRunOperationError (the cloud runtime manages continuation server-side).


interface RunToCompletionOptions {
  maxRounds?: number;            // continuation-round ceiling (default 5)
  continuationPrompt?: string;   // re-sent after each truncated round
  onTruncated?: (event: { round: number }) => void | Promise<void>;
  signal?: AbortSignal;          // checked between rounds
  sendOptions?: SendOptions;     // forwarded to each underlying send()
}
interface RunToCompletionResult {
  terminal: "done" | "step_limit" | "no_progress";
  rounds: number;                // index of the final round: 0 = first send finished,
                                 // N = N continuation re-sends; step_limit → rounds === maxRounds
  lastResult: RunResult;
  usage?: TokenUsage;            // summed across rounds; undefined if no round reported usage
}

// runToCompletion is an optional, local-only method (cloud agents throw), so
// call it through optional chaining or narrow to a local agent first.
const out = await agent.runToCompletion?.("Refactor the module and run the tests", {
  maxRounds: 8,
});
if (out !== undefined && out.terminal !== "done") {
  console.warn(`stopped early: ${out.terminal} after ${out.rounds} round(s)`);
}

agent.streamToCompletion(message, options?) is the STREAMING twin of runToCompletion: same options (RunToCompletionOptions) and the same terminal policy (done / step_limit / no_progress + bounded re-prompt), but it returns an AsyncGenerator that yields each round's SDKMessages LIVE — so a UI can render tool calls and text as they happen across continuation rounds, instead of waiting for the final result. Local agents only; cloud agents throw UnsupportedRunOperationError.

The StreamToCompletionResult (terminal / rounds / usage — same shape as RunToCompletionResult) is the generator's RETURN value, NOT a yielded value. A plain `for await...of` consumes the messages but discards it — read it with a manual `next()` loop:

```
// streamToCompletion is optional + local-only (cloud agents throw).
const gen = agent.streamToCompletion?.("Refactor the module and run the tests", { maxRounds: 8 });
if (gen !== undefined) {
  let res = await gen.next();
  while (!res.done) {
    render(res.value);          // res.value is an SDKMessage (live)
    res = await gen.next();
  }
  const summary = res.value;    // StreamToCompletionResult — the return value
  if (summary.terminal !== "done") {
    console.warn(`stopped early: ${summary.terminal} after ${summary.rounds} round(s)`);
  }
}
```

Both drivers are STATEFUL (the agent's session preserves history via the native transcript).

Removed in v4.0: `buildReplayHistory` / `ReplayHistoryOptions` (the stateless continuation-history rebuild primitive) — it consumed the removed `StoredMessage[]` shape. Stateless continuation now relies on the native transcript on disk, which a fresh agent reconstructs on resume.

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
console.log(result.git);         // cloud-only (pre-release): { branches: [{ repoUrl, branch?, prUrl? }] }
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

### Runtime events — `SendOptions.onRunEvent` (SE2)

Beyond the `SDKMessage` content stream, an opt-in `onRunEvent` sink delivers out-of-band, discriminated **runtime-observability** `RunEvent`s — the model's content is unaffected. Discriminate on `event.type`. Every variant is emitted end-to-end:

- `tool_progress` — a tool is about to dispatch (after all vetoes pass).
- `permission_denied` — a tool call was blocked (`source`: fork-whitelist / plugin / file-hook).
- `rate_limit` — a 429 retry is about to back off (`attempt`, `retryAfterMs?`); from the pool-aware LLM client.
- `compact_boundary` — the session crossed an auto-compaction boundary (`trigger`, `preTokens?`).
- `task_started` / `task_updated` / `task_completed` — a background task's lifecycle, bridged opt-in from `Task.submit(kind, work, { onRunEvent })`.
- `tripwire` / `completion_check` — guardrail abort / completion-loop signals.

```ts
await agent.send("…", {
  onRunEvent: (e) => {
    switch (e.type) {
      case "rate_limit":  metrics.throttle(e.retryAfterMs); break;
      case "permission_denied":  audit.log(e.toolName, e.message); break;
      case "compact_boundary":  ui.note("history compacted"); break;
      // task_started / task_updated / task_completed / tool_progress / tripwire / completion_check
    }
  },
});
```

The sink is strictly opt-in (absent ⇒ zero behavior change) and fail-safe (a throwing sink never breaks the run). No `RunEvent` is pushed into `Run.stream()` — existing `SDKMessage` consumers are unaffected. Local runtime.

Per-send options
Property	Type	Description
model	ModelSelection	Per-send model override. If omitted, uses agent.model. Sticky: a successful send updates agent.model.
systemPrompt	string	Per-call system prompt override. Wins over AgentOptions.systemPrompt. String only — for dynamic resolvers, configure on AgentOptions. An empty string is honoured (it explicitly clears the system context).
mcpServers	Record<string, McpServerConfig>	Inline MCP server definitions. Fully replaces creation-time servers for this run.
tools	CustomTool[]	Per-call inline custom tools. Fully replaces `AgentOptions.tools` for this run (not merged). `undefined` → fall back to agent tools; `[]` → explicit clear (no custom tools for this run); `[t1, t2]` → use exactly these. Local runtime only — cloud agents throw `ConfigurationError(code: "cloud_custom_tools_rejected")`.
onStep	(args: { step }) => void | Promise<void>	Callback after each completed conversation step: `assistantMessage` (text), `thinkingMessage`, `toolCall`, and its paired `toolResult` (same `callId`). Symmetric with `run.conversation()` — a live-stream consumer sees both the call and its result.
onDelta	(args: { update }) => void | Promise<void>	Callback per raw InteractionUpdate.
toolChoice	"auto" \| "none" \| "required"	Per-call tool gate (OpenAI/OpenRouter `tool_choice`). `"none"` forces a text answer even when tools are registered (e.g. an agent loop forcing a closing summary at its step ceiling); `"required"` forces a tool call; omitted ⇒ provider default. Local runtime; OpenAI-compatible providers. Emitted only alongside a non-empty tools array.
activeTools	string[]	SE18 — restrict, for THIS send only, which of the agent's tools the model may call. A tool call to a name outside the set is vetoed at dispatch (the same fork-whitelist seam as `Agent.fork`'s `allowedTools`, NOT the permission engine) and the handler never runs. `[]` fail-closed (no tool dispatches); absent ⇒ the full toolset. Composes with `toolChoice` (activeTools narrows *which*, toolChoice gates *whether*). Per-send and non-mutating — the agent's persistent tool set is untouched. Local runtime.
completionCheck	CompletionCheck	SE34 — an opt-in per-send completion predicate (an LLM judge, reusing the goal-judge machinery) evaluated once after the run settles; its verdict surfaces on `RunResult.completionCheck` and as a `completion_check` run-event. Fail-safe (a judge/parse failure ⇒ `complete: false`); absent ⇒ unchanged. Local runtime.
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

Goal-driven runUntil (ephemeral)

```typescript
for await (const event of agent.runUntil("Ship the release notes", { maxTurns: 20 })) {
  // event.type: "status_change" | ... — the judge-gated goal loop
}
```

`agent.runUntil(goal, options)` drives the EPHEMERAL, per-call judge loop: it iterates `agent.send` → judge → continuation until the judge returns done, the judge fails too many times, max turns are exhausted, or the caller aborts. Removed in v4.0 (SE33/SE34): the DURABLE, thread-scoped objective — `agent.setObjective` / `getObjective` / `updateObjectiveOptions` / `clearObjective`, the `ObjectiveRecord` / `DurableGoalOptions` / `AgentGoalConfig` types, `AgentOptions.goal`, and the `<current-objective>` projection. A no-goal `runUntil()` now pauses (there is no durable objective to resolve).

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

AgentFactory.create()

AgentFactory.create(common: Partial<AgentOptions>): AgentFactory;
interface AgentFactory {
  forSession(agentId: string, overrides?: Partial<AgentOptions>): Promise<SDKAgent>;
  getOrCreate(agentId: string, overrides?: Partial<AgentOptions>): Promise<SDKAgent>;
}

Captures shared `AgentOptions` once and produces per-session agents with focused overrides (ADR D23). Merge rules: top-level shallow merge with overrides winning; deep merge for `local`, `memory`, `cloud`; total replace for collection-shaped fields (`mcpServers`, `agents`, `tools`, `providers`, `plugins`, `skills`, `context`). The function-level `agentId` always wins.

const factory = AgentFactory.create({
  apiKey: process.env.Theo_API_KEY!,
  model: { id: "claude-sonnet-4-6" },
  local: { cwd: process.cwd(), settingSources: ["project"] },
  systemPrompt: "You are a helpful assistant.",
});

const agent = await factory.getOrCreate(`tg-user-${userId}`, {
  memory: { enabled: true, namespace: "tg-bot", scope: "user", userId },
});

Use when: chat-bot patterns where 90% of the config is identical across users and only a handful of fields change per session.

Tool.create()

Tool.create<T extends ZodType, O extends ZodType = never>(spec: DefineToolSpec<T, O>): CustomTool;
interface DefineToolSpec<T extends ZodType, O extends ZodType = never> {
  name: string;
  description: string;
  inputSchema: T;
  // With `outputSchema` the handler returns the STRUCTURED value inferred from it; else a string.
  handler: (input: z.infer<T>, ctx?: { signal?: AbortSignal; context?: unknown }) =>
    (O extends never ? string : z.infer<O>) | Promise<O extends never ? string : z.infer<O>>;
  outputSchema?: O;                                              // SE16
  toModelOutput?: (output: O extends never ? string : z.infer<O>) => string | ToolResultContentBlock[]; // SE17
  sanitize?: boolean | SanitizeOptions;
}

Type-safe builder for custom inline tools (ADR D24). Converts a Zod schema to JSON Schema for the LLM-facing `inputSchema` field, wraps the handler with a runtime `schema.parse` step, and preserves type inference. Requires `zod` as a peer dependency.

`outputSchema` (SE16, optional) validates the handler's RETURN value. When set, the handler's return type is inferred from it (`z.infer<O>`); the value is validated against the schema (a string stays as-is, an object is JSON-stringified into the `tool_result`), and a validation failure surfaces as `tool_result(isError)` with the Zod message. Absent ⇒ the handler returns a plain string (unchanged).

`toModelOutput` (SE17, optional) splits what the MODEL sees from what the APPLICATION keeps. The handler keeps returning the FULL result (validated by `outputSchema`); `toModelOutput` maps it to the compact — or multimodal (SE7 `ToolResultContentBlock[]`) — representation placed in the `tool_result` the model reads. The split is REAL end-to-end: the model's `tool_result` carries the compact value, while observability (`onToolEnd.result`) receives the FULL raw handler output (serialized) — so rich app-facing detail is never forced into model context yet is never lost. One handler execution feeds both channels. Absent ⇒ the serialized handler output is what the model sees (SE16 / pre-SE17 behavior).

`sanitize` (optional) cleans the raw model-emitted args BEFORE `inputSchema.parse`, using the primitive from `@theokit/sdk/sanitize` (see below). `sanitize: true` trims whitespace from string values (so a leaked `"\npackage.json\n"` path validates as `"package.json"`); `sanitize: { coerce: true }` additionally coerces string values toward this tool's own schema (a `z.number()` field accepts `"5"`). Absent ⇒ args reach validation untouched. Sanitize is hygiene, not a validity bypass — a genuinely invalid arg still becomes `tool_result(isError)`.

Structured/multimodal tool results + ToolError (SE7)

A tool `handler` returns a string in the common case, but may also return structured content blocks — text and/or an image — so it can hand the model a screenshot or a rendered chart as its result, not just prose:

  handler: () => [
    { type: "text", text: "rendered the chart" },
    { type: "image", source: { type: "base64", media_type: "image/png", data } },
  ]

On failure, throw a ToolError to carry a clean message OR the same structured content (e.g. an error screenshot) back to the model — the SDK turns it into a tool_result with isError: true:

  import { ToolError } from "@theokit/sdk";
  throw new ToolError([
    { type: "text", text: "failed to load the page" },
    { type: "image", source: { type: "base64", media_type: "image/png", data } },
  ]);

A plain Error still works (its message becomes the error text). This is provider-agnostic and capability-based: a provider whose tool-result can carry blocks forwards them natively; a string-only provider flattens text-only blocks to a string and FAILS FAST with a typed ConfigurationError on an image block (a silently-dropped image would be a lie to the model). Types: ImageBlock, ToolResultContentBlock (= TextBlock | ImageBlock).

import { z } from "zod";
import { Tool } from "@theokit/sdk";

const rollTool = Tool.create({
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

SkillReadTool.create() — lazy model-facing skill read (SE23)

```typescript
import { SkillReadTool } from "@theokit/sdk";

const skillRead = SkillReadTool.create(inlineSkills);   // returns a CustomTool named `skill_read`
const agent = await Agent.create({ apiKey, model, skills: { inline: inlineSkills }, tools: [skillRead] });
```

An OPT-IN tool the MODEL can call to lazily read one skill's FULL body (and its SE21 `references`) on demand — the hybrid to eager `<skills>`-block injection when you want the model to pull a skill only when needed. `SkillReadTool.create(skills)` returns a `CustomTool` named `skill_read`; on call it returns the matching skill's `instructions` + `references`, or a typed "not found" string listing the available skills (no throw) for an unknown name. The SDK never auto-injects it — a consumer adds it to `tools`. Agents that don't add it are unchanged (ADR 0007).

Guardrail processors — `inputProcessors` / `outputProcessors` (SE24/SE25)

```typescript
import { Agent, UnicodeNormalizer, TokenLimiter, type Processor } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey, model,
  inputProcessors: [
    UnicodeNormalizer.create({ stripControlChars: true, collapseWhitespace: true }),  // SE25 — deterministic
    TokenLimiter.create({ limit: 4000, strategy: "block" }),
  ],
  outputProcessors: [ TokenLimiter.create({ limit: 2000 }) ],  // default strategy: truncate
});
```

`AgentOptions.inputProcessors` run in order BEFORE the LLM call; `outputProcessors` run on the response. Each `Processor` is `{ id; processInput?; processOutput?; onViolation? }`; a processor may rewrite/redact its text (return a string) or `ctx.abort(reason)` / `ctx.warn(reason)`. An `abort()` genuinely stops the run: the input path returns a terminal `status: "cancelled"` WITHOUT dispatching to the model, and a `tripwire` is surfaced on `RunResult.tripwire` and as a `tripwire` run-event on the stream; subsequent processors are short-circuited. `onViolation` fires on both abort and warn (its own errors are swallowed). Absent ⇒ unchanged (back-compat). Cloud rejects function-carrying processors. Built-in deterministic (no-LLM) processors: `UnicodeNormalizer` (NFC + optional control-char strip + whitespace collapse) and `TokenLimiter` (char estimate ~chars/4 via `estimateTokens`, `truncate` default or `block`). LLM-classifier guardrails (moderation / PII / injection) are built ON this seam — see `docs/concepts/guardrails.md` and ADR 0009; they are deliberately NOT shipped in core.

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


Cron.create(options: CronCreateOptions): Promise<CronJob>;

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
Exactly one target must be set: agent (ephemeral agent created on each fire), agentId (bound to an existing agent for context continuity), or workflow (SE35 — a `Workflow` run on each fire with `inputData`). Setting more than one, or none, is a ConfigurationError. `message` is required for an agent target and forbidden with `workflow`. `Cron.run(jobId)` returns the resulting `Run` for an agent target, or a `WorkflowRun` for a workflow target.

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
  message?: string | SDKUserMessage; // required for an agent target; forbidden with `workflow`
  agent?: AgentOptions;              // mutually exclusive with agentId
  agentId?: string;
  workflow?: Workflow;               // SE35 — schedule a workflow instead of an agent send
  inputData?: unknown;               // SE35 — passed to `workflow.run(inputData)` on fire
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
  message?: string | SDKUserMessage; // required for an agent target; forbidden with `workflow`
  agent?: AgentOptions;
  agentId?: string;
  workflow?: Workflow;               // SE35 — schedule a workflow (mutually exclusive with agent/agentId + message)
  inputData?: unknown;               // SE35 — passed to `workflow.run(inputData)` on fire
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
Both stdio and http/sse MCP server configs accept an optional requestTimeoutMs (default 30000). A request that receives no reply within this window rejects with a typed NetworkError (code: "mcp_timeout") instead of hanging the agent loop — for stdio a silent server process, for http/sse an unresponsive endpoint (enforced via AbortSignal.timeout).

Reconnect-after-drop (M2 #59): if a stdio MCP server child exits or closes mid-session, every in-flight request rejects with a typed NetworkError (code: "mcp_disconnected") instead of hanging, and the next request re-spawns the server + re-runs the initialize handshake with a bounded full-jitter backoff (2 attempts) before surfacing mcp_disconnected. A deliberate close() is not treated as a drop. The http transport is stateless (each request opens a fresh connection), so it reconnects inherently on the next call. Elicitation, server notifications, and adopting the upstream MCP SDK are out of scope.

Resilience error codes (M2). The runtime surfaces these typed NetworkError codes so retry / fallback can route them: circuit_open (#60 — a provider's circuit breaker is open after N consecutive failures; fails fast until a cooldown elapses), stream_idle_timeout (#61 — an SSE stream produced no bytes within the idle bound, default 60s, and was cancelled), stream_truncated (#61 — a stream ended without a finish_reason or [DONE] sentinel; the partial turn is not committed as a clean end_turn), and mcp_disconnected (#59, above). The pool also inserts a full-jitter backoff before retrying a rate-limited (429) key.

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

Each subagent is offered to the supervisor as a delegation tool and runs as an isolated child agent. The child inherits the supervisor's apiKey and model automatically — you do not repeat them; a `model` on the definition (or `"inherit"`) overrides the model, and `tools` scopes the child to that subset of the parent's tools (absent → the parent's full toolset). Per-subagent `mcpServers` on a definition are honored by the cloud runtime.

Context, memory, and skills
Context, memory, and skills are loaded before MCP tools and subagents are offered to a run:

Context is task working-set. It is selected per agent from inline config or `.theokit/context/<name>.md` (legacy `.theokit/context.json` still supported until v2.0 — see Configuration files / deprecation), bounded by `maxTokens`, and exposed through `agent.context.snapshot()`.
Memory is durable recall. It persists facts by `{ namespace, userId, scope }`, rejects stores outside the workspace, and must redact credential material.
Skills are named capability packs. They are loaded from `.theokit/skills/*/SKILL.md`, listed with `agent.skills.list()`, and only expose public metadata in streams and snapshots.

`agent.reload()` refreshes file-based context and skills without disposing the agent or losing conversation state. An invalid **context** config (malformed content or wrong shape) raises `ConfigurationError`. A **skill** with malformed frontmatter is handled differently: it is skipped with a stderr warning and excluded from `agent.skills.list()`, and reload resolves normally (graceful-degrade — a single broken skill never blocks the agent).

Hooks
Hooks are file-based only. There is no programmatic hook callback. Hooks are a project policy boundary, not a per-run knob.

The `stop` hook fires each time a local agent finishes a turn cleanly (it does NOT fire on an errored run or when the iteration ceiling truncates the turn). A `stop` hook that returns `{"decision":"feedback","feedback":"…"}` re-prompts the agent with that text and the loop continues — a bounded reflection ladder (at most 2 re-prompts per run, mirroring the nudge ceiling, so a hook cannot loop forever; once that ceiling is reached the hook still fires on the final finish but its feedback no longer re-prompts). `{"decision":"allow"}` (or no `stop` hook) finishes normally; `deny` at `stop` also finishes (the answer already exists — there is nothing to block) and is authoritative regardless of hook ordering.

Local: Add `.theokit/hooks.json` (Claude-Code-shaped) to the repo passed as local.cwd, or `~/.theokit/hooks.json` for user-level hooks. (The old `.theokit/hooks/*.md` form is no longer supported — ADR 0016.)
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
local	{ cwd?: string | string[]; baseDir?: string; sessionStore?: SessionStore; settingSources?: SettingSource[]; sandboxOptions?: { enabled: boolean } }		Local agent config. baseDir is the native session-transcript root (default ~/.theokit; a leading ~ is expanded; set ~/.claude for Claude Code CLI --continue interop). sessionStore (SE41) injects an external session store (readRecords/appendRecords over the native SessionRecord shape) as the primary store + resume source for serverless / multi-host; omit for the FS default. settingSources picks ambient settings layers: "project", "user", "team", "mdm", "plugins", or "all".
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
autoCreatePR	boolean	false	Cloud-only (pre-release). Open a PR when the run finishes. Sent to Theo PaaS; contract-only until PaaS ships.
skipReviewerRequest	boolean	false	Skip requesting the calling user as a reviewer on the PR.
AgentDefinition
Property	Type	Default	Description
description	string	required	When to use this subagent. Shown to the parent agent so it knows when to spawn.
prompt	string	required	System prompt for the subagent.
model	ModelSelection | "inherit"	"inherit"	Model override. Pass "inherit" to use the parent's selection.
mcpServers	Array<string | Record<string, McpServerConfig>>		MCP servers available to this subagent. Names reference servers from the parent's mcpServers.
tools	string[]	(unscoped)	Tool whitelist (M4-6). When set, the subagent may ONLY call tools whose canonical (post-repair, lowercase) name is in this list — any other tool call is vetoed at dispatch via the same `withToolWhitelist` enforcement forks use (NOT `PermissionEngine`). Absent/empty → unscoped (inherits the parent's full toolset). Apply it around a subagent run with `withSubagentToolScope(definition, fn)` from `@theokit/sdk/subagents`; in `.theokit/agents/*.md` declare it as a comma/space-separated frontmatter field (`tools: read_file, list_dir`). A `tools: ["read_file"]` subagent provably cannot Write/Bash.

#### Subagent tool scoping — `@theokit/sdk/subagents`

`subagentToolWhitelist(definition): Set<string> | undefined` derives the whitelist `Set` from `AgentDefinition.tools` (or `undefined` when unscoped). `withSubagentToolScope(definition, fn)` runs `fn` under that whitelist via the SDK's existing `withToolWhitelist` enforcement — the same dispatch veto (`checkToolWhitelist`, exit 126 "Tool blocked by fork whitelist") that `Agent.fork`'s `allowedTools` uses. Enforcement, not `PermissionEngine`.

```typescript
import { withSubagentToolScope } from "@theokit/sdk/subagents";

// definition.tools = ["read_file"] → inside this scope, write_file / shell_exec are vetoed at dispatch
await withSubagentToolScope(readOnlyDefinition, async () => {
  // run the sub-agent here (e.g. via agent.fork) — its non-whitelisted tool calls are blocked
});
```

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

`AgentOptions.skills` also accepts a **resolver function** (SE22) — `(ctx: SkillsResolverContext) => SkillsSettings | Promise<SkillsSettings>` — evaluated per `send()` before skill assembly, so the active skill set can vary by run/context (e.g. admin vs. user). Mirrors the `systemPrompt` resolver. The context carries `agentId`, `cwd`, `model`, `userMessage`, and `memory`. No SDK timeout is imposed; a throwing resolver fails the run (fail-fast). A static `SkillsSettings` behaves exactly as before (back-compat). Local runtime only — cloud rejects the function form (`cloud_incompatible_function_resolver`).

SDKSkillsManager

interface SDKSkillsManager {
  list(): Promise<Array<{ name: string; description: string }>>;
  // SE20 — read one skill's full body programmatically.
  get(name: string): Promise<SDKAgentSkillDetail | undefined>;
}
interface SDKAgentSkillDetail {
  name: string;
  description: string;
  instructions: string;                    // the full SKILL.md body (frontmatter stripped)
  references?: Record<string, string>;      // SE21 — supporting docs bundled on the skill
}
`list()` returns metadata only (name + description) — it must not return full `SKILL.md` prompt bodies. `get(name)` (SE20) returns one skill's FULL body: for a file-based skill it reads the `SKILL.md` at the resolved source and strips the frontmatter; for an inline skill it returns the `instructions` directly. Returns `undefined` when no skill matches (and for a malformed/excluded skill — same exclusion as `list()`). The optional `references` map (SE21) carries any supporting docs bundled on an inline skill via `Skill.create({ references })`.
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
Hooks are file-based only (`.theokit/hooks.json`, Claude-Code-shaped; the old `.theokit/hooks/*.md` form is no longer supported). No programmatic callbacks.
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

- `Semaphore.create(permits)` — N-permit async-aware counting semaphore. `acquire()` returns a release function (call once, typically in `finally`). Release is idempotent.
- `mapWithConcurrency(items, concurrency, fn, { signal? })` — map `fn` over `items` with at most `concurrency` invocations in flight, **preserving input order** in the result array. Fail-fast (rejects with the first task error); an aborted `signal` stops new work from starting. Throws `ConfigurationError` (`invalid_concurrency`) when `concurrency` is not a positive integer.

```ts
import { mapWithConcurrency } from "@theokit/sdk/concurrency";

const results = await mapWithConcurrency(urls, 4, (url) => fetchJson(url)); // ≤4 in flight, ordered
```

#### Retry — `@theokit/sdk/retry`

`Retry.create(fn, options?)` — run `fn`, retrying transient failures with exponential backoff + full jitter. The default `isRetryable` predicate is `isTransientError`, so it retries exactly what the SDK classifies as transient (rate-limit, network, credential-pool-exhausted) and rethrows the rest immediately. `sleep` and `rng` are injectable for deterministic tests (no real timers).

Options: `retries` (default 3), `isRetryable`, `initialDelayMs` (100), `maxDelayMs` (30_000), `backoffMultiplier` (2), `rng`, `sleep`, `signal`.

```ts
import { Retry } from "@theokit/sdk/retry";

const data = await Retry.create(() => agent.send(message, { throwOnError: true }), { retries: 5 });
```

#### Tool input sanitization — `@theokit/sdk/sanitize`

Public, isolated primitive for cleaning the raw arguments a model emits for a tool call, so custom-tool authors don't hand-roll defensive parsing. Pure, synchronous, and **total** — it never throws (a non-object input is returned unchanged) and never changes a value's meaning, only its hygiene/representation.

```ts
function sanitizeToolInput(input: Record<string, unknown>, options?: SanitizeOptions): SanitizeResult;
interface SanitizeOptions {
  trim?: boolean;       // default true
  coerce?: boolean;     // default false — "5"→5, "true"→true, "null"→null, JSON strings→arrays/objects
  repairJson?: boolean; // default false — repair-then-parse malformed JSON-looking strings (via jsonrepair)
  schema?: ZodType;     // when a z.object, coercion is schema-aware (a z.string() field keeps "5")
  deep?: boolean;       // default false — recurse into nested objects (bounded by maxDepth, default 8)
  maxDepth?: number;
}
interface SanitizeResult<T = Record<string, unknown>> { value: T; changed: boolean; notes: string[]; }
```

Coercion is guarded against silent corruption: numeric coercion round-trips and stays finite, so ID-like strings (`"12345678901234567890"`, `"007"`) and `NaN`/`Infinity` are left as strings; JSON repair only runs on `{`/`[`-looking values. `notes` records a line per change for logging.

```ts
import { sanitizeToolInput } from "@theokit/sdk/sanitize";

const { value } = sanitizeToolInput({ path: "\nsrc/index.ts\n", n: "5" }, { coerce: true });
// value → { path: "src/index.ts", n: 5 }
```

Most consumers use it declaratively via `Tool.create({ sanitize })` (above) rather than calling it directly. The SDK's own leaked-dialect recovery reuses this same primitive, so the public surface and the internal path never diverge.

#### Message readers — `@theokit/sdk/messages`

Pure readers over the `SDKMessage` stream, public from the `@theokit/sdk/messages` sub-path, so agent/server builders extract assistant text, tool uses, and honest cost without re-implementing a wire-event mapper. All three are pure (no I/O, inputs never mutated).

- `assistantText(msg)` — concatenates an assistant message's `text` blocks; returns `""` for any non-assistant message (or one with no text blocks). `tool_use` blocks are ignored.
- `extractToolUses(msg)` — returns the assistant message's `ToolUseBlock[]`; `[]` for non-assistant. It reads the assistant content blocks, NOT the separate `SDKToolUseMessage` (`type:"tool_call"`) lifecycle event — that is a different stream.
- `costAmountUsd(cost)` — reads `RunResult.cost.amountUsd`, preserving `number | undefined` verbatim. An unknown cost stays `undefined` (never coerced to `$0`), distinct from a real `$0` subscription-included route — the cost-honesty contract (ADR D377). Token counts (where `0` is meaningful) are read directly off `TokenUsage`.

```ts
import { assistantText, extractToolUses, costAmountUsd } from "@theokit/sdk/messages";

for await (const msg of run.stream()) {
  const text = assistantText(msg);        // "" unless this is an assistant message
  const tools = extractToolUses(msg);     // ToolUseBlock[] from the assistant content
  if (text) process.stdout.write(text);
  for (const tool of tools) console.log("tool:", tool.name);
}

const usd = costAmountUsd(result.cost);   // number | undefined — `undefined` means "unknown", never $0
```

#### Compaction — `@theokit/sdk/compaction`

Public compaction / context-management helpers, so consumers manage the context window without reaching into `internal/`. They operate on the SDK's own `CompressibleMessage` (`{ role: "user" | "assistant" | "system"; content: string }`, re-exported from this sub-path).

- `compactTranscript(messages, { keepRecent = 6, keepTokens?, marker?, summaryTemplate?, summarize?, failSafe? })` — keeps a recent window verbatim and either summarizes the older window (via the optional `summarize` callback) or drops it. Two recent-window modes:
  - **turn-count (default):** `keepRecent` (default 6) keeps the last N turns and **always preserves leading `system` PROMPTS**. Checkpoint markers are NOT system prompts — they flow through the keep-recent window as ordinary turns. Reuses the SDK's internal compaction window.
  - **token-budget:** set `keepTokens` to keep the trailing turns whose accumulated `estimateTokens` fits the budget (walks from the end, always keeps ≥ 1 turn). When `keepTokens` is set it takes precedence over `keepRecent` AND leading system prompts are **not** specially preserved (they participate in the budget walk like any turn).

  `summarize` receives `(older, template)` and returns the summary turn; `template` defaults to `SUMMARY_TEMPLATE` (a 7-section template: Goal / Constraints / Progress / Decisions / Next / Critical / Files) and is overridable via `summaryTemplate`. `marker` (default `CHECKPOINT_MARKER`, must be non-empty) lets a consumer use a custom checkpoint sentinel (e.g. an already-persisted `<conversation-checkpoint>`). Never mutates the input; always returns a `Promise`. **Error handling:** by default a thrown `summarize` **propagates** — the caller decides the fallback. Set `failSafe: true` to instead return the ORIGINAL transcript unchanged + a structured `console.warn` (compaction as an optimization that never loses data).
- `buildCheckpoint(label?, marker = CHECKPOINT_MARKER)` → a `system` marker turn whose content begins with `marker` (a visible, prose-unlikely sentinel — no invisible control bytes, safe to persist; empty `marker` throws). `filterFromLatestCheckpoint(messages, { marker?, include = "after" })` → relative to the most recent marker (all turns if none): `"after"` (default) returns the turns AFTER the marker (exclusive, the M2 default); `"from"` returns the turns FROM the marker inclusive (the summary checkpoint stands in for the pruned head). Use to bound replay to "since the last checkpoint".
- `SUMMARY_TEMPLATE` — the default 7-section summary template handed to `summarize`. Exported so a consumer can reuse or extend the exact section shape.
- `isContextOverflowError(err)` — `true` iff `err` is a `TheokitAgentError` (or subclass) reporting the typed `context_too_long` code (checks `err.code` and `err.metadata?.code`).
- `estimateTokens(text)` — a tokenizer-free token estimate (`ceil(text.length / 4)`, the ~4-chars-per-token heuristic): `""` → 0, any non-empty text → ≥ 1. A cheap PRE-CALL gate, not exact tokenization.
- `shouldCompact({ estimated, contextWindow, buffer })` — decide BEFORE sending whether to compact: `true` when `estimated >= contextWindow - buffer` (the estimate leaves less than `buffer` headroom). Pure — pass the window yourself (e.g. from `resolveModelCapabilities`), so it stays decoupled from any per-model catalog.

#### Model capabilities — `@theokit/sdk/models`

`resolveModelCapabilities(modelId): ModelCapabilities` returns a model's capability flags + `maxContextTokens`/`maxOutputTokens` from a static, OFFLINE catalog (pure, sync, no network). It strips routing prefixes (`openrouter/`/`vertex/`/`bedrock/`) and OpenRouter `:variant` suffixes (`openai/gpt-4o:free` → `openai/gpt-4o`) before lookup; unknown models get conservative defaults (`4096`/`4096`, all flags false). Pair `maxContextTokens` with `shouldCompact` for a pre-call compaction decision.

The subpath also exports model-id helpers for UIs (M5-8): `parseModelId(modelId): { provider, name }` splits the provider prefix from the model name (handles OpenRouter routing + tag suffixes); `humanizeModelName(modelId): string` is a best-effort human label (strips routing/vendor, title-cases the core, appends an OpenRouter `:variant` in parens — e.g. `"openrouter/openai/gpt-4o:free"` → `"GPT 4o (free)"`); `toModelOption(modelId): { value, label, provider }` builds a dropdown entry. Best-effort labels — not vendor-canonical marketing names; a UI can override per id.

```ts
import { parseModelId, humanizeModelName, toModelOption } from "@theokit/sdk/models";

parseModelId("openrouter/openai/gpt-4o:free"); // { provider: "openrouter", name: "openai/gpt-4o:free" }
humanizeModelName("anthropic/claude-3-5-sonnet"); // "Claude 3 5 Sonnet"
const options = modelIds.map(toModelOption); // [{ value, label, provider }, …] for a <Select>
```

```ts
import { resolveModelCapabilities } from "@theokit/sdk/models";
import { estimateTokens, shouldCompact } from "@theokit/sdk/compaction";

const { maxContextTokens } = resolveModelCapabilities("openrouter/openai/gpt-4o:free");
if (shouldCompact({ estimated: estimateTokens(prompt), contextWindow: maxContextTokens, buffer: 4000 })) {
  history = await compactTranscript(history, { keepRecent: 4 });
}
```

```ts
import {
  compactTranscript,
  buildCheckpoint,
  filterFromLatestCheckpoint,
  isContextOverflowError,
} from "@theokit/sdk/compaction";

// Keep the last 6 turns; summarize the rest with the model.
const compacted = await compactTranscript(history, {
  keepRecent: 6,
  summarize: async (older) => ({ role: "assistant", content: await summarizeWithLlm(older) }),
});

const recent = filterFromLatestCheckpoint([...history, buildCheckpoint("after-tools")]);

try {
  await agent.send(message, { throwOnError: true });
} catch (err) {
  if (isContextOverflowError(err)) history = await compactTranscript(history, { keepRecent: 4 });
}
```

#### Skills discovery — `@theokit/sdk/skills`

First-party skill discovery + `<skills>` block, so consumers orient an agent with the skills it can invoke without hand-rolling a frontmatter parser. These are the same primitives the SDK runtime uses internally for `.theokit/skills` discovery and `<skills>` injection.

- `discoverSkills(dir, options?)` — discover `<dir>/<name>/SKILL.md` files under an **arbitrary** directory (not a hardcoded `.theokit/skills` root). Parses strict YAML frontmatter (`name`/`description` required; `category`/`dependencies` optional), returning `Skill[]` (`{ name, description, source, category?, dependencies? }` — the skill BODY is never included). A subdirectory whose realpath escapes `dir` via symlink is skipped (symlink-escape guard, reusing `@theokit/sdk/path-safety`). **Never throws** — a missing/unreadable/non-directory path yields `[]`. A `SKILL.md` with malformed frontmatter is excluded and (optionally) reported via `options.onInvalidSkill({ name, source, code, message })`; a directory WITHOUT a `SKILL.md` is silently skipped (not a malformed skill). Discovery order follows the filesystem `readdir` order (OS-dependent) — sort the result before `buildSkillsBlock` if a stable block order matters.
- `buildSkillsBlock(skills)` — render the prompt-injection-safe `<skills>` block (`- name: description` per skill, both fields XML-escaped). Accepts the structural subset `{ name, description }[]`; returns `undefined` for an empty list (so the caller can omit the block).

```ts
import { discoverSkills, buildSkillsBlock } from "@theokit/sdk/skills";

const skills = await discoverSkills("./.theokit/skills", {
  onInvalidSkill: ({ name, code }) => console.warn(`skill ${name} skipped: ${code}`),
});
const block = buildSkillsBlock([...skills].sort((a, b) => a.name.localeCompare(b.name)));
// block: "<skills>\n  - code-review: …\n</skills>" (or undefined when no skills)
```

#### Project instructions — `@theokit/sdk/project`

Hierarchical reader/writer for a project-instruction file (default `THEO.md`; also `CLAUDE.md`/`AGENTS.md`), composing the SDK's own hardened walk-up discovery + atomic writer.

- `readProjectInstructions(cwd, options?)` — walk up from `cwd` collecting `<dir>/<filename>` (default `THEO.md`) up to the filesystem root (or `options.stopDir`). Returns `{ files, content }`: `files` is the found files **nearest-first** (`{ path, content }[]`, each read in full — never truncated), `content` is a reduction chosen by `options.scope` — `"nearest"` (default; innermost file's content) or `"merged"` (all files joined root-first, so the nearest/most-specific text appears last). **Never throws** — a missing/unreadable directory or a path that exists but is not a readable file (e.g. a directory named `THEO.md`) is skipped; no file → `{ files: [], content: undefined }`.
- `writeProjectInstructions(cwd, content, options?)` — write `<cwd>/<filename>` atomically (temp + fsync + rename). Unlike the reader, this **fails loud**: a write error (e.g. the parent directory does not exist) propagates to the caller.

```ts
import { readProjectInstructions, writeProjectInstructions } from "@theokit/sdk/project";

const { content, files } = await readProjectInstructions(process.cwd(), { scope: "merged" });
// content: outer THEO.md + "\n\n" + nearest THEO.md (root-first); files: nearest-first with paths

await writeProjectInstructions(process.cwd(), "# Project rules\n…"); // atomic THEO.md write
```

## Built-in tools for coding agents (v1.x+)

Drop-in toolkit available at `@theokit/sdk/tools`. Each factory takes `{ projectRoot }` and returns a `CustomTool` ready to plug into `Agent.create` or `AgentFactory.create({ tools: [...] })`. All five share the same three rules:

1. **Project-scoped.** Every I/O call passes through `safePathJoin` + `assertNoSymlinkEscape`.
2. **Sensitive files refused.** `.env*` (except `.env.example`), `.git/`, `node_modules/`, `.theo/`, lock files via `isForbiddenPath`.
3. **JSON returns, never throws on user mistakes.** Handlers always return a JSON string. Real exceptions reserved for SDK-side bugs (input parse errors).

### `web_fetch` — SSRF guard (secure by default)

`createWebFetchTool()` screens every request (and every redirect hop) against an SSRF block-list **by default**. A URL whose host resolves to a private/loopback/link-local/CGNAT/cloud-metadata/reserved address — IPv4 or IPv6, including IPv4-mapped `::ffff:` and DNS names that resolve to such addresses — returns `{ ok: false, error: "ssrf_blocked", reason }`. Redirects use `redirect:"manual"` and each hop is re-screened (a redirect to `127.0.0.1` or `169.254.169.254` is blocked, not followed); non-http(s) redirect targets are rejected.

Opt out only for trusted local-dev tooling: `createWebFetchTool({ allowPrivateHosts: true })`.

The screening primitives are also exported from `@theokit/sdk-tools` for reuse: `resolveAndScreen(host)` (resolves ALL A-records, throws `SsrfBlockedError` if any is blocked), `isBlockedIp(ip)`, and `screenedFetch(url, opts)`. Implemented with Node `dns`/`net` builtins — zero dependencies.

### `shell_exec` — catastrophic-command guardrail (secure by default)

`createShellTool()` screens every command against a segment-aware deny-list **by default**. A command that matches a catastrophic pattern in any segment — across `;`/`&&`/`||`/pipe chains, behind a `sudo`/`env` prefix, or piped into a shell — returns `{ ok: false, error: "catastrophic_command", reason }` instead of executing. The screened set: `rm -rf` of a root/home/glob or top-level system-dir target (`/`, `~`, `$HOME`, `/etc`, `/usr`, `/var`, … — a relative target like `./build` stays allowed), `curl`/`wget` piped into `sh`/`bash`, `mkfs`, `dd` writing to a device, the `:(){ :|:& };:` fork bomb, `git push --force` (including the `+refspec` form; `--force-with-lease` is allowed), `chmod`/`chown -R` on a root path, and redirects to a block device (`> /dev/sda`). Matching is at command position (the executable, not an arbitrary substring), so a mention like `echo "rm -rf /"` is not over-blocked.

Opt out for legitimate destructive power flows: `createShellTool({ allowCatastrophic: true })`.

This is a heuristic **guardrail, not a sandbox** — it blocks obvious/accidental catastrophes but is bypassable by obfuscation (eval/base64) and is POSIX-only (Windows PowerShell is out of scope). The reusable primitives `catastrophicShellReason(command)` (returns a reason string or `null`) and `CatastrophicCommandError` are exported from `@theokit/sdk-tools`. Zero new dependencies (in-house segment tokenizer).

### Repo-map / env-context builders

`@theokit/sdk-tools` exports two `node:fs`-only, char-bounded, **never-throw** string builders that orient an LLM coding agent in one call — inject them into the system prompt:

- `buildEnvContext(cwd): string` — a short `<env>` block: working directory, platform/arch, Node version, whether the directory is a git repo (detected by the presence of `.git`, no `git` subprocess), today's date, the project docs found (`AGENTS.md`/`CLAUDE.md`/`README.md`, with a bounded head of the first one), and the detected manifests (`package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod`).
- `buildRepoMap(cwd, { budget?, ignore?, maxDepth? }): string` — a depth-first directory tree bounded by `budget` (default 8000 chars, stops with a `… (truncated)` marker), `maxDepth` (default 4), and a per-directory entry cap. The default ignore set (`node_modules`, `.git`, `dist`, `.theo`, `.next`, `build`, `coverage`, `target`, `out`, plus any dot-entry) is merged with the caller-supplied `ignore`. Directory symlinks are listed as leaves (not followed), so symlink loops cannot hang the walk.

Both NEVER throw — a missing/unreadable `cwd` yields an `(unavailable: …)` marker and an unreadable sub-directory is skipped. They are a best-effort orientation aid, not a complete or `.gitignore`-aware listing (deferred). Zero new dependencies.

### Rich tool errors — self-correction guidance

`@theokit/sdk-tools` exports a composable wrapper that adds an LLM-actionable `guidance` hint to a failing tool result, so the model can self-correct without a human round-trip:

- `withToolResultGuidance(tool, guidance): CustomTool` — wraps any tool; when its result is `{ ok: false, error }`, a `guidance` string from the `guidance` map (keyed by error code) is added to the payload. Preserves name/description/inputSchema.
- `withDefaultGuidance(tool)` — `withToolResultGuidance` pre-bound to `DEFAULT_TOOL_GUIDANCE`, a curated map for the common codes (`not_found`, `path_traversal`, `forbidden_path`, `no_match`, `timeout`, `invalid_url`, `ssrf_blocked`, `catastrophic_command`, `binary_file`, `too_large`).
- `injectGuidance(handlerOutput, guidance)` — the pure underlying transform (exported for testing).

Injection is ADDITIVE (only on `ok:false`), IDEMPOTENT (never overwrites an existing `guidance`), and NEVER-THROW: a non-JSON output, an `ok:true` result, a non-object JSON value, or an unknown error code is returned UNCHANGED. Compose it over the built-in tools or your own — no factory edits required. Example: `withDefaultGuidance(createReadFileTool({ projectRoot }))`. Zero new dependencies.

### ACI — tool description override + render `<tools>`

The wording of a tool's `description` (its Agent-Computer Interface) materially affects how reliably the model selects it. `@theokit/sdk-tools` exports two pure, zero-dependency helpers to tune and surface it:

- `withDescription(tool, description): CustomTool` — returns a NEW tool with the description replaced (name/inputSchema/handler preserved); the original tool is not mutated. Use it to tune a built-in tool's wording for your domain without re-implementing it.
- `renderToolList(tools): string` — renders a `<tools>` block (name + description per tool) from the SAME `CustomTool[]` your agent runs, so the rendered list cannot drift from the real tools (single source of truth). An overridden/added/removed tool is reflected automatically. Descriptions are XML-escaped; an empty array yields `<tools></tools>`; it never throws. The block is a system-prompt orientation aid — the provider tool-call schema stays each tool's `inputSchema`.

### Command-permission policies

`PermissionEngine` (from `@theokit/sdk`) gates a tool call by name AND, since #55, by its argument values: a `PermissionRule` may declare `args?: Record<string, string | RegExp | (v) => boolean>`, and `evaluate(toolName, args?)` matches a rule only when the tool name matches AND every declared arg predicate matches — so a single `shell` rule can deny `rm -rf` while allowing `ls`. A missing argument fails its predicate (the rule does not match; never throws). **Behavior change (#55):** the default when no rule matches is now `"ask"` (fail-closed) — a permission engine that cannot positively allow must not silently allow. Restore the previous fail-open behavior with `new PermissionEngine(rules, { defaultAction: "allow" })`. `PermissionPlugin.create(engine)` forwards the tool arguments into `evaluate`, so arg-level gating works through the `pre_tool_call` flow automatically. A delegated subagent inherits the parent's plugins (#55), so the same arg-level gate applies to the child's inner tool calls — arg-gating does not stop at the delegation boundary. Caveats: rule evaluation is **first-match** (order deny rules before broader allows — deny does not intrinsically win); `string`/`RegExp` arg matchers key **top-level** args only (use a `(v) => boolean` predicate to reach nested values); a predicate that itself throws is not caught — it fails closed by aborting the turn (the tool never runs) rather than emitting a clean deny. A `RegExp` matcher with a `g`/`y` flag is reset before each test, so authorization is deterministic across repeated calls.

**Permission modes + the `canUseTool` gate (SE1).** On top of the rules, a per-run `PermissionMode` adjusts every verdict, and an `ask` verdict routes to an enriched `canUseTool` gate — matching the Anthropic SDK's operational shape, provider-agnostic.

- **Modes** — `PermissionMode` ∈ `default | plan | acceptEdits | bypass` (`bypassPermissions` is accepted as the Anthropic-exact alias of `bypass`):
  - `default` — rules decide; an unmatched call is `ask` (fail-closed).
  - `plan` — read-only: only `allow` rules pass; everything else (including unmatched) is denied.
  - `acceptEdits` — auto-approve the unmatched default, but still honor an explicit `ask` rule.
  - `bypass` / `bypassPermissions` — allow everything EXCEPT an explicit `deny` rule; never asks.
  - An explicit `deny` rule is **immune to every mode** — no auto-approve mode can un-deny it.
- **Precedence** — the mode is resolved **per run**: `SendOptions.permissionMode` (per-send) wins over `AgentOptions.permissionMode` (creation-time default); absent both, the `PermissionPlugin`'s construction-time `mode` applies; absent that, `default`.
- **`canUseTool`** — `PermissionPlugin.create(engine, { canUseTool })`. On an `ask` verdict the gate `(toolName, input, { toolName, mode }) => { behavior: "allow" | "deny", message? }` is consulted (may be async — a real gate can prompt a human via the pre-tool seam). **Fail-closed (allow-list):** only an explicit `{ behavior: "allow" }` passes; a `deny`, a throwing gate, an absent gate, or any malformed return blocks. A denied call surfaces a typed `permission_denied` `RunEvent` plus a tool-result the model can self-correct on — never a silent no-run.

```ts
const agent = await Agent.create({
  …,
  plugins: [PermissionPlugin.create(engine, { canUseTool })],
  permissionMode: "default",          // creation-time default
});
await agent.send("…", { permissionMode: "plan" });   // per-send override (read-only run)
```

For agents that gate shell commands at a permission layer, `@theokit/sdk-tools` exports a small composable policy layer that builds on the `shell_exec` catastrophic guardrail:

- `type CommandPolicy = (command: string) => string | null` — a pure predicate returning a deny REASON, or `null` to allow.
- `denyCatastrophicCommands(): CommandPolicy` — a policy that denies catastrophic commands by composing `catastrophicShellReason` (no duplicated deny-list).
- `commandDenialReason(command, policies): string | null` — the first deny reason across the policy array (deny-wins); `null` if every policy allows. An empty array denies nothing.
- `isCommandAllowed(command, policies): boolean` — the boolean view (`true` when no policy denies).

The policy is framework-agnostic — wire it at your permission layer. Example inside a `pre_tool_call` hook:

```typescript
import { commandDenialReason, denyCatastrophicCommands } from "@theokit/sdk-tools";

const policies = [denyCatastrophicCommands()];
// in a pre_tool_call hook:
if (ctx.name === "shell_exec") {
  const reason = commandDenialReason(String(ctx.args.command ?? ""), policies);
  if (reason) return { block: true, message: `Command refused: ${reason}` };
}
```

It inherits the guardrail's honesty: a heuristic gate, not a sandbox. Zero new dependencies.

### Web-search provider adapter — Brave

`createWebSearchTool` is provider-agnostic (it takes a `WebSearchCallback`). `@theokit/sdk-tools` ships ONE concrete env-driven adapter — Brave — that plugs into that seam:

- `createBraveWebSearchAdapter({ apiKey?, fetchImpl?, endpoint? }): WebSearchCallback` — queries the Brave Search API. The key defaults to `process.env.BRAVE_API_KEY`; if neither an explicit `apiKey` nor the env var is set, it throws a typed `ConfigurationError` (code `no_api_key`) at creation (fail-early). `fetchImpl` is injectable (default `globalThis.fetch`) for offline testing. A non-ok HTTP response throws, which `createWebSearchTool` maps to `{ ok: false, error: "search_failed" }`; an empty/odd response maps to `[]`.

```typescript
import { createWebSearchTool, createBraveWebSearchAdapter } from "@theokit/sdk-tools";

const tool = createWebSearchTool({ search: createBraveWebSearchAdapter() }); // reads BRAVE_API_KEY
```

The adapter uses a plain `fetch` (not `screenedFetch`): the endpoint host is fixed (no SSRF surface) and the Brave auth header must be sent. Additional providers (e.g. Tavily) are a follow-up — `createWebSearchTool` stays provider-agnostic. Zero new dependencies.

### Session artifact store + plan-mode persistence

`@theokit/sdk-tools` exports a generic, id-keyed, atomic artifact store (the reusable generalization of the per-run session-summary writer) and wires it opt-in into `createPlanModeTool`:

- `createSessionArtifactStore({ dir, idStrategy?, extension? })` → `{ write, read, has, list, path }`. `write(id, content)` persists `<dir>/<idStrategy(id)><extension>` atomically (temp + fsync + rename) and returns the path; `read(id)` returns the content or `undefined` (never throws); `has`/`list` enumerate stored artifacts; `path(id)` is the traversal-safe location. `idStrategy` defaults to `safeFilenameForId` (accepts ANY id, deterministically hashing non-conforming input), and every id additionally passes through `safePathJoin` — so a `../escape` id can never write outside `dir`. `extension` defaults to `.md`. Reads never throw; writes fail loud.
- `createPlanModeTool({ artifactStore, artifactId? })` — an OPT-IN overload whose async handler persists the submitted `plan` to the store on `exit` (returning `{ ok, mode, message, persisted, path }`). The zero-arg `createPlanModeTool()` keeps a synchronous handler and never touches disk. Only a non-empty `plan` on `exit` is persisted; `enter`/`status` never write.

```typescript
import { createSessionArtifactStore, createPlanModeTool } from "@theokit/sdk-tools";

const store = createSessionArtifactStore({ dir: ".theokit/plans" });
const planMode = createPlanModeTool({ artifactStore: store, artifactId: runId });
// agent calls plan_mode { action: "exit", plan: "1. …\n2. …" } → persisted to .theokit/plans/<runId>.md
await store.read(runId); // the persisted plan, or undefined
```

### Todolist structured items + plan nodes

The `todolist` tool (`createTodolistTool`) tracks multi-step work. Every success result carries BOTH a human `items_summary` (formatted text the LLM reads) AND a structured `items: TodoItem[]` snapshot (for a consumer rendering a plan/UI). `todoItemsToPlanNodes(items)` converts those items into versioned `PlanNode`s (`{ id, label, status }` — timestamps dropped).

```typescript
import { createTodolistTool, todoItemsToPlanNodes } from "@theokit/sdk-tools";

const todo = createTodolistTool();
const result = JSON.parse(todo.handler({ action: "add", title: "Write the migration" }));
// result.items === [{ id: "todo-1", title: "Write the migration", status: "pending", createdAt: … }]
const planNodes = todoItemsToPlanNodes(result.items); // [{ id: "todo-1", label: "Write the migration", status: "pending" }]
```

```typescript
import { AgentFactory } from "@theokit/sdk";
import {
  createReadFileTool,
  createListDirTool,
  createSearchTextTool,
  createGitDiffTool,
  createRunVitestTool,
} from "@theokit/sdk/tools";

const projectRoot = process.cwd();
const factory = AgentFactory.create({
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

Most user-edited config in `.theokit/` uses **markdown + YAML frontmatter** — same shape as `skills/<name>/SKILL.md`. **Hooks are the exception: they use JSON, in the exact Claude Code `settings.json` shape** (ADR 0016 — a hook's markdown body is inert, and Claude Code configures hooks in JSON).

```
.theokit/
├── hooks.json                     # Claude-Code-shaped hooks (ADR 0016)
├── context/                       # one .md per context source
│   └── bot-readme.md
├── plugins/<name>/                # PLUGIN.md per plugin (nested)
│   └── PLUGIN.md
└── skills/<name>/SKILL.md         # markdown
```

Example `.theokit/hooks.json` (identical to a Claude Code hooks block):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "shell",
        "hooks": [ { "type": "command", "command": "node .theokit/policy.js", "timeout": 30 } ] } ]
  }
}
```

Events map to the SDK's five firing points: `PreToolUse`→preToolUse, `PostToolUse`→postToolUse, `UserPromptSubmit`→preRun, `Stop`→stop (unsupported Claude Code events are skipped with a warning). The command gets the payload as JSON on stdin; a non-zero exit on `PreToolUse` / `UserPromptSubmit` blocks. The old `.theokit/hooks/*.md` form is no longer supported (a stray markdown dir warns to migrate).

**Migration.** A standalone CLI converts legacy `.theokit/context.json` /
legacy `.theokit/plugins/<name>/plugin.json` to the markdown form (hooks migrate the
other way, back to `.theokit/hooks.json`):

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

## Persistence helpers (v2.6+) — `@theokit/sdk/persistence`

Stable, semver-protected persistence primitives for harness consumers (eval
runners, config/plan stores). Promoted from the semver-exempt
`internal/persistence` so you adopt them without coupling to `internal/`.

> **Deprecation (SE43, DoD#2).** The `@theokit/sdk/internal/persistence` export is
> **deprecated** — import the shared kernel (`replaceFileAtomic`, `withCwdMutex`,
> `openSqliteResilient`, `sanitizeFts5Query`, `PersistenceSchema`, `atomicWriteText`,
> `atomicWriteJson`) from `@theokit/sdk/persistence` instead. The old path keeps
> re-exporting its full surface for one release (back-compat) and is scheduled for
> removal in a future major.

```typescript
import {
  appendJsonl,      // append one record as a \n-terminated JSON line (mkdirs parent)
  readJsonlIds,     // resume helper: Set of keys for which keyFn(parsed) is non-empty (tolerates a trailing partial line)
  loadJsonl,        // parse a JSONL file → rows (throws JsonlParseError on a malformed line); also re-exported from @theokit/sdk/eval
  replaceFileAtomic, // atomic write: temp + fsync + 0o600 + rename (never a torn write)
  atomicWriteText,
  atomicWriteJson,
  withFileLock,      // cross-process advisory lock around an async critical section
  openSqliteResilient, // open SQLite with corruption recovery
  applyWalWithFallback, // WAL + foreign-keys pragma with a journal fallback
  isCorruptionError,
  withCwdMutex,      // (SE43) serialize a critical section by cwd across the process
  sanitizeFts5Query, // (SE43) escape a user string for a SQLite FTS5 MATCH query
  PersistenceSchema, // (SE43) shared schema-version constant for the persistence layer
} from "@theokit/sdk/persistence";

// Durable, crash-safe, resumable batch run:
appendJsonl("out/preds.jsonl", { id: "task-1", patch: "diff..." });
const done = readJsonlIds("out/preds.jsonl", (r) =>
  typeof r.id === "string" && typeof r.patch === "string" && r.patch.length > 0 ? r.id : undefined,
);
// `done` holds the ids already completed — skip them on resume.

await replaceFileAtomic("config.json", JSON.stringify(cfg)); // no torn write on crash
```

`loadJsonl` is the same symbol exported from `@theokit/sdk/eval` (dataset
loading); the `persistence` sub-path co-locates it with the write/resume helpers.

### Native session transcript (SE40) — Claude-shaped `.jsonl`

The SE39 read-only `ClaudeCodeTranscriptWriter` has been **removed** (v4.0). It is superseded by the
SE40 native session format: the session store IS a Claude-shaped `.jsonl` (a `uuid`/`parentUuid` DAG of
records carrying structured `text`/`tool_use`/`tool_result` blocks), so the ecosystem's read-side tools
parse our sessions AND — pointed at `~/.claude` — the Claude Code CLI can `--continue` them.

The path-encoders are exported from `@theokit/sdk/persistence`:

```typescript
import { encodeProjectDir, transcriptPath } from "@theokit/sdk/persistence";

// <baseDir>/projects/<encoded-cwd>/<sessionId>.jsonl
const path = transcriptPath("~/.theokit", process.cwd(), sessionId);
```

`baseDir` defaults to `~/.theokit` (isolated) and is settable to `~/.claude` for Claude Code CLI
interop. The full write/read/`--continue`/append-only-compaction surface is documented as it lands
through SE40; extended-thinking `--continue` (thinking-block signature round-trip) is out of scope
(SE42 / issue #122) — thinking blocks are written but dropped on read.

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
| `Scorers.verifyGate({ sandbox?, repoDir, failToPass, passToPass, command })` | Runs the project's tests in a provisioned repo via `SandboxBackend.execute`; scores `1` iff the command exits `0` (M6-2). `sandbox` optional (v2.9+) — defaults to `LocalSandbox`. | SECURITY: `command` is REQUIRED and owns shell-safety of dataset-derived test names — there is no bare-identifier default. Assumes a shell-backed sandbox. |

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

### Code-eval harness (M6) — durable batch, provisioning, verify-gate, artifact

First-party SWE-bench-style primitives over the existing `Eval` / `Scorers` /
`SandboxBackend` surface, with zero new runtime dependencies (ADRs D1-D3).

**Durable, resumable runs.** `Eval.run` accepts an additive `persist` block:

```typescript
import { Eval, Scorers, loadJsonl, captureArtifact } from "@theokit/sdk/eval";

await Eval.create({ name, dataset, scorers, agent }).run({
  persist: {
    path: "runs/out.jsonl",
    // key MUST read only durable fields (index/input/expected/metadata) — it is
    // computed from a probe row BEFORE the agent runs, so output/scores are absent.
    key: (row) => String(row.metadata?.instanceId ?? row.input),
    resume: true,        // skip rows already persisted with a SUCCESSFUL (no-error) result
  },
  classify: (row) => (row.meanScore >= 0.5 ? "pass" : "fail"), // → EvalRowResult.outcome
});
```

- Each completed row is appended as one `\n`-terminated JSON line the instant it
  finishes (crash-durable; interleave-safe within one process). Single-process
  contract — do not point two processes at the same `path`.
- `resume: true` skips rows whose `key` already appears with a successful result;
  failed rows are retried. Skipped rows are NOT re-emitted in `EvalRun.rows` (a
  resumed run's in-memory aggregate reflects only newly-run rows; the JSONL file
  is the complete durable record).
- Additive `EvalRowResult` fields: `outcome?: string` (set by the runner from
  `classify`), `artifact?: { diff: string; applies: boolean }` (produced by
  `captureArtifact`; the caller attaches it to the row).

**Dataset loading.** `loadJsonl<T>(path, { map? })` parses JSONL with a
line-numbered `JsonlParseError`; the dataset schema is the caller's via `map`
(the SWE-bench shape lives in your `map`, not the SDK).

**Repo provisioning** (`@theokit/sdk/sandbox`):

```typescript
import { provisionRepo, RepoProvisionError } from "@theokit/sdk/sandbox";

const { repoDir } = await provisionRepo(sandbox, { repoUrl, ref, instanceId });
// or, with a default local sandbox (clones into the process cwd):
const { repoDir: d2 } = await provisionRepo({ repoUrl, ref, instanceId });
```

The `sandbox` is OPTIONAL (v2.9+): omit it to default to a `LocalSandbox`. The
default clones into `<process cwd>/<instanceId>` — pass an explicit
`LocalSandbox({ workDir })` (or Docker/E2B backend) to control the workdir.
Clones + checks out a ref into `<workdir>/<instanceId>` via
`SandboxBackend.execute` (portable). SECURITY: `instanceId` is validated to
`[A-Za-z0-9._-]` (no path traversal), `ref` may not begin with `-`, clone uses a
`--` option terminator and disables the `ext::` transport. Throws
`RepoProvisionError` (extends `TheokitAgentError`, carries `instanceId`) on git failure.

**Artifact capture.** `captureArtifact(sandbox, repoDir)` returns
`{ diff, applies }` — the working-tree `git diff` plus a reverse
`git apply --check` coherence test. An empty diff returns `{ diff: "", applies: false }`.

**Grading.** `Scorers.verifyGate({ sandbox?, repoDir, failToPass, passToPass, command })`
runs `command([...failToPass, ...passToPass])` in `repoDir` and scores by exit
code. `sandbox` is OPTIONAL (v2.9+): omit it to default to a `LocalSandbox`
(workdir-independent here — `verifyGate` always `cd`s to the explicit `repoDir`).
`command` is REQUIRED — the SDK ships no default that would run untrusted
test identifiers as a shell command.

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

## Squad (sequential agent teams) — `Squad.create`

`Squad.create` is a thin convenience for the common "run a team of agents in
order" case. It **composes `Workflow` + `agentStep`** under the hood — it adds
no new orchestration engine. Each agent's output is threaded into the next
agent's prompt; `run()` returns the final result plus a per-agent trace.

```typescript
import { Agent, Squad } from "@theokit/sdk";

const researcher = await Agent.create({ /* ... */ });
const writer = await Agent.create({ /* ... */ });
const editor = await Agent.create({ /* ... */ });

const squad = Squad.create({ agents: [researcher, writer, editor] }); // process defaults to "sequential"
const run = await squad.run("Write a post about TypeScript agents.");
console.log(run.result);  // final (editor's) output
console.log(run.steps);   // StepResult[] — one per agent
```

- **Sequential is the only `Squad.create` process.** For branching/parallel/foreach
  teams use `Workflow` + `agentStep` directly (more expressive). For
  manager→worker delegation use **subagents** or **`@theokit/sdk-handoff`** —
  passing `process: "hierarchical"` throws a `ConfigurationError` pointing you
  there.
- Invalid input fails fast: empty `agents` → `ConfigurationError(code: "invalid_squad")`.

## Decorator-driven workflows — moved to `@theokit/di-agent` (repo `theokit-di`)

The decorator authoring style (`@Workflow` + `@Step` + `buildWorkflow`, and `@Squad`) was
extracted to `@theokit/di-agent` in the `theokit-di` repo (plan monorepo-cohesion-split;
ADR D431 made decorators an optional layer, not a Harness requirement). It compiles a decorated
class into a `@theokit/sdk` `Workflow` — the SDK ships the `Workflow` + `agentStep` + `Squad.create`
primitives below; the decorator sugar is opt-in via that package.

## Workflows (v1.17+) — `Workflow.create / .run / .resume`

Declarative multi-step orchestration over `Agent.send`, `Handoff`, `Agent.batch`
and friends. ADRs D230-D248. Inspired by Mastra workflows v1; uses explicit
input/output state propagation (not LangGraph state-machine).

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

### Live step-event stream — `Workflow.stream()` (SE28)

`workflow.stream(input, opts?)` returns an `AsyncIterableIterator<WorkflowEvent> & { result: Promise<WorkflowRun> }` that yields step events LIVE during execution — `workflow_started`, `step_started`, `step_completed`, `step_failed`, `workflow_suspended`, `workflow_completed` (discriminate on `type`; events carry `stepId` / `output` / `error`). Events arrive in execution order as steps run (a progress UI need not wait for the whole run). `stream.result` resolves to the terminal `WorkflowRun` (same shape `run()` returns) and is authoritative — not every terminal state has a closing event. `run(input)` is unchanged (`stream()` is purely additive).

### Workflow-scoped state — `stateSchema` + `ctx.state` / `ctx.setState` (SE29)

`Workflow.create({ name, stateSchema?, initialState? })` gives every step a shared, mutable, workflow-scoped state. A step reads `ctx.state` and mutates via `ctx.setState(next)`; a mutation in one step is visible to later steps. When `stateSchema` (Zod) is set, `setState` validates and throws a typed `WorkflowStateError` on mismatch; `initialState` is validated before step 1. State is captured in the `WorkflowSnapshot` and restored on resume (durable across suspend/resume; snapshot `_schemaVersion` bumped with a back-compat guard for older snapshots). Absent `stateSchema` ⇒ no state surface (back-compat).

### Workflows as steps — `workflowStep` + `cloneWorkflow` (SE30)

`workflowStep(childWorkflow)` wraps a committed `Workflow` as a step usable inside `.then(...)`: the child runs via its own executor, its output becomes the step output, and a non-`completed` child (failure/suspend) surfaces to the parent as a typed `WorkflowNestedError` (nested suspend/resume is not supported in v1 — documented in ADR 0010). Nesting is OPAQUE — the child's step ids live in the child's own space; the parent sees one step. `cloneWorkflow(wf, { id })` returns an independent `Workflow` with a fresh id/name and its own single-flight lock, copying the committed steps (no shared step-array reference — mutating the clone never affects the original).

### Whole-workflow I/O validation — `inputSchema` / `outputSchema` (SE27)

`Workflow.create({ name, inputSchema?, outputSchema? })` accepts optional Zod schemas that validate the WHOLE workflow's input and output (distinct from per-step `fn()` schemas). The input is validated at run start — BEFORE step 1 — and a mismatch fails fast with a typed `WorkflowInputError` (no step runs, no silent coercion). On a `completed` run, the final output is validated against `outputSchema`; a mismatch yields `status: "failed"` carrying a typed `WorkflowOutputError` (the error never throws out of `run()`; suspended/failed runs skip output validation). Absent ⇒ no validation (back-compat). Both error classes are exported.

### Workflow as an agent tool — `workflowAsTool` (SE19)

Expose a `Workflow` as a `CustomTool` so an agent can call the whole pipeline like any other tool. Import from `@theokit/sdk/workflow`:

```typescript
import { workflowAsTool, WorkflowToolError } from "@theokit/sdk/workflow";
import { z } from "zod";

const refundTool = workflowAsTool(refundWorkflow, {
  name: "process_refund",
  description: "Runs the refund pipeline for a claim.",
  inputSchema: z.object({ claim: z.string() }),
});

const agent = await Agent.create({ apiKey, model, tools: [refundTool] });
```

The caller-supplied `inputSchema` becomes the tool's LLM-facing input schema; on call, the handler validates the model's args (a `ZodError` becomes `tool_result(isError)` before the workflow runs), then runs `workflow.run(parsedInput)` and returns the workflow output (a string as-is, a structured output JSON-stringified). A run that does not reach `completed` surfaces a typed `WorkflowToolError` (carrying `workflowStatus` + the run error) — a failed step never silently returns a partial result. The `workflow` argument is structural (`{ run }`-shaped), so any workflow-like object works.

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
- **Cron-trigger integration shipped (SE35)** — schedule a workflow directly with `Cron.create({ cron, workflow, inputData })`; the scheduler runs `workflow.run(inputData)` on each fire (see the Cron section).

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


## Custom providers (`Provider.create`)

Register any OpenAI-/Anthropic-compatible LLM endpoint (Groq, Together, Fireworks,
DeepInfra, a private gateway) without forking. A provider is **data-only** — a
`ProviderProfile` object literal; the transport is selected from `apiMode`, so no
new code is required for an endpoint that speaks an existing dialect.

`Provider.create(profile)` is the canonical factory (mirrors `Tool.create` /
`Plugin.create`). It returns a `Plugin` you pass to `Agent.create({ plugins })`.
Route to the provider with the `provider/model` id prefix or `providers.routes`.

```ts
import { Agent, Provider } from "@theokit/sdk";

const groq = Provider.create({
  name: "groq",
  apiMode: "chat_completions",        // OpenAI-compatible
  authType: "api_key",
  envVars: ["GROQ_API_KEY"],          // key read from this env var
  baseUrl: "https://api.groq.com/openai/v1",
  fallbackModels: ["groq/llama-3.1-8b-instant"],
  aliases: ["groq-cloud"],            // optional
});

const agent = await Agent.create({
  model: { id: "groq/llama-3.1-8b-instant" }, // prefix selects the provider
  plugins: [groq],
});
```

`ProviderProfile` fields:

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Canonical provider id (used in the `provider/model` prefix). |
| `apiMode` | yes | HTTP dialect: `chat_completions` \| `anthropic_messages` \| `responses_api` \| `bedrock` \| `bedrock_anthropic`. |
| `authType` | yes | `api_key` \| `none` \| `oauth_device_code` \| `oauth_external` \| `aws_sdk` \| `aws_bearer` \| `gcp_oauth`. |
| `envVars` | yes | Env var names checked (in order) for the API key. |
| `baseUrl` | yes | Endpoint base URL. |
| `fallbackModels` | yes | Models advertised when discovery is unavailable. |
| `aliases` | no | Alternate ids that resolve to this provider. |
| `extractToolCallsFromContent` | no | Opt-in leaked-dialect safe-parse (default off). When `true`, a `chat_completions` finish with ZERO native `tool_calls` has its assistant content scanned for the Hermes `<function=…></tool_call>` dialect; a recovered call surfaces as a real `tool_call` **only when its name matches a tool declared in the request** (request-scoped — a leaked block for a tool the model was not given stays as visible text and is not promoted). Enable only for routes/models known to leak (e.g. a qwen3-coder profile variant) — a code assistant can legitimately print a literal `<function=` in a fenced block, so the flag is the coarse enable and the request-tool allowlist is the precise false-positive guard. While streaming with the flag on, the suspected dialect is held back at the stream boundary and never emitted as a visible `text_delta` (so the raw `<function=…>` markup does not flash by in the live stream); a never-closing marker fails open to visible text. Native `tool_calls` always win (no double-count). |
| `displayName`, `description`, `signupUrl`, `modelsUrl`, `hostname`, `extraHeaders`, `bodyOverrides` | no | Metadata / transport tweaks. |

`Provider.create(profile, { version })` overrides the plugin version (default
`"1.0.0"`). Re-registering an existing provider `name` is last-writer-wins and
emits a one-line stderr WARN. Use `authType: "none"` for local runtimes that
ignore the `Authorization` header.

**Per-route leaked-dialect recovery (v2.13+).** `extractToolCallsFromContent`
can also be set on a single `providers.routes[]` entry instead of redeclaring a
provider profile:

```ts
const agent = await Agent.create({
  providers: {
    routes: [{ capability: "chat", provider: "openrouter", extractToolCallsFromContent: true }],
  },
});
```

The router clones the resolved profile with the flag for that run (built-in
profiles still ship the flag off), so a built-in provider opts into recovery for
one route without a custom profile. Derived from `routes[0]` and applied to the
resolved chat chain; fail-open and default-off, so a non-leaking route is
unaffected. This is the enablement path `@theokit/agents`' `recoverLeakedToolCalls`
knob uses.

**Provider selection from the API key (v2.18+).** The provider is resolved in
this order: an explicit `providers.routes[0].provider` wins; otherwise the
**API-key prefix** is consulted (`sk-or-` → `openrouter`, `sk-ant-` → `anthropic`,
`sk-` → `openai`); otherwise the **model-id prefix** (`anthropic/claude-…` →
`anthropic`); otherwise an env-var heuristic. The key outranks the model prefix
because it is the credential that will actually be called — so
`Agent.create({ apiKey: "sk-or-…", model: { id: "openai/gpt-4o-mini" } })` routes
to OpenRouter and passes the full `openai/gpt-4o-mini` slug through (the vendor
prefix is stripped only when it names the resolved provider). The explicitly
passed `apiKey` is also used as the credential for the resolved provider even
when the matching env var is unset (an explicit `providers.apiKeys` pool for that
provider still wins; fixture `theo_test_*` and the `local` sentinel are never
threaded as credentials).


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

When `GOOGLE_CLOUD_LOCATION=global`, the SDK uses `https://aiplatform.googleapis.com/...` (no `global-` host prefix). Known fix for the `streamRawPredict` 404 bug at `global-aiplatform.googleapis.com` (cline#10287).

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

## Conversation storage (v4.0) — native Claude-shaped transcript

Conversation persistence is the native Claude Code `.jsonl` transcript. There is no pluggable `ConversationStorageAdapter` — the transcript on disk IS the store. The path is `<baseDir>/projects/<encoded-cwd>/<agentId>.jsonl`; `baseDir` comes from `local.baseDir` (default `~/.theokit`; set `~/.claude` for Claude Code CLI `--continue` interop).

Records are a `uuid`/`parentUuid` DAG. Each line is one record with `type` (`user` / `assistant` / `system`), the envelope (`sessionId`, `timestamp`, `cwd`, `version`), and a `message.content` array of structured blocks (`text`, `thinking`, `tool_use{id,name,input}`, `tool_result{tool_use_id,content,is_error}`). A `system` record with `subtype: "compact_boundary"` is a new root (`parentUuid: null`) carrying `compactMetadata`.

### Write / read / compaction

- WRITE: after each send, the whole turn (user text + assistant text/thinking + paired tool_use/tool_result blocks, taken from `run.conversation()`) is appended as native records under a cross-process file lock. Secrets are redacted before disk.
- READ / resume: hydration parses the lines, builds the uuid index, finds the most-recent leaf (a uuid never used as a parentUuid), and walks `parentUuid` to a root (a `compact_boundary` root terminates the walk). It reconstructs the conversation; tool turns fold into assistant-role context so a resumed agent keeps its tool history.
- COMPACTION is append-only: a `compact_boundary` record is appended; the transcript is NEVER shrunk. A resume after a boundary replays only the post-boundary continuation.
- A torn last line (crash mid-write) is skipped on read — the rest of the DAG still reconstructs.

### Pluggable `SessionStore` (SE41) — external store for serverless / multi-host

The record I/O above goes through a minimal, injectable `SessionStore` — exactly two methods over the SAME native `SessionRecord` shape:

```typescript
interface SessionStore {
  readRecords(agentId: string): Promise<SessionRecord[]>;              // all records, append order; missing → []
  appendRecords(agentId: string, records: readonly SessionRecord[]): Promise<void>; // append-only delta
}
```

Omit it and the SDK uses the default `FsSessionStore` (the native `.jsonl` transcript above) — byte-identical to not setting it. Inject `local.sessionStore` to make an external backend (Postgres, Redis, a KV, a durable object) the PRIMARY store and resume source:

```typescript
const agent = await Agent.create({
  apiKey, model: { id: "openai/gpt-4o-mini" },
  local: { cwd, sessionStore: myPostgresStore },   // readRecords / appendRecords over your DB
});
// A later invocation (fresh process, no local FS) resumes from the same store:
const resumed = await Agent.resume(agentId, { apiKey, model, local: { cwd, sessionStore: myPostgresStore } });
```

Use this when the local FS is ephemeral (serverless / edge) or not shared (multi-pod), where a resumed agent must read its history from a shared store instead of disk. The records stay the native Claude-shaped shape, so `--continue` interop is preserved — a store may also mirror to `~/.claude`. Contract: `appendRecords` is append-only and order-preserving; a store that cannot READ on resume MUST throw (a silent `[]` would masquerade as "no history" and drop the conversation). The FS default serializes concurrent appends per agent under a file lock; an external store owns (and documents) its own cross-host consistency. This is NOT the removed `ConversationStorageAdapter` — it is a 2-method record seam, not the old ~10-method surface.

### Scoped session ids (M3 #62)

A conversation id can be namespaced by scope so app-durable, user-durable, and ephemeral session data stay separated: `scopedConversationId(scope, id)` returns `"<scope>__<id>"` for `scope ∈ "app" | "user" | "temp"` (the `__` separator is path-safe), and `sessionScopePrefix(scope)` returns the matching `"<scope>__"` prefix. These are pure id helpers; scope pruning against a storage backend is no longer part of the SDK.

### Removed in v4.0

The pluggable-storage contract is gone: `ConversationStorageAdapter`, `StoredMessage`, `FileSystemConversationStorage`, `InMemoryConversationStorage`, `AgentOptions.conversationStorage`, the `Session` namespace + `SessionMeta`/`SessionMetaPatch`, durable objectives (`setObjective` and friends, `ObjectiveRecord`, `AgentOptions.goal`), and `buildReplayHistory`/`ReplayHistoryOptions`. Custom Postgres / Redis / durable-object backends return via the minimal `SessionStore` seam (SE41, above) — a 2-method record port over the native format, not the removed ~10-method adapter.

### Observability (M3 #64)

Telemetry spans now nest: `llm.call` / `tool.call` / `memory.recall` are children of the run's `agent.send` span, so a trace backend can reconstruct the causal tree. Tool-call / LLM-call durations and LLM token throughput are emitted as metrics (`theokit_tool_call_duration_ms`, `theokit_llm_call_duration_ms`, `theokit_llm_tokens`) via the existing histogram path. A missing provider `usage` on a finish emits a `theokit_llm_usage_missing` metric + a WARN instead of a silent token undercount (M3 #66). `EventBus.publish` no longer silently swallows a throwing handler — it logs (event key + message) and increments an observable `handlerErrorCount`, while sibling handlers still fire.

### Artifacts — scope decision (M3 #66)

Artifacts are a **cloud-only, pre-release** surface. A `CloudAgent` returns fixture artifacts until Theo PaaS ships; a `LocalAgent` returns an empty `listArtifacts()` and throws `UnsupportedRunOperationError` for `downloadArtifact`. A first-class local `ArtifactService` (versioned / namespaced / multi-backend, adk-js-style) is **deferred** — consumers that need cross-turn file persistence today build it on the persistence + path-safety primitives. This is a documented decision, not an omission.

### Default behavior (no configuration)

```ts
const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd() },              // baseDir defaults to ~/.theokit
});
// writes the native transcript to ~/.theokit/projects/<encoded-cwd>/<agentId>.jsonl
```

### Claude Code CLI interop

```ts
const agent = await Agent.create({
  apiKey, model,
  local: { cwd: process.cwd(), baseDir: "~/.claude" },
});
// writes to ~/.claude/projects/<encoded-cwd>/<agentId>.jsonl — a session the
// Claude Code CLI can `--continue` (extended-thinking signatures are written but
// dropped on read; functional --continue for thinking is tracked as issue #122).
```

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

The SDK ships a ponyfill (`anySignal`, D324). Vercel Edge consumers + older Bun get correct behavior without polyfill installation.

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

## Additional public subpaths (reference)

Every entry point in `packages/sdk/package.json` `exports` is public. The sections above cover the main surface; the remaining subpaths are referenced here so the contract is complete.

### `@theokit/sdk/subscription` — typed RPC subscriptions + resume tokens (G8)

Server-side typed streaming with opaque resume tokens (ADRs D423-D430).

```typescript
import { Subscription, subscribe, tracked, isTrackedEnvelope } from "@theokit/sdk/subscription";

// Server: describe a subscription (input → async stream of outputs).
const feed = Subscription.create<{ room: string }, { text: string }>({
  name: "chat",
  subscribe: async function* (input, ctx) {
    for await (const msg of roomStream(input.room, ctx.signal)) {
      yield tracked(msg.id, { text: msg.text });   // `tracked` stamps a resume token
    }
  },
});

// Client: consume it, resuming from the last seen token after a disconnect.
for await (const event of subscribe(url, { lastEventId })) { render(event); }
```

- `Subscription.create<TInput, TOutput>(opts)` → a `SubscriptionDescriptor` a server transport (WS / SSE) drives.
- `subscribe(url, opts?: SubscribeOptions)` → client-side `AsyncGenerator` of events; `opts.lastEventId` resumes.
- `tracked(id, payload)` wraps a payload with a resume token; `isTrackedEnvelope(x)` narrows it.
- Errors: `SubscriptionError`, `SubscriptionDisconnectError`, `SubscriptionInputError`. Composes with `Agent.streamObject`.

### `@theokit/sdk/a2a` — agent-to-agent messaging + programmatic subagents

The peer-to-peer messaging primitives (distinct from the declarative `agents:` map documented under Subagents).

```typescript
import { MessageBus, AgentMailbox, SubAgent } from "@theokit/sdk/a2a";

const bus = new MessageBus();
const mailbox = new AgentMailbox(bus, "agent-a");
await mailbox.send("agent-b", { type: "task", payload: { ... } });   // fire-and-forget
const reply = await mailbox.request("agent-b", { type: "ask", payload }, { timeoutMs: 5000 });
```

- `MessageBus` — in-process broker: `send(from, to, msg)`, `request(from, to, msg, opts)`, subscribe per address.
- `AgentMailbox(bus, address)` — an agent's handle: `send(to, msg)`, `request(to, msg, opts)`.
- `SubAgent.create(spec)` — the programmatic delegation tool (full spec + lifecycle hooks in [Subagents guide](./docs/guides/subagents.md)).
- Types: `A2AMessage`, `MessageHandler`, `ToolContextMessage`, `RequestOptions`; `MaxDelegationDepthError`.

### `@theokit/sdk/filesystem` — pluggable file backend (SE31)

The storage twin of `@theokit/sdk/sandbox`: a `FilesystemBackend` seam so `@theokit/sdk-tools` file factories can target a per-request / multi-tenant root.

```typescript
import { LocalFilesystem, FilesystemBackend, resolveFilesystem } from "@theokit/sdk/filesystem";

const fs = new LocalFilesystem({ basePath: tenantRoot, readOnly: false });
await fs.writeFile("out.txt", "hi");   // boundary-enforced against basePath; escapes → FilesystemSecurityError
```

- `FilesystemBackend` (abstract) — implement `readFile` / `writeFile` / `stat` / `list`; `exists()` derives on the base. `readOnly` + `basePath`.
- `LocalFilesystem(config)` — the default `node:fs` implementation.
- `resolveFilesystem(provider, ctx)` — resolve a `FilesystemProvider` (a backend OR a `(ctx) => backend` resolver) per request.
- Errors: `FilesystemSecurityError`, `FilesystemReadOnlyError`, `FileNotFoundError`, `StaleFileError` (SE32 — write with `expectedMtime`), `FilesystemError`.

### `@theokit/sdk/client` — HTTP client for the cloud runtime

```typescript
import { TheoKitClient } from "@theokit/sdk/client";
const client = new TheoKitClient({ baseUrl, apiKey });
const res = await client.send("hello");                    // Promise<SendResponse>
for await (const ev of client.stream("hello")) { … }        // AsyncGenerator<StreamEvent>
```

Types: `ClientOptions`, `SendResponse`, `StreamEvent`.

### `@theokit/sdk/task-store` — durable task persistence

Backing store for background `Task` observability.

```typescript
import { getTaskStoreFor, InMemoryTaskStore, JsonFileTaskStore } from "@theokit/sdk/task-store";
const store = getTaskStoreFor({ kind: "json-file", path: ".theokit/tasks.json" });
```

- `getTaskStoreFor(options)` → a `TaskStore` (selects the impl by `options.kind`).
- `InMemoryTaskStore` (ephemeral) / `JsonFileTaskStore` (durable JSON file).

### `@theokit/sdk/server/auth` — OAuth orchestrator (build an agent web server)

```typescript
import { Auth, validateReturnTo } from "@theokit/sdk/server/auth";
const auth = Auth.create<Session>({ providers: { github: { … } }, /* … */ });
// auth handles the OAuth login → callback → session exchange for your server.
const safe = validateReturnTo(url, allowlist);   // redirect-target safety
```

- `Auth.create<TSession>(opts)` → an `AuthOrchestrator`.
- `validateReturnTo(url, allowlist)` → a safe redirect target (open-redirect defense).
- Errors: `AuthCallbackError`, `AuthCancelledError`, `AuthConfigError`, `AuthProviderNotFoundError`, `AuthSecretTooShortError`.

### `@theokit/sdk/server/errors-envelope` — canonical HTTP error envelope

```typescript
import { toEnvelope, fromEnvelope } from "@theokit/sdk/server/errors-envelope";
res.status(status).json(toEnvelope(err));       // any error → { code, message, … } wire shape
const restored = fromEnvelope(await res.json()); // wire shape → typed TheokitAgentError
```

Types: `TheokitErrorEnvelope`, `TheokitErrorCode`.

### Token budget + cost (main barrel)

```typescript
import { Budget, UsageAccumulator, computeCost, normalizeUsage, getPricingEntry } from "@theokit/sdk";
```

- `Budget` — a spend cap the agent loop enforces; `createCounterBudgetTracker({ maxIterations })` for a step ceiling.
- `UsageAccumulator` — folds per-run `TokenUsage` into a running total.
- `computeCost(usage, model)` — cost from usage (never returns 0 when pricing is unknown — it surfaces the gap); `getPricingEntry(model)`, `normalizeUsage(raw)`.

### Additional typed errors (`@theokit/sdk/errors`)

Beyond `RateLimitError` / `NetworkError` / `AuthenticationError` / `ConfigurationError`, the hierarchy also exports: `BudgetExceededError`, `AgentDisposedError`, `CredentialPoolExhaustedError`, `MemoryAdapterError`, `TaskNotFoundError`, `InvalidTaskIdError`, `UnsupportedTaskOperationError`, `UnsupportedBudgetOperationError`. All extend `TheokitAgentError`; catch the base to handle any of them.
