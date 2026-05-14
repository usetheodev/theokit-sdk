<p align="center">
  <a href="https://usetheo.dev">
    <img src="https://usetheo.dev/logo.png" alt="Theo" height="80" />
  </a>
</p>

<p align="center">
  <h1 align="center">@usetheo/sdk</h1>
  <p align="center">
    <strong>TypeScript SDK for the Theo agent harness</strong>
  </p>
  <p align="center">
    Same agent surface, local or cloud. No vendor lock-in.
  </p>
  <p align="center">
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
    <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.8%2B-3178C6?style=flat-square&logo=typescript&logoColor=white">
    <img alt="Node" src="https://img.shields.io/badge/node-22.12%2B-339933?style=flat-square&logo=node.js&logoColor=white">
    <img alt="Status" src="https://img.shields.io/badge/status-public%20beta-orange?style=flat-square">
  </p>
</p>

---

> **Public beta.** APIs may change before general availability.

The `@usetheo/sdk` package lets you call the Theo agent from your own TypeScript code. One interface, two runtimes: run inline against your local working tree, or against a cloud-hosted VM (pre-release).

## Overview

| Runtime | What it does | When to use |
| --- | --- | --- |
| **Local** | Runs the agent inline in your Node process. Files come from disk. | Dev scripts and CI checks against a working tree. |
| **Cloud (Theo-hosted)** | Runs in an isolated VM with your repo cloned in. | When the caller doesn't have the repo, you want many agents in parallel, or runs need to survive the caller disconnecting. *Pre-release.* |
| **Cloud (self-hosted)** | Same shape, but you run the VMs via a self-hosted pool. | Same reasons as Theo-hosted, plus code, secrets, and build artifacts must stay in your environment. *Pre-release.* |

Runtime is picked by which key you pass to `Agent.create()` (`local` or `cloud`). Same `THEOKIT_API_KEY` for either.

## Why @usetheo/sdk

The SDK shape — `Agent` / `Run` / streaming events — is converging across the ecosystem by design. The difference is what runs *underneath*:

| Layer | `@usetheo/sdk` | Closed-runtime alternatives |
| --- | --- | --- |
| SDK source | MIT, this repo | Often OSS — table stakes |
| Local agent harness | **MIT** via [`pi/`](./pi) — runs end-to-end without a vendor | Proprietary or source-available; tied to one vendor |
| LLM provider | Multi-provider via `pi-ai` (Anthropic, OpenAI, Google, …) | Usually single-vendor |
| Cloud runtime | Opt-in Theo PaaS *(pre-release)* or self-host the pool | Vendor cloud only |
| Walk-away cost | Zero — fork `pi/`, keep running with your own provider keys | High — runtime is the vendor's |

The "open stack for AI agents" line is load-bearing: you can run an agent fully locally against your own provider keys and never call our backend. The managed cloud runtime is a deploy convenience, not a dependency.

## Installation

```bash
npm install @usetheo/sdk
```

## Authentication

Set `THEOKIT_API_KEY` (or pass `apiKey` explicitly) before creating an agent.

```bash
export THEOKIT_API_KEY="your-key"
```

User API keys and service account API keys are both supported. Team Admin API keys are not yet supported.

## Quick start

The fastest way in: a local agent against your current working tree, streaming events as they come in.

```typescript
import { Agent } from "@usetheo/sdk";

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "composer-2" },
  local: { cwd: process.cwd() },
});

const run = await agent.send("Summarize what this repository does");

for await (const event of run.stream()) {
  console.log(event);
}
```

Each event is a discriminated `SDKMessage`. For a one-shot prompt (create, run, dispose), use `Agent.prompt()`:

```typescript
const result = await Agent.prompt("What does the auth middleware do?", {
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "composer-2" },
  local: { cwd: process.cwd() },
});
```

## Core concepts

| Concept | Description |
| --- | --- |
| **Agent** | Durable container that holds conversation state, workspace config, and settings. Survives across multiple prompts. |
| **Run** | One prompt submission. Owns its own stream, status, result, and cancellation. |
| **SDKMessage** | Normalized stream events emitted during a run. Same shape across all runtimes. |

