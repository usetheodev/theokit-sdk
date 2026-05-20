# D110 — `internal/runtime/fork-agent.ts` is the canonical fork primitive

**Date:** 2026-05-19
**Status:** Accepted

## Decision

The fork primitive lives in `packages/sdk/src/internal/runtime/fork-agent.ts`.
Public surface: `Agent.fork(options)` instance method on local agents (cloud
agents throw `UnsupportedRunOperationError`). Module exports:
- `ForkOptions` — caller-supplied tool whitelist, prompt, optional override
- `ForkResult` — final response, tool calls, usage
- `forkAgentImpl(parent, options, deps)` — implementation
- `filterMemoryPlugins(unknown)` — EC-B helper

## Rationale

Hermes' `_spawn_background_review` lives in `run_agent.py` because Python
keeps everything in `__init__.py`. TypeScript modularity rewards a
dedicated file: fork is a primitive used by Curator (future), Kanban
worker (future), and judge (today). Vizinho de `local-agent.ts` so the
LocalAgent shorthand `agent.fork(opts)` can wire it without a circular
import.

## Consequences

- **Enables:** fork is a reusable building block; future "background work"
  features (Curator, Kanban) inherit the same lifecycle (dispose, memory
  provenance, whitelist isolation).
- **Constrains:** parent agent must expose `readonly options` for fork
  inheritance — added defensively on `LocalAgent` (T4.3).
