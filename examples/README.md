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
| [`streaming-callbacks`](./streaming-callbacks) | ⚠️ Partial | `onStep` / `onDelta` are declared but not yet routed in the real LLM runtime. See its README. |
| [`provider-fallback`](./provider-fallback) | ⚠️ Partial | Chain resolves at create time but failover-on-error not yet wired. See its README. |
| [`context-manager`](./context-manager) | ⚠️ Partial | Snapshot works; LLM injection not yet wired. See its README. |
| [`skills`](./skills) | ⚠️ Partial | `agent.skills.list()` works; auto-injection into system prompt is opt-in via resolver. See its README. |
| [`memory`](./memory) | ⚠️ Partial | Persistence works; real-LLM recall not yet auto-injected. See its README. |

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

The 14 examples together exercise ~85% of the public API. The 5
"⚠️ Partial" entries flag real **runtime gaps** — features declared
in `docs.md` and accepted by the public types, but not yet wired into
the production LLM agent loop. Each README documents the gap and the
workaround.

Not covered yet:

- Cloud Run end-to-end **against a live PaaS** (the cloud example
  uses fixture mode because the PaaS isn't deployed)
- `agent.providers.list()` runtime inspection (managed but no example)
- `Agent.resume(agentId)` (used internally by Cron; no standalone example)

## Why some examples use fixture mode

Fixture mode is triggered by an API key matching `theo_test_*` AND
the absence of `THEOKIT_API_BASE_URL`. The SDK serves deterministic,
contract-shaped responses without any network — perfect for examples
that demonstrate **shape** (catalog reads, error types, cloud
lifecycle) without requiring credentials or a deployed PaaS. The
LLM-driven examples bypass fixture mode by using a non-fixture API
key + provider env credential.
