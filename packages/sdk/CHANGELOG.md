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
- `UnsupportedRunOperationError` now extends `TheokitAgentError` with `isRetryable: false` and stable `code: "unsupported_run_operation"`. Previously extended `Error` directly — old `instanceof TheokitAgentError` checks against this error now return `true`.
- `RunOperation` union extended with `"listArtifacts"` and `"downloadArtifact"`. Agent-level operations can now be reported through `UnsupportedRunOperationError.operation`.

### Not yet implemented
- `Agent.create()`, `Agent.prompt()`, `Agent.resume()`, `Agent.list()`, `Agent.get()`, `Agent.listRuns()`, `Agent.getRun()`, `Agent.archive()`, `Agent.unarchive()`, `Agent.delete()` — all throw on call.
- `Theokit.me()`, `Theokit.models.list()`, `Theokit.repositories.list()` — all throw on call.
- Local runtime adapter (will wrap `pi-agent-core` + `pi-ai`).
- Cloud runtime adapter (will call Theo PaaS once it reaches general availability).
- MCP server discovery from `.theokit/mcp.json` / `~/.theokit/mcp.json`.
- File-based subagents from `.theokit/agents/*.md`.
- File-based hooks from `.theokit/hooks.json`.
