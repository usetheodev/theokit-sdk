---
id: D21
status: Decided
date: 2026-05-16
plan: chat-assistant-readiness
---

# D21 — `Agent.resume(id)` falls back to disk when the in-memory registry misses

## Context
With persistence (ADR D17), the disk holds the answer for "what agents exist". `Agent.resume(id)` previously only checked the in-memory `Map` — useless after a process restart. The cold-fallback path (cold-create with the same id) silently wiped prior conversation history.

## Decision
`Agent.resume(id, options)`:
1. Check the in-memory `Map`. Hit → rehydrate from the cached entry.
2. Miss → `await hydrateRegistryFromDisk(persistenceCwd)`. The persistenceCwd is derived from `options.local?.cwd` (caller-supplied) or `process.cwd()`.
3. After hydrate, recheck the Map. Hit → rehydrate.
4. Still miss → fall back to the existing cold-start (create a fresh LocalAgent/CloudAgent with no priors).

When rehydrating a LOCAL entry, validate that `options.local.cwd` still exists on disk. If the directory is gone (workspace was deleted between runs), throw `UnknownAgentError(code: "agent_rehydration_failed", cause: ...)`. The caller can decide whether to re-create the agent or surface the error to the user.

## Rationale
- Today resume only works in-process. With persistence, the disk has the answer; resume becomes the natural API for "recover after restart". No new method; the existing API gains the capability.
- Validation prevents a stale entry from silently re-initializing against a missing path and failing mysteriously deep in the loader chain.

## Consequences
- `Agent.resume` is now a meaningfully different code path on miss (does disk IO).
- The caller MUST pass `local: { cwd: workspace }` to `Agent.resume` if the agent was created in a non-default cwd. Without it, the SDK probes the wrong `<process.cwd()>/.theokit/agents/registry.json` and falls to the cold path.
- EC-1 collision throw (`ConfigurationError(code: "agent_id_already_exists")`) forces consumers to use the resume-first pattern:
  ```ts
  try { return await Agent.resume(id); }
  catch (e) {
    if (e instanceof UnknownAgentError) return await Agent.create({ agentId: id, ... });
    throw e;
  }
  ```
- Secrets (apiKey, MCP headers) are NOT persisted — callers must re-supply them on `Agent.resume(id, { apiKey, ... })` or rely on env-var fallback.

## Alternatives Considered
- **Auto-create on miss** — rejected; the same `Agent.create({ agentId })` already does this (with the EC-1 collision check). Two APIs collapsing to one is more confusing than two APIs with distinct semantics.
- **Sync disk read at module load time** — rejected; couples module init to disk IO.
- **Eager hydrate on first SDK call** — rejected; hidden cost that bites unrelated callers.
