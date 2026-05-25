# Component Map — `internal/runtime/` (BASELINE 2026-05-25)

74 files. Grouped by responsibility.

## Session / persistence (Phase 1 affects)
- `agent-session.ts` — in-process cache + chained per-(agent,cwd) promise queue
- `agent-session-store.ts` — pure FS functions (`appendToSessionFile`, `readSessionFile`, `compactSessionFile`)

## Registry / lifecycle (Phase 2 affects)
- `agent-registry.ts` — metadata `Map<id, RegisteredAgent>` (process-wide)
- `agent-registry-store.ts` — JSON persistence per cwd
- `agent-factory-registry.ts` — `Agent.create` callback injection (avoid import cycle)
- `run-registry.ts` — per-run state

## Local agent core
- `local-agent.ts` — primary class implementing `SDKAgent`
- `local-agent-bootstrap.ts`, `local-agent-dispatch.ts`, `local-agent-invalidate.ts`, `local-agent-memory.ts`, `local-agent-memory-direct.ts`, `local-agent-memory-hooks.ts`, `local-agent-personality-extensions.ts`, `local-agent-plugins.ts`, `local-agent-runtime-extensions.ts`
- `real-local-run.ts` — run loop body (consumed by Phase 4 abort wiring)
- `local-run.ts` — facade exposing run handle

## Cloud
- `cloud-agent.ts`, `cloud-run.ts`, `cloud-config-serializer.ts`, `cloud-payload-types.ts`, `cloud-tool-parity.ts`, `real-cloud-run.ts`

## Extension surfaces
- `fork-agent.ts` (ADR D110), `run-until.ts` (ADR D115), `hooks-*.ts` (4 files), `plugins-manager.ts`, `skills-manager.ts`, `subagents-loader.ts`, `providers-manager.ts`

## Context / system prompt
- `context-aggregator.ts`, `context-discovery-runner.ts`, `context-discovery.ts`, `context-frontmatter.ts`, `context-import-resolver.ts`, `context-loaders.ts`, `context-manager.ts`, `context-mdc-parser.ts`, `system-prompt.ts`, `system-prompt/`

## Tool-related
- `mcp-tools.ts`, `shell-tool.ts`, `validate-agent-options.ts`, `validate-response.ts`

## Misc
- `async-local-storage.ts` (ADR D111), `async-semaphore.ts` (ADR D135), `budget.ts`, `compression-helpers.ts`, `default-model.ts`, `post-run-lifecycle.ts`, `spawn-collect.ts`, `workspace-dir.ts`, `yaml-frontmatter.ts`
- `fixture-*.ts` (5 files — fixture mode)
- `memory-store.ts`, `personality/`, `plugin-frontmatter.ts`, `skill-frontmatter.ts`
