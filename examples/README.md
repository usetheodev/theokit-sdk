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

## DX helpers cheat sheet

The SDK exposes four helpers on top of the canonical
`Agent.create({...})` options bag. Each one is opt-in — you can build
the same agent with or without them. Pick where you learn each:

| Helper | Where to learn it |
|---|---|
| `Agent.create({...})` — options-bag (canonical) | [`quickstart`](./quickstart) |
| `Agent.builder()` — fluent chain (ADR D25) | [`quickstart`](./quickstart) with `BUILDER=1 pnpm dev`, [`agent-management`](./agent-management) |
| `Agent.getOrCreate(id, options)` — resume-or-create (ADR D22) | [`telegram-pro`](./telegram-pro), [`telegram-bot`](./telegram-bot), [`resume-agent`](./resume-agent), [`agent-management`](./agent-management), [`error-handling`](./error-handling), [`error-handling-full`](./error-handling-full) |
| `createAgentFactory(common)` — factory closure (ADR D23) | [`telegram-pro`](./telegram-pro) |
| `defineTool(spec)` — Zod-driven type-safe tool builder (ADR D24) | [`telegram-pro`](./telegram-pro) |

The 33 single-feature examples (memory, mcp, cron, etc.) intentionally
keep the plain `Agent.create({...})` form — they exist to teach ONE
SDK feature isolated from helper sugar. See ADR D27 for the rationale.

## Example inventory

### Real LLM (calls your provider, costs money)

| Example | Status | What it shows |
| --- | --- | --- |
| [`telegram-pro`](./telegram-pro) | ✅ Full | **Flagship multimodal demo** — voice (Whisper) + photo/sticker (Gemini vision + cache) + inline buttons + group `@mention` + forum topics + shell tool + filesystem MCP + hooks policy + cron + skills + wiki search. Reproduces 5 OpenClaw patterns + covers ~95% of the SDK surface in ~900 LoC. |
| [`telegram-bot`](./telegram-bot) | ✅ Full | Minimal Telegram bot reference (~120 LoC) — restart-proof per ADRs D17/D18/D19/D20/D21. Bundled dogfood script (`pnpm dogfood`) exercises the full chat-assistant pattern end-to-end against real LLM. |
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
| [`embedding-providers`](./embedding-providers) | ✅ Full | Switch across the 5 v1.0 embedding adapters (openai / mistral / openrouter / voyage / deepinfra). |
| [`active-memory-query-modes`](./active-memory-query-modes) | ✅ Full | All 3 `queryMode` variants: `"message"`, `"recent"`, `"full"`. |
| [`remember-prefix`](./remember-prefix) | ✅ Full | Auto-write memory facts via `Remember:` prefix. Secret redaction (sk-*, ghp_*) per ADR D9. |
| [`provider-inspector`](./provider-inspector) | ✅ Full | `Theokit.providers.list()` (global catalog) + `agent.providers.routes()` (per-agent resolved routes). |
| [`resume-agent`](./resume-agent) | ✅ Full | `Agent.resume(agentId)` reattaches in-process; session history continues. |
| [`mcp-http`](./mcp-http) | ✅ Full | HTTP MCP transport (companion to `mcp-stdio`). |
| [`send-mcp-override`](./send-mcp-override) | ✅ Full | Per-send `mcpServers` override via `SendOptions.mcpServers`. |
| [`local-force-expire`](./local-force-expire) | ✅ Full | `local: { force: true }` expires a stuck previous run. |
| [`plugins-walkthrough`](./plugins-walkthrough) | ✅ Full | `.theokit/plugins/<name>/plugin.json` discovery via `plugins.enabled`. |

### Fixture mode (no PaaS / provider required)