## Creating a local agent

`Agent.create()` validates options and returns a handle immediately. `agent.agentId` is populated as `agent-<uuid>`.

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "composer-2" },
  local: { cwd: "/path/to/repo" },
});
```

### Model parameters

Use `model.params` to pass per-model options (such as reasoning effort). Discover supported parameters with `Theokit.models.list()`.

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: {
    id: "composer-2",
    params: [{ id: "thinking", value: "high" }],
  },
  local: { cwd: process.cwd() },
});
```

## Sending messages

Each `agent.send()` returns a `Run`. The agent retains conversation context across runs; the run is the unit of work for one prompt.

### Streaming

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

// Follow-up. Full context is retained.
const run2 = await agent.send("Fix it and add a regression test");
await run2.wait();
```

### Sending images

```typescript
const run = await agent.send({
  text: "What's in this screenshot?",
  images: [{ data: base64Png, mimeType: "image/png" }],
});
```

### Waiting without streaming

```typescript
const result = await run.wait();
console.log(result.status);      // "finished" | "error" | "cancelled"
console.log(result.result);      // final assistant text, if any
console.log(result.model);       // resolved ModelSelection used for this run
console.log(result.durationMs);
console.log(result.git);         // { branches: [{ repoUrl, branch?, prUrl? }] } on cloud
```

### Cancelling a run

```typescript
await run.cancel();
```

The status moves to `"cancelled"`, the live stream aborts, in-flight tool calls stop, and `run.wait()` resolves with `status: "cancelled"`. Partial assistant text stays on the `Run` object. Cancel is a no-op if the run already finished.

### Reading run state

```typescript
console.log(run.status);  // "running" | "finished" | "error" | "cancelled"

const stop = run.onDidChangeStatus((status) => {
  console.log(`status changed to ${status}`);
});
// Call `stop()` to remove the listener.

// Structured per-turn view of the conversation accumulated in this run.
const turns = await run.conversation();
```

### Per-run model override

The model passed to `agent.send()` overrides the agent's selection for that run, then becomes sticky: subsequent sends without an override continue to use the new model.

```typescript
const run = await agent.send("Plan the refactor", {
  model: { id: "composer-2", params: [{ id: "thinking", value: "high" }] },
});
console.log(agent.model); // updated to the override after the send succeeds
```

`run.model` and `result.model` reflect the selection that this specific run actually used and are immutable once the run starts.

### Raw deltas

`run.stream()` yields normalized `SDKMessage` events. For lower-level updates (per-token text, tool-call args streaming in, thinking deltas), pass `onDelta` and `onStep` callbacks:

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

### Per-send options

| Property | Type | Description |
| --- | --- | --- |
| `model` | `ModelSelection` | Per-send model override. Sticky on success. |
| `mcpServers` | `Record<string, McpServerConfig>` | Inline MCP server definitions. Fully replaces creation-time servers for this run. |
| `onStep` | `(args: { step }) => void \| Promise<void>` | Callback after each completed conversation step. |
| `onDelta` | `(args: { update }) => void \| Promise<void>` | Callback per raw `InteractionUpdate`. |
| `local.force` | `boolean` | Local only. Expire a stuck active run before starting this message. |

## Stream events

Events from `run.stream()`. Discriminate on `type`. All events include `agent_id` and `run_id`.

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

| `type` | Description | Key fields |
| --- | --- | --- |
| `"system"` | Init metadata. Emitted once at the start of a run. | `subtype?`, `model?`, `tools?` |
| `"user"` | Echo of the user prompt for this run. | `message.content: TextBlock[]` |
| `"assistant"` | Model text output. | `message.content: (TextBlock \| ToolUseBlock)[]` |
| `"thinking"` | Reasoning content. | `text`, `thinking_duration_ms?` |
| `"tool_call"` | Tool invocation lifecycle. Emitted at start with `args`, then again on completion with `result`. | `call_id`, `name`, `status`, `args?`, `result?` |
| `"status"` | Cloud run lifecycle transitions. | `status`, `message?` |
| `"task"` | Task-level milestones and summaries. | `status?`, `text?` |
| `"request"` | Awaiting user input or approval. | `request_id` |

Result data (final text, model, duration, git metadata) lives on the `Run` object after the stream completes. Use `run.wait()` to read it.

> **Tool call schema is not stable.** The `args` and `result` payloads on `tool_call` events reflect each tool's internal shape and can change as tools evolve. Tool names can also be renamed or replaced. Treat `args` and `result` as `unknown` and parse defensively. The event envelope (`type`, `call_id`, `name`, `status`) is stable.

For the full type reference (`SDKMessage`, `InteractionUpdate`, `ConversationTurn`), see [`docs.md`](./docs.md).

## Resuming agents

Reattach to an existing agent by ID. Runtime is auto-detected from the ID prefix (`bc-` is cloud, anything else is local).

```typescript
await using agent = await Agent.resume("agent-abc123", {
  apiKey: process.env.THEOKIT_API_KEY!,
});

