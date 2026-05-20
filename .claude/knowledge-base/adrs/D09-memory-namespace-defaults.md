---
id: D9
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D9 — Memory namespace/scope defaults locked

## Context
The memory subsystem accepts `namespace`, `scope`, `userId` in `AgentOptions.memory`. Defaults were implemented but never formalized — consumers can't reliably rely on the shape.

## Decision
Defaults: `namespace="default"`, `scope="agent"`, `userId="default"`. Fully-resolved key path: `{cwd}/.theokit/memory/{namespace}/{scope}-{userId}.json` (legacy JSON) → migrated on first read to `{cwd}/.theokit/memory/MEMORY.md` + `notes/*.md`. Secret redaction strips `sk-*`, `ghp_*`, and `sk-proj-*` patterns via `redactSecrets()`.

## Rationale
These defaults already exist in code (`migration.ts:legacyMemoryJsonPath`, `types.ts:redactSecrets`). Formalizing the contract lets agents and integrations rely on them without inspecting source.

## Consequences
- Defaults locked. Future changes require an ADR superseding D9.
- Consumers wanting multi-user memory must explicitly set `userId`.
- Redaction patterns are part of the public contract — adding new patterns is additive (covers more secrets, never less).

## Alternatives Considered
- **`namespace = cwd basename`** — rejected; cwd basenames collide across forks/branches.
- **No redaction by default** — rejected; users routinely paste API keys into chat.
