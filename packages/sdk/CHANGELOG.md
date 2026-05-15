# Changelog

All notable changes to `@usetheo/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (runtime-gaps fix)
- `SystemPromptPipeline` + `SystemPromptProvider` strategy pattern (ADR D8) — Context (priority 10), Skills (priority 20), Memory (priority 30), Base (priority 100) auto-injected as XML-tagged blocks into the LLM system prompt. Future blocks plug in by writing one new provider class.
- `FallbackLlmClient` wraps the resolved provider chain. On `NetworkError` from the primary handshake, the SDK transparently retries with the next entry (ADR D2). Failover boundary at first event yield — mid-stream errors are NOT retried. Aborted signal between attempts short-circuits the chain (edge-case EC-3).
- `SendOptions.onStep` / `onDelta` now fire in the real LLM agent loop (ADR D1) — `onStep` per completed assistant text turn and per tool call; `onDelta` per `text-delta` token. Callback errors are caught and logged, never crash the run.
- `SkillsSettings.autoInject` (default `true`) — opt out of the `<skills>` block via `AgentOptions.skills.autoInject: false`.
- `MemorySettings` (`AgentOptions.memory`) public type: `enabled`, `namespace`, `userId`, `scope`, `storePath`, `autoInject`. Recalled facts auto-inject as a `<memory>` block on every send.
- `SystemPromptContext.memory` field — recalled facts exposed to custom `systemPrompt` resolvers (appended per the field-order compatibility contract).
- `escapeBlockBody` helper (ADR D9) — every dynamic block body (context source, skill description, memory fact) is XML-escaped before embedding so workspace content containing literal `</context>` cannot break out of its block (prompt-injection defence).

### Added
- Initial package scaffold: dual ESM+CJS build via tsup 8, types-first `exports` map with sub-paths for `.`, `./cron`, and `./errors` (initial scaffold).
- Public type contract from [`docs.md`](../../docs.md): `Agent`, `Run`, `SDKMessage`, `InteractionUpdate`, `ConversationTurn`, `McpServerConfig`, etc. (initial scaffold).
- Error class hierarchy: `TheokitAgentError`, `AuthenticationError`, `RateLimitError`, `ConfigurationError`, `IntegrationNotConnectedError`, `NetworkError`, `UnknownAgentError`, `UnsupportedRunOperationError` (initial scaffold).
- `Cron` namespace skeleton: `Cron.create()`, `Cron.list()`, `Cron.get()`, `Cron.delete()`, `Cron.enable()`, `Cron.disable()`, `Cron.run()` (manual fire), and scheduler control via `Cron.start()` / `Cron.stop()` / `Cron.status()`. Cron job type contract (`CronJob`, `CronCreateOptions`, `CronSchedulerStatus`, etc.) (initial scaffold).
- Smoke test verifying public API is importable and stub methods reject with `ConfigurationError` (initial scaffold).
- Context manager type contract: `ContextSettings`, `ContextSource`, `ContextSnapshot`, `SDKContextManager`. `SDKAgent.context?` exposes the manager when context is enabled via `AgentOptions.context`.
- Provider routing type contract: `ProviderCapability`, `ProviderRoute`, `ProviderRoutingSettings`, `PluginsSettings`, `ResolvedProviderRoute`, `SDKProvidersManager`, `SDKProvider`. `SDKAgent.providers?` exposes the manager. `Theokit.providers.list()` stub for provider catalog reads.

### Changed
- License standardized to **Apache-2.0** (was MIT). Aligns all usetheo open-core pillars under a single license — see root `CLAUDE.md` strategic review of 2026-05-14.
- `UnsupportedRunOperationError` now extends `TheokitAgentError` with `isRetryable: false` and stable `code: "unsupported_run_operation"`. Previously extended `Error` directly — old `instanceof TheokitAgentError` checks against this error now return `true`.
- `RunOperation` union extended with `"listArtifacts"` and `"downloadArtifact"`. Agent-level operations can now be reported through `UnsupportedRunOperationError.operation`.

### Changed (runtime-gaps fix)
- Memory recall lifted from the fixture-only path into the shared agent path. A corrupted memory file degrades to "no facts loaded" with a stderr warning instead of crashing the run (edge-case review EC-4).
- `FileContextManager` exposes a new internal `internalAssemblySnapshot()` so the system-prompt pipeline can read per-source token slices without the public `snapshot()` having to leak the same shape.

### Fixed
- 5 previously ⚠️ Partial example flows now work end-to-end against real providers: `examples/streaming-callbacks` (steps/deltas fire), `examples/provider-fallback` (`status=finished` after primary failover), `examples/context-manager` (model answers "8675309"), `examples/skills` (model lists `code-review, doc-writer`), `examples/memory` (model recalls the persisted fact via auto-injected `<memory>` block).
- `setupSchema` of fixture providers no longer leaks env-var-name shaped strings (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...) that matched the hygiene regex. Schemas now use a generic `credential` property name (internal contract change; public shape unchanged).

### Implementation status (Phase 2 — real runtime)
- **Real cron scheduler** powered by `croner@^9.0.0`. `Cron.start()` installs a timer per enabled local job, `nextRunAt` is computed from the cron expression and timezone, jobs actually fire on schedule. `Cron.disable()` / `Cron.enable()` / `Cron.delete()` add/remove timers without losing the job state.
- **Real hook execution** via `HooksExecutor`: `.theokit/hooks.json` is parsed into events (`preRun`, `postRun`, `preToolUse`, `postToolUse`, `stop`), each fires the configured command with the payload JSON over stdin. Non-zero exit codes deny the operation; JSON stdout can return `{"decision":"allow|deny|feedback","reason"|"feedback"}`. preRun denials throw `ConfigurationError("preRun hook denied execution")` from `agent.send()`. preToolUse denials short-circuit the tool with `exitCode: 126`.
- **Real MCP client** for `stdio` (spawn + JSON-RPC over stdin/stdout) and `http` (fetch+JSON-RPC). Implements `initialize`, `tools/list`, `tools/call` per MCP 2024-11-05.
- **Real shell tool** spawning `sh -c <command>` with stdout/stderr capture, SIGKILL-on-timeout, and a sandbox heuristic that refuses obvious unsafe commands when `local.sandboxOptions.enabled` is true.
- **Real LLM provider clients** (Anthropic Messages SSE, OpenAI Chat Completions SSE, OpenRouter via the OpenAI shape). Use native `fetch` only — no SDK dependencies. Translate vendor SSE deltas into a provider-agnostic `LlmEvent` stream + `LlmFinish` accumulator.
- **Real agent loop** orchestrates the LLM-tool-LLM cycle: system event → user event → LLM stream → assistant event → optional `tool_use` dispatch (with preToolUse + postToolUse hooks) → result fed back → next turn. Max 8 iterations by default.
- **Real cloud Run** via Theo PaaS SSE: `POST /v1/agents/{id}/runs` with `accept: text/event-stream`, translates `status`, `assistant`, and `result` events into the SDK `SDKMessage` stream. Activates when a non-fixture API key + `THEOKIT_API_BASE_URL` are set.
- **Streaming progressive events**: `Run.stream()` is now a true progressive AsyncGenerator — events arriving from the real runtime over time are yielded as soon as they're appended, not only at termination.
- **Real local runtime activation**: when the API key is not a `theo_test_*` fixture key and at least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` is set, `LocalAgent.send()` routes through the real agent loop instead of fixture mode.

