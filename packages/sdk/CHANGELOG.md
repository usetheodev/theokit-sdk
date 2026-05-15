# Changelog

All notable changes to `@usetheo/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Fixed
- `setupSchema` of fixture providers no longer leaks env-var-name shaped strings (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...) that matched the hygiene regex. Schemas now use a generic `credential` property name (internal contract change; public shape unchanged).

### Implementation status (Phase 1 — fixture-mode parity)
- `Agent.create()`, `Agent.send()` (both local + cloud), `Agent.resume()`, `Agent.list()`, `Agent.get()`, `Agent.listRuns()`, `Agent.getRun()`, `Agent.archive()`, `Agent.unarchive()`, `Agent.delete()` — implemented with deterministic fixture-mode responses for `theo_test_*` API keys.
- `Theokit.me()`, `Theokit.models.list()`, `Theokit.repositories.list()`, `Theokit.providers.list()` — implemented; route to real HTTP when `THEOKIT_API_BASE_URL` is set, otherwise serve fixture data.
- `Cron.create()` / `list()` / `get()` / `delete()` / `enable()` / `disable()` / `run()` — implemented with POSIX cron and shorthand validation, IANA timezone validation, and deterministic `nextRunAt` estimate.
- File-based discovery from `.theokit/`: `agents/*.md` (subagents), `skills/<name>/SKILL.md`, `plugins/<name>/plugin.json`, `mcp.json`, `hooks.json`, `context.json`, `cron/jobs.json`, `memory/<scope>.json`.
- Run lifecycle: `stream()` (AsyncGenerator of SDKMessage), `wait()`, `cancel()`, `conversation()`, `onDidChangeStatus()`. Status machine: `running → finished | error | cancelled`.
- Cloud runtime adapter calls Theo PaaS when `THEOKIT_API_BASE_URL` is set; otherwise emulates PaaS via fixture mode (CREATING / RUNNING / FINISHED status events, git metadata on result, artifact listing/download).
- Memory subsystem: file-backed store under `.theokit/memory/`, redacted public surface, namespace/scope keying.
- Skills, plugins, MCP, hooks, subagents, providers, context — public managers and file-based loaders.
- Quality Gates G1–G10 all green: typecheck, lint+format (Biome), publint, attw, smoke + roadmap tests (102/102), knip (dead code), depcruise (cycles), G8 LoC ≤ 400, G9 cognitive complexity ≤ 10, G10 jscpd 0 clones.