| Example | What it shows |
| --- | --- |
| [`error-handling`](./error-handling) | Typed `try/catch` against `AuthenticationError`, `ConfigurationError`, `UnknownAgentError`. |
| [`theokit-catalog`](./theokit-catalog) | `Theokit.me()`, `models.list()`, `repositories.list()`, `providers.list()`. |
| [`cloud-agent`](./cloud-agent) | `cloud: { repos, autoCreatePR }` + `listArtifacts()` / `downloadArtifact()`. |
| [`cloud-with-skills`](./cloud-with-skills) | Cloud agent + `skills.enabled` serialized into the cloud payload (ADR D15). |
| [`cloud-with-mcp-http`](./cloud-with-mcp-http) | HTTP MCP transport for cloud; bare-command stdio MCP also accepted (ADR D15 + EC-3). |
| [`cloud-with-subagents`](./cloud-with-subagents) | Inline `agents` map serialized into the cloud payload (ADR D15). |
| [`cloud-await-using`](./cloud-await-using) | `await using` + idempotent `dispose()` on `CloudAgent` (ADR D5 + EC-3). |
| [`cloud-prerelease-guard`](./cloud-prerelease-guard) | `cloud_runtime_pre_release` typed error for non-fixture cloud calls. |
| [`error-handling-full`](./error-handling-full) | All 8 SDK error classes: catch patterns + `instanceof` discrimination. |
| [`agent-management`](./agent-management) | `Agent.list/get/listRuns/getRun/archive/unarchive/delete`. |

The fixture-mode examples use a `theo_test_*` API key so the SDK
serves deterministic data without any backend. When Theo PaaS ships,
swap the `.env` to a real `THEOKIT_API_KEY` + `THEOKIT_API_BASE_URL`
and the same example code hits the live runtime.

## Honest coverage note

The 34 examples together exercise **~100% of the public API**:
- All `Agent.*`/`Run.*`/`Cron.*`/`Memory.*`/`Theokit.*` methods
- All 8 SDK error classes (3 in `error-handling`, 5 demonstrated in `error-handling-full`)
- All 5 embedding adapters (openai/mistral/openrouter/voyage/deepinfra)
- Both MCP transports (stdio + http)
- All Active Memory `queryMode` variants
- `await using` on Local AND Cloud agents
- `local.force` + `SendOptions.mcpServers` overrides
- Plugin discovery + skills frontmatter
- Cloud tool parity (skills, MCP, subagents) — ADR D15
- Cloud pre-release guard — typed errors for non-fixture cloud calls

Each example's README documents the observable behaviour. Most run
against a fixture key (`theo_test_*`); LLM-driven examples need a real
provider key (Anthropic, OpenAI, or OpenRouter).

Not covered yet (out of scope by design):

- Cloud Run end-to-end **against a live PaaS** (PaaS is pre-release;
  cloud examples use fixture mode and the `cloud-prerelease-guard`
  example demonstrates the typed errors for real keys)
- Cross-process `Agent.resume` (in-process flow demonstrated; persistent
  registry tracked as future work per ADR D8)

## Why some examples use fixture mode

Fixture mode is triggered by an API key matching `theo_test_*` AND
the absence of `THEOKIT_API_BASE_URL`. The SDK serves deterministic,
contract-shaped responses without any network — perfect for examples
that demonstrate **shape** (catalog reads, error types, cloud
lifecycle) without requiring credentials or a deployed PaaS. The
LLM-driven examples bypass fixture mode by using a non-fixture API
key + provider env credential.

## Maintenance

Two scripts under `tools/` keep this inventory in sync with reality.

```bash
# Categorize every example by the SDK helpers it uses (manual ground truth).
bash tools/triage-examples.sh
#   → .claude/knowledge-base/reviews/examples-triage-<date>.md

# Sweep `npx tsc --noEmit` across every example to catch regressions
# after any change to the SDK public surface. Uses
# `pnpm install --ignore-workspace --no-frozen-lockfile` so the
# `file:../../packages/sdk` link picks up the freshly built dist.
bash tools/typecheck-examples.sh
#   → .claude/knowledge-base/reviews/examples-typecheck-<date>.md
```

When you add a new example, append a row to **Example inventory**
above AND, if it covers a new "Where to start" category, add a bullet
there. If your example introduces a new pattern that should reach
existing users, add a row to the **DX helpers cheat sheet**.