const run = await agent.send("Also update the changelog");
await run.wait();
```

`agent.model` is `undefined` on resume unless you pass `model` again. Inline `mcpServers` are not persisted across resume — they often carry secrets and live in memory only. Pass them again on resume, or commit them to `.theokit/mcp.json`.

## Inspecting agents and runs

List, fetch, and reload past agents. List endpoints return `{ items, nextTheokit? }` for cursor-based pagination.

```typescript
const { items, nextTheokit } = await Agent.list({
  runtime: "local",
  cwd: process.cwd(),
});

const info = await Agent.get(agentId);
const runs = await Agent.listRuns(agentId);
const run = await Agent.getRun(runId, { runtime: "local" });
```

Runtime is auto-detected from the agent ID prefix when possible. For `getRun` on cloud, pass `agentId` explicitly.

## MCP servers

Agents can pick up MCP servers from several sources. Inline definitions in `Agent.create()` or `agent.send()` are the most common.

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "composer-2" },
  local: { cwd: process.cwd() },
  mcpServers: {
    docs: {
      type: "http",
      url: "https://example.com/mcp",
      auth: { CLIENT_ID: "client-id", scopes: ["read", "write"] },
    },
    filesystem: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
    },
  },
});
```

Local agents load servers from these sources (first-match wins on conflicting names):

1. `mcpServers` on `agent.send()` — replaces creation-time servers for that run.
2. `mcpServers` on `Agent.create()`.
3. Plugin servers, if `local.settingSources` includes `"plugins"`.
4. Project servers from `.theokit/mcp.json`, if `local.settingSources` includes `"project"`.
5. User servers from `~/.theokit/mcp.json`, if `local.settingSources` includes `"user"`.

Without `local.settingSources`, only inline servers are loaded. Local OAuth-protected servers require you to have signed in previously through the Theo app — the SDK can't prompt for sign-in.

## Subagents

