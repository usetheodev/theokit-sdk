---
slug: pluggable-session-store
milestone_id: SE41
generated_by: roadmap-feature
date: 2026-07-15
status: completed
source: derived from in-session design discussion (conversationStorage removal, use-case A vs B; owner chose B)
---

# Feature grill — Pluggable SessionStore seam (SE41)

## Q1 — What is this feature and why now?

A **minimal pluggable `SessionStore` seam** over the native Claude Code `.jsonl` transcript, so an
external store (Postgres, Redis, a KV, a durable object) can be the **primary store + resume source**.

**Why now:** SE40 (v4.0) made the native transcript the single source of truth and **removed the
pluggable `ConversationStorageAdapter`**. That deliberately dropped the use case where an external DB
*is* the store and the resume source — needed for **serverless (ephemeral FS)** and **multi-host /
multi-pod** deployments, where the local transcript neither persists across invocations nor is shared
across pods. Surfaced by the owner while validating the v4.0 docs: the only current workaround is a
shared/replicated `baseDir` (network volume), which is not viable on serverless/edge. This is a
**conscious evolution of the SE40 removal** — the minimal seam, NOT a revert of the old adapter.

out_of_scope_overlap_false_positive: none — the roadmap's "Explicitly out of scope" section is about the
Anthropic-SDK architecture comparison; the SE40 deferrals are `--continue`/thinking/sidecar. Neither
covers an external-store seam. No conflict.

## Q2 — Dependencies (must be `[x]` before start)

- **SE40** ([x]) — the native `SessionRecord` format + `readTranscript`/`writeTranscript`/
  `reconstructMessages` are the substrate the seam wraps. The FS transcript store becomes the default
  reference implementation of the new interface.

## Q3 — Definition of done (verifiable)

1. Minimal public `SessionStore` interface — **2 methods over the NATIVE `SessionRecord` shape**:
   `readRecords(agentId): Promise<SessionRecord[]>` + `appendRecords(agentId, records): Promise<void>`.
   Explicitly NOT the removed ~10-method adapter (no getMessages/compact/getSessionMeta/objectives).
2. Injected via `local.sessionStore`; **DEFAULTS to the FS transcript store** (current behavior) as the
   reference impl of the SAME interface — omitting it ⇒ identical current behavior (back-compat, no
   consumer change).
3. Resume works from the external store across a **simulated cold start** (fresh process, no local FS):
   `Agent.resume(agentId, { local: { sessionStore } })` hydrates via
   `reconstructMessages(await store.readRecords(...))`.
4. Native format + `--continue` interop **preserved**: records are the same Claude-shaped shape; a store
   that also mirrors to `~/.claude` still works with the CLI. Append-only compaction (`compact_boundary`)
   works over the seam.
5. TDD + a serverless-shaped example (an in-memory store standing in for Postgres/Redis) + docs.md
   section + an **ADR** (why a 2-method record seam vs the removed adapter). A real reference impl ships
   (no stubs — per `no-stubs-no-mocks-no-wired`).

## Q4 — Top 2 new risks

1. **Scope creep back to the barroque adapter.** Pressure to re-add message-model / metadata / objectives
   methods. Mitigation: the seam is JUST record read/append over the native shape; the ADR locks the
   surface to 2 methods.
2. **Consistency/atomicity across concurrent hosts.** Two pods appending to one `agentId` on a shared
   external store can race or read stale. Mitigation: append-only semantics + a documented ordering/
   locking contract; the FS default reuses the existing file lock; external impls own (and document)
   their own consistency guarantees.
