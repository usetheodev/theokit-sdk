---
id: D432
status: Decided
date: 2026-07-15
plan: pluggable-session-store
milestone: SE41
---

# D432 — Minimal 2-method `SessionStore` seam over the native format, not the removed `ConversationStorageAdapter`

## Context

SE40 (v4.0) made the native Claude-shaped `.jsonl` transcript the single source of truth and REMOVED the pluggable `ConversationStorageAdapter`. That deliberately dropped the use case where an external store (Postgres / Redis / KV / durable object) is the PRIMARY store AND resume source — needed for serverless (ephemeral FS) and multi-host / multi-pod deploys, where the local transcript neither persists across invocations nor is shared across pods. The only v4.0 workaround was a shared/replicated `baseDir` (network volume), which is not viable on serverless / edge. The owner chose to evolve the SE40 decision (SE41), restoring the capability WITHOUT reverting the old adapter.

## Decision

Ship a minimal, injectable `SessionStore` with EXACTLY TWO methods over the SAME native `SessionRecord` shape:

```ts
interface SessionStore {
  readRecords(agentId: string): Promise<SessionRecord[]>;               // append order; missing → []
  appendRecords(agentId: string, records: readonly SessionRecord[]): Promise<void>; // append-only delta
}
```

Injected via `local.sessionStore`; omitting it resolves to the default `FsSessionStore` (reads/append-writes the native `.jsonl`), byte-identical to SE40. The runtime store functions (`readSessionMessages` / `persistTurn` / `appendCompactBoundaryRecord`) operate through the store; `reconstructMessages` runs on the records the store returns.

## Alternatives considered

- **Revert the removed `ConversationStorageAdapter` (~10 methods: `getMessages`/`appendMessage`/`deleteConversation`/`SessionMeta`/objectives).** REJECTED — it re-introduces the barroque surface SE40 deleted, couples the store to the message-model + metadata + objectives that no longer exist, and does not operate on the native record shape (so it cannot preserve `--continue` interop cleanly). The two orthogonal concerns SE40 split out (session metadata, durable objectives) must stay gone.
- **Shared/replicated `baseDir` only (network volume).** REJECTED as the sole answer — insufficient for serverless / edge (no persistent FS) and adds an ops burden (a shared volume + its consistency) that a DB the app already runs does not.
- **A checkpointer-style single-blob `put/get` of the whole state (LangGraph `BaseCheckpointSaver` shape).** Considered; the record-delta `append` shape is closer to the native append-only DAG and avoids rewriting the whole session per turn on the external store.

## Rationale

- Two methods is the smallest surface that restores primary-store + resume: read all records to reconstruct, append the new-turn delta. Nothing else the removed adapter carried is needed.
- Operating on the native `SessionRecord` preserves the format and `--continue` interop — an external store may also mirror to `~/.claude`.
- Append-only matches the native `parentUuid` DAG (compaction is a new-root `compact_boundary`, still an append), so the store never rewrites/shrinks prior records.

## Consequences

- `local.sessionStore` default = `FsSessionStore`; the SE40 golden persistence / resume / compaction tests pass unchanged (byte-identical FS path).
- A store that cannot READ on resume MUST throw (fail-fast) — a silent `[]` would masquerade as "no history" and drop the conversation (enforced by a negative-case test).
- Consistency across concurrent hosts is the external store's contract (documented); the FS default serializes appends per agent under its existing file lock.
- The surface is locked to two methods by this ADR — pressure to re-add message-model / metadata / objective methods is scope-creep back to the removed adapter and requires a new ADR.