Define named subagents that the main agent spawns via the Agent tool.

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "composer-2" },
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
```

Subagents committed to the repo at `.theokit/agents/*.md` (with `name`, `description`, optional `model` frontmatter) are also picked up. Inline definitions override file-based ones with the same name.

## Hooks

Hooks are file-based only. There is no programmatic hook callback — hooks are a project policy boundary, not a per-run knob.

- **Local.** Add `.theokit/hooks.json` to the repo passed as `local.cwd`, or `~/.theokit/hooks.json` for user-level hooks.
- **Cloud.** Commit `.theokit/hooks.json` and its scripts to the repo passed in `cloud.repos`.

## Cron jobs

Schedule agent runs on a cron expression. Two runtimes:

- **Local.** The in-process scheduler activated via `Cron.start()` fires the job while the host process is alive. Persisted to `.theokit/cron/jobs.json`.
- **Cloud.** Theo PaaS schedules the job server-side. Fires regardless of any SDK process.

```typescript
import { Cron } from "@usetheo/sdk";

const job = await Cron.create({
  cron: "0 9 * * *",                 // every day at 09:00
  timezone: "America/Sao_Paulo",
  message: "Summarize yesterday's commits and post to #engineering",
  agent: {
    apiKey: process.env.THEOKIT_API_KEY!,
    model: { id: "composer-2" },
    local: { cwd: process.cwd() },
  },
});

await Cron.start();                  // required for local jobs to fire
```

Supported expressions: 5-field POSIX cron, plus shorthand `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`. `timezone` accepts any IANA identifier; defaults to UTC.

### Managing jobs

```typescript
const { items } = await Cron.list({ runtime: "local", cwd: process.cwd() });
const job = await Cron.get(jobId);
await Cron.disable(jobId);           // pause without deleting
await Cron.enable(jobId);            // resume
await Cron.delete(jobId);            // permanent

const run = await Cron.run(jobId);   // off-schedule manual fire — returns the Run
```

### Local scheduler control

The local scheduler must be explicitly started for local jobs to fire. For 24/7 scheduling without a long-running SDK process, use the cloud runtime.

```typescript
await Cron.start({ cwd: process.cwd() });
const status = await Cron.status();
// { running: true, jobCount: 3, nextFireAt: 1747... }
await Cron.stop();
```

Cloud jobs do not need `Cron.start()` — Theo PaaS fires them server-side.

Job-to-agent binding: pass `agent` (ephemeral agent created on each fire) OR `agentId` (bound to an existing agent for context continuity). Setting both is a `ConfigurationError`.

## Artifacts

List and download files from the agent's workspace.

```typescript
const artifacts = await agent.listArtifacts();
for (const artifact of artifacts) {
  console.log(artifact.path, artifact.sizeBytes);
}
const buffer = await agent.downloadArtifact(artifacts[0].path);
```

Artifact support is runtime-dependent. **Local agents currently return no artifacts and throw for `downloadArtifact`.**

## Resource management

Always dispose agents when done. The cleanest pattern is `await using`:

```typescript
await using agent = await Agent.create({ /* ... */ });
// disposed automatically when the block exits
```

To dispose explicitly:

```typescript
await agent[Symbol.asyncDispose]();
```

`agent.close()` starts disposal without awaiting (fire-and-forget). `agent.reload()` picks up filesystem config changes (hooks, project MCP, subagents) without disposing.

## Errors

All SDK errors extend `TheokitAgentError`. Use `isRetryable` to drive retry logic.

```typescript
class TheokitAgentError extends Error {
  readonly isRetryable: boolean;
  readonly code?: string;
  readonly cause?: unknown;
  readonly protoErrorCode?: string;
}
```

| Error | When |
| --- | --- |
| `AuthenticationError` | Invalid API key, not logged in, insufficient permissions. |
| `RateLimitError` | Too many requests or usage limits exceeded. |
| `ConfigurationError` | Invalid model, bad request parameters. |
| `IntegrationNotConnectedError` | Creating a cloud agent for a repo whose SCM provider is not connected. Includes `provider` and `helpUrl`. |
| `NetworkError` | Service unavailable, timeout. |
| `UnknownAgentError` | Catch-all for unclassified server or runtime errors. |
| `UnsupportedRunOperationError` | A `Run` operation is not available on the current runtime. Check first with `run.supports(operation)`. |

## Cloud runtime — pre-release

> The cloud runtime depends on **Theo PaaS**, currently pre-release. The local runtime works without it. Cloud APIs below describe the contract for when PaaS reaches general availability.

Cloud agents are created with the same `Agent.create()` call but with the `cloud` key:

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "composer-2" },
  cloud: {
    repos: [{ url: "https://github.com/your-org/your-repo", startingRef: "main" }],
    autoCreatePR: true,
  },
});
```

Cloud agents get a `bc-<uuid>` ID. Key differences from local:

