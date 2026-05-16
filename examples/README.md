# `@usetheo/sdk` Examples

Self-contained example projects covering the SDK's public surface.
Each example is its own package — independent `package.json`,
independent install — so you can copy any folder out of this repo
and have a working starting point.

## How to run an example

```bash
cd examples/quickstart
pnpm install --ignore-workspace
cp .env.example .env   # paste your provider key (where needed)
pnpm dev
```

The examples link `@usetheo/sdk` from the local source via
`file:../../packages/sdk`. `--ignore-workspace` prevents pnpm from
resolving the SDK through the monorepo workspace protocol. When the
SDK is published to npm you can drop the flag.

## Provider credentials

Examples that drive a real LLM pick a model based on whichever
provider key is set in their `.env`. Auto-detection order:
**Anthropic → OpenAI → OpenRouter**.

```dotenv
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
# or
OPENROUTER_API_KEY=sk-or-...
```

Plus a non-fixture SDK key (any string that does NOT start with
`theo_test_`) — examples default to `THEOKIT_API_KEY=user-real-example-key`.

## Example inventory

### Real LLM (calls your provider, costs money)

| Example | Status | What it shows |
| --- | --- | --- |
| [`quickstart`](./quickstart) | ✅ Full | Create → send → stream → wait. systemPrompt + persona steering. |
| [`shell-tool`](./shell-tool) | ✅ Full | Real shell tool against a tmp workspace. |
| [`mcp-stdio`](./mcp-stdio) | ✅ Full | Inline MCP stdio server + JSON-RPC tools/call. |
| [`hooks-policy`](./hooks-policy) | ✅ Full | `.theokit/hooks.json` preToolUse policy blocks dangerous commands. |
| [`cron-schedule`](./cron-schedule) | ✅ Full | Real cron scheduler + Cron.run() invokes real LLM. |
| [`one-shot-prompt`](./one-shot-prompt) | ✅ Full | `Agent.prompt()` one-shot + `await using` resource disposal. |
| [`send-overrides`](./send-overrides) | ✅ Full | Per-call `model` / `systemPrompt` overrides on the same agent. |
| [`subagents`](./subagents) | ✅ Full | Inline `agents` map, subagent metadata exposed to parent. |
| [`run-lifecycle`](./run-lifecycle) | ✅ Full | `run.supports()`, `onDidChangeStatus`, `run.conversation()`. |
| [`streaming-callbacks`](./streaming-callbacks) | ✅ Full | `onStep` fires per assistant turn / tool batch; `onDelta` fires per token. |
| [`provider-fallback`](./provider-fallback) | ✅ Full | Primary handshake failure falls over to the next entry in `providers.fallback`. |
| [`context-manager`](./context-manager) | ✅ Full | Loaded sources appear as a `<context>` block in the LLM system prompt. |
| [`skills`](./skills) | ✅ Full | Skills list auto-injected as a `<skills>` block; opt out with `skills.autoInject: false`. |
| [`memory`](./memory) | ✅ Full | Persisted facts auto-injected as a `<memory>` block on the next send. `Remember:` prefix auto-writes (now backed by MEMORY.md). |
| [`memory-search`](./memory-search) | ✅ Full | LLM uses the `memory_search` tool to find facts in `.theokit/memory/MEMORY.md` via FTS5/hybrid index. |
| [`memory-get`](./memory-get) | ✅ Full | LLM uses the `memory_get` tool for bounded reads of `notes/*.md`; path traversal rejected. |
| [`active-memory`](./active-memory) | ✅ Full | Blocking pre-send recall injects an `<active-memory>` block; circuit breaker + cache + timeout. |
| [`memory-dreaming`](./memory-dreaming) | ✅ Full | Dedup + cluster + dream-diary via `Memory.runDreamingSweep`. Requires an embedding provider. |
| [`provider-inspector`](./provider-inspector) | ✅ Full | `Theokit.providers.list()` (global catalog) + `agent.providers.routes()` (per-agent resolved routes). |
| [`resume-agent`](./resume-agent) | ✅ Full | `Agent.resume(agentId)` reattaches in-process; session history continues. |

### Fixture mode (no PaaS / provider required)

| Example | What it shows |
| --- | --- |
| [`error-handling`](./error-handling) | Typed `try/catch` against `AuthenticationError`, `ConfigurationError`, `UnknownAgentError`. |
| [`theokit-catalog`](./theokit-catalog) | `Theokit.me()`, `models.list()`, `repositories.list()`, `providers.list()`. |
| [`cloud-agent`](./cloud-agent) | `cloud: { repos, autoCreatePR }` + `listArtifacts()` / `downloadArtifact()`. |
| [`agent-management`](./agent-management) | `Agent.list/get/listRuns/getRun/archive/unarchive/delete`. |

The fixture-mode examples use a `theo_test_*` API key so the SDK
serves deterministic data without any backend. When Theo PaaS ships,
swap the `.env` to a real `THEOKIT_API_KEY` + `THEOKIT_API_BASE_URL`
and the same example code hits the live runtime.

## Honest coverage note

The 14 examples together exercise ~85% of the public API. The five
features previously flagged as "⚠️ Partial" (callbacks, fallback,
context, skills, memory) are wired into the real LLM agent loop as of
the runtime-gaps fix. Each example's README documents the observable
behaviour against a real provider key.

Not covered yet:

- Cloud Run end-to-end **against a live PaaS** (the cloud example
  uses fixture mode because the PaaS isn't deployed)
- Cross-process `Agent.resume` (in-process flow demonstrated; persistent
  registry tracked as future work)

## Why some examples use fixture mode

Fixture mode is triggered by an API key matching `theo_test_*` AND
the absence of `THEOKIT_API_BASE_URL`. The SDK serves deterministic,
contract-shaped responses without any network — perfect for examples
that demonstrate **shape** (catalog reads, error types, cloud
lifecycle) without requiring credentials or a deployed PaaS. The
LLM-driven examples bypass fixture mode by using a non-fixture API
key + provider env credential.
