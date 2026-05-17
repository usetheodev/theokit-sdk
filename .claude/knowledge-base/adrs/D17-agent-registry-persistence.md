---
id: D17
status: Decided
date: 2026-05-16
plan: chat-assistant-readiness
---

# D17 — Agent registry persists to `.theokit/agents/registry.json`

## Context
`Agent.create / archive / update / delete` previously only mutated an in-memory `Map` (`packages/sdk/src/internal/runtime/agent-registry.ts`). On process restart the Map was empty and `Agent.resume(agentId)` threw `UnknownAgentError(code: "unknown_agent")`. A chat assistant bot author had to write registry persistence themselves — ~150 LoC of boilerplate per consumer.

## Decision
Every `registerAgent / updateRegisteredAgent / removeRegisteredAgent` call schedules an atomic write-through to `<cwd>/.theokit/agents/registry.json`. The in-memory Map remains the read-through cache; persistence is keyed per-cwd. Public entry points (`Agent.resume / list / get`) hydrate from disk on miss via `hydrateRegistryFromDisk(cwd)`.

## Rationale
- Matches the proven ADR D8 pattern (`Cron` persists to `.theokit/cron/jobs.json` the same way).
- JSON is human-editable, git-friendly, cheap to load.
- Atomic write (`replaceFileAtomic`: per-call unique tmp + fsync + rename) gives crash-safety: either the old file or the new file, never a partial file.
- Per-cwd file isolates two SDK processes operating in different workspaces (EC-5).
- Coalescing + dirty-flag re-loop (Phase 5 fix) keeps disk IO cheap under burst load AND captures mutations that arrive during an in-flight save.

## Consequences
- First `Agent.create` after process start triggers a registry load when an `agentId` is pinned.
- Disk writes happen on every mutation but are infrequent (creates/disposes are not in the hot path).
- `withCwdMutex(`registry:${cwd}`)` gates concurrent in-process writes; cross-process writes still race (EC-10 — documented as "one SDK process per cwd").
- Secrets (apiKey, MCP server headers/env, hooks closures, inline tool handlers) are NEVER persisted — the allow-list in `stripSecretsFromOptions` mirrors the cloud-config-serializer (ADR D15).
- Corrupt registry.json (EC-4) recovers to `{}` with stderr warning; next save overwrites with valid JSON.

## Alternatives Considered
- **SQLite** — rejected; complexity-vs-benefit unjustified at expected scale (≤thousands of agents per workspace).
- **In-memory only with restart contract** — rejected; the contract "Agent.resume works across restart" is load-bearing for chat assistants.
- **Cross-process file lock** — rejected; out-of-scope for v1.0 (deferred to v1.x).