- Repository is cloned into an isolated VM, not read from your disk.
- `listArtifacts()` / `downloadArtifact()` work (local returns empty / throws).
- `autoCreatePR`, `workOnCurrentBranch`, `skipReviewerRequest` control PR lifecycle.
- `cloud.envVars` injects short-lived credentials scoped to the agent. Encrypted at rest, deleted with the agent. Names can't start with `THEOKIT_`.
- Status events (`CREATING`, `RUNNING`, ...) reflect VM provisioning.
- MCP `headers` / `auth` for HTTP servers are handled by the backend; sensitive fields are redacted before the VM sees them.

Cloud agents started by the SDK are filtered out of the default agent list. View them by passing `runtime: "cloud"` to `Agent.list()`.

Lifecycle:

```typescript
await Agent.archive(agentId);     // soft-delete; transcript stays readable
await Agent.unarchive(agentId);   // restore an archived agent
await Agent.delete(agentId);      // permanent
```

Full cloud reference, including `CloudOptions`, `SDKAgentInfo`, and `Theokit.repositories.list()`: see [`docs.md`](./docs.md).

## Configuration reference

The high-level shape:

```typescript
interface AgentOptions {
  model?: ModelSelection;       // required for local
  apiKey?: string;              // falls back to THEOKIT_API_KEY
  name?: string;
  local?: {
    cwd?: string | string[];
    settingSources?: SettingSource[];
    sandboxOptions?: { enabled: boolean };
  };
  cloud?: CloudOptions;
  mcpServers?: Record<string, McpServerConfig>;
  agents?: Record<string, AgentDefinition>;
  agentId?: string;
}
```

For the full reference (`CloudOptions`, `ModelSelection`, `McpServerConfig`, `AgentDefinition`, `SDKImage`, `SettingSource`, `ListResult`), see [`docs.md`](./docs.md).

## Known limitations

- Inline `mcpServers` are not persisted across `Agent.resume()`. Pass them again on resume if needed.
- Artifact download is not implemented for local agents (`agent.listArtifacts()` returns an empty list and `agent.downloadArtifact()` throws).
- `local.settingSources` (and the file-based MCP / subagent paths it gates) does not apply to cloud agents. Cloud always loads project / team / plugins.
- Hooks are file-based only (`.theokit/hooks.json`). No programmatic callbacks.
- Cloud runtime requires Theo PaaS, currently pre-release.
- Local cron jobs only fire while the host process is alive. Run the SDK as a systemd / launchd / pm2 service, or use the cloud runtime, for 24/7 scheduling.
- Local cron jobs in flight are NOT resumed if the host process crashes mid-fire.

## Where this fits

`@usetheo/sdk` is the **Harness** pillar of the [usetheo stack](../README.md):

| Pillar | Project | What it does |
| --- | --- | --- |
| UI | `@usetheo/ui` | Component primitives for AI surfaces. |
| **Harness** | **`@usetheo/sdk`** (this) | **Agent runtime — local and cloud.** |
| Skills | `theokit` | Full-stack TypeScript framework for shipping agent surfaces. |
| Runtime | Theo PaaS | Managed deploy target. *Pre-release.* |

The SDK is a standalone TypeScript implementation of the contract in [`docs.md`](./docs.md). The `referencia/` directory contains read-only study material — including a fork of [`earendil-works/pi`](https://github.com/earendil-works/pi) and the OpenAI Agents Python SDK — that informed the design but is not a runtime dependency.

## Development

This monorepo uses **pnpm workspaces**, **Biome 2.4**, **tsup 8**, **Vitest 3**, **TypeScript 5.8+**, and **Changesets**. Node 22.12+ required (use `nvm use` to pick it up from `.nvmrc`).

```bash
nvm use                       # Node 22+ per .nvmrc
corepack enable               # makes the pinned pnpm available
corepack prepare pnpm@9.15.0 --activate

pnpm install                  # install workspace deps
pnpm typecheck                # tsc --noEmit across packages
pnpm test                     # vitest
pnpm build                    # tsup → dist/{index,errors}.{js,cjs,d.ts}
pnpm check                    # biome lint + format
pnpm validate                 # everything above plus publint + attw
```

Reference projects under `referencia/` (notably `pi/` and `openai-agents-python/`) are study material — read them for design inspiration, but never `npm install`, `pip install`, or edit them.

## License

MIT
