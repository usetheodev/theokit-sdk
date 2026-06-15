# Changelog

All notable changes to `@theokit/di-agent` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `@Squad({ agents, process? })` property decorator + `readSquadMetadata()` — the decorator surface for `@theokit/sdk` `createSquad` (decorator mandate). Stores team metadata via reflect-metadata, mirroring `@SubAgent`.
- `@Step({ after?, name? })` method decorator + `readStepMetadata()` + `buildWorkflow(instance)` — decorator-driven workflow authoring. `@Step` declares steps + a single upstream dependency; `buildWorkflow` compiles the decorated class into a `@theokit/sdk` `Workflow` (composition — no new engine), topologically ordering steps and threading each return value to the next. Fail-fast on no steps / unknown `after` / cycle.

## [0.1.0] - 2026-05-31

> First GA release. Promotes `0.1.0-next.0` to stable. API contract preserved — no breaking changes from `0.1.0-next.0`.

### Changed

- Removed obsolete `// biome-ignore lint/correctness/noUnusedVariables` directives from `tests/{analyze-graph,async-resolution,container-core,inject-agent,integration/real-agent}.test.ts`. They were flagged as `suppressions/unused` after the workspace enabled `javascript.parser.unsafeParameterDecoratorsEnabled` in `biome.json` (D422). (theokit-sdk-biome-cleanup)
- Dropped unused `@vitest/coverage-v8` devDependency. (theokit-sdk-biome-cleanup)

## [0.1.0-next.0] - 2026-05-29

### Added

- Initial release of `@theokit/di-agent` — agent-first DI integration for `@theokit/di`.
- `@InjectAgent()` parameter decorator (sugar over `@Inject(AGENT_TOKEN)`).
- `createAgentProvider({ factory, scope? })` helper producing a `FactoryProvider` with default `Scope.REQUEST`.
- `AGENT_TOKEN` exported constant for advanced wiring (custom providers under the same token).

### Validation

- 5 unit tests with mock Agent + 2 real-LLM integration tests (env-gated by `OPENROUTER_API_KEY`). Real-LLM run validated against OpenRouter (`openai/gpt-4o-mini`) — 800ms end-to-end.

### Peer dependencies

- `@theokit/di` `workspace:^` (kept in lockstep — Changesets `linked` config).
- `@theokit/sdk` `workspace:^` (the actual Agent runtime).
- `reflect-metadata` `^0.2.0` (transitive via `@theokit/di`).