### Implementation status (Phase 1 — fixture-mode parity)
- `Agent.create()`, `Agent.send()` (both local + cloud), `Agent.resume()`, `Agent.list()`, `Agent.get()`, `Agent.listRuns()`, `Agent.getRun()`, `Agent.archive()`, `Agent.unarchive()`, `Agent.delete()` — implemented with deterministic fixture-mode responses for `theo_test_*` API keys.
- `Theokit.me()`, `Theokit.models.list()`, `Theokit.repositories.list()`, `Theokit.providers.list()` — implemented; route to real HTTP when `THEOKIT_API_BASE_URL` is set, otherwise serve fixture data.
- `Cron.create()` / `list()` / `get()` / `delete()` / `enable()` / `disable()` / `run()` — implemented with POSIX cron and shorthand validation, IANA timezone validation, and deterministic `nextRunAt` estimate.
- File-based discovery from `.theokit/`: `agents/*.md` (subagents), `skills/<name>/SKILL.md`, `plugins/<name>/plugin.json`, `mcp.json`, `hooks.json`, `context.json`, `cron/jobs.json`, `memory/<scope>.json`.
- Run lifecycle: `stream()` (AsyncGenerator of SDKMessage), `wait()`, `cancel()`, `conversation()`, `onDidChangeStatus()`. Status machine: `running → finished | error | cancelled`.
- Cloud runtime adapter calls Theo PaaS when `THEOKIT_API_BASE_URL` is set; otherwise emulates PaaS via fixture mode (CREATING / RUNNING / FINISHED status events, git metadata on result, artifact listing/download).
- Memory subsystem: file-backed store under `.theokit/memory/`, redacted public surface, namespace/scope keying.
- Skills, plugins, MCP, hooks, subagents, providers, context — public managers and file-based loaders.
- Quality Gates G1–G10 all green: typecheck, lint+format (Biome), publint, attw, smoke + roadmap tests (136/136), knip (dead code), depcruise (cycles), G8 LoC ≤ 400, G9 cognitive complexity ≤ 10, G10 jscpd 0 clones.
