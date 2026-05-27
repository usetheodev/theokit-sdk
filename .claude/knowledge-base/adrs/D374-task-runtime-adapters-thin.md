# D374 — Runtime adapters (Run/Batch/Workflow/Cron) are thin wrappers over `Task.submit`

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

Each existing runtime (Run, Batch, Workflow, Cron) could embed its own observability layer. That path leads to four parallel implementations diverging over time. Mastra and Hermes both centralize on one task model.

## Decision

Adapters MUST call `Task.submit(kind, work, opts)` and never reimplement registry, ring buffer, store, or AbortController plumbing. The Task module is the single source of truth for async work observability.

## Rationale

- Mirrors D246 (Workflow composes over public API only).
- Reduces surface area: 1 set of edge cases instead of 4.
- Future runtimes (Eval.run, MCP tool calls) plug in without registry changes.

## Consequences

- Adapter code is small — a few dozen lines each.
- Adapter authors document their `meta` shape in JSDoc so consumers parse it consistently.
- Namespaced ID prefixes (`wf-`/`b-`/`cron-` per D368) are non-negotiable for adapter-generated tasks.
