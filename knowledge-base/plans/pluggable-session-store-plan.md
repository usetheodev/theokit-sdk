---
slug: pluggable-session-store
milestone_id: SE41
created_at: 2026-07-15
goal: Minimal 2-method SessionStore seam over the native SessionRecord shape — external-store resume for serverless/multi-host, defaulting to the FS transcript, without reverting the removed ConversationStorageAdapter.
---

# Plan — SE41 Pluggable `SessionStore` seam over the native transcript

## Goal

Ship a **minimal, injectable `SessionStore`** so an external store (Postgres/Redis/KV/DO) can be the
PRIMARY store + resume source, restoring the serverless (ephemeral FS) / multi-host use case SE40 removed
with `ConversationStorageAdapter` — WITHOUT reverting the old ~10-method adapter and WITHOUT changing the
on-disk format. The FS transcript becomes the default reference implementation of the same interface.

## Coverage Matrix (every Goal claim → task)

| Goal claim | Task(s) |
|---|---|
| Minimal 2-method `SessionStore` interface over native `SessionRecord` | T1 |
| FS default impl of the same interface (`FsSessionStore`) — omitting ⇒ identical behavior | T2 |
| Wire `local.sessionStore` → hydrate (read) + persist (append) + compaction paths | T3 |
| Resume from external store across simulated cold start | T4 (integration test) |
| Native format + `--continue` interop preserved (records unchanged) | T2, T4 |
| Serverless-shaped example (real in-memory store impl, no stub) | T5 |
| docs.md + Changeset + ADR | T6 |

## Baseline Context (current state — verified against src)

- **Native record + I/O** (`src/internal/persistence/session-transcript.ts`): `SessionRecord` (:26),
  `SessionTranscript` (:81), `reconstructMessages` (:276), `readTranscript`/`writeTranscript`/
  `transcriptPath`/`encodeProjectDir` (public via `@theokit/sdk/persistence`).
- **Store wiring points** (`src/internal/runtime/session/agent-session-store.ts`):
  `readSessionMessages(baseDir, cwd, agentId)` (:116) → `readTranscript` + `reconstructMessages` (READ);
  `persistTurn(loc, sessionId, turn)` (:156) → reads all + seeds `SessionTranscript.fromRecords` +
  appends the turn + `writeTranscript` (WRITE — currently rewrites the whole file atomically);
  `appendCompactBoundaryRecord(loc, sessionId, meta)` (:177). `TranscriptLocation` (:104) = `{ baseDir,
  cwd, agentId, model }`.
- **Runtime consumers** (`src/internal/runtime/session/agent-session.ts`): `hydrateSession` → calls
  `readSessionMessages`; `persistTurnToTranscript` → calls `persistTurn` (+ compaction every 50 turns).
- **LocalAgent** (`src/internal/runtime/local-agent/local-agent.ts`): `resolveBaseDir` (:513),
  `transcriptBaseDir` threaded into `hydrateSession`/`runPostRunLifecycle`. `LocalOptions` in
  `types/agent.ts` (has `baseDir?`).
- **The removed adapter** (git `2e31edf6~1:src/types/conversation-storage.ts`): had `StoredMessage`,
  `getMessages(offset/limit)`, `appendMessage`, `deleteConversation`, `SessionMeta`/`SessionMetaPatch`,
  objectives — the barroque surface SE41 MUST NOT re-add.

## Design (the seam)

```ts
// New public interface (types/session-store.ts), over the NATIVE record shape:
export interface SessionStore {
  /** All records for this agent's session, in append order (root→leaf). */
  readRecords(agentId: string): Promise<SessionRecord[]>;
  /** Append these records to the agent's session (append-only; never rewrites/truncates). */
  appendRecords(agentId: string, records: readonly SessionRecord[]): Promise<void>;
}
```

- **`FsSessionStore`** (default impl): `readRecords` = `readTranscript(transcriptPath(baseDir, cwd, agentId))`;
  `appendRecords` = append the delta records to the `.jsonl` (true append via the existing atomic/lock
  primitives). Constructed from `{ baseDir, cwd }`. This REPLACES the current read-all/rewrite-all
  write with a genuine append (append-only was already the semantic; this makes it literal).
- **Injection**: `local.sessionStore?: SessionStore` on `LocalOptions`. Resolved once in LocalAgent:
  `this.sessionStore = options.local?.sessionStore ?? new FsSessionStore({ baseDir, cwd })`. Threaded into
  `hydrateSession` (read) + `persistTurnToTranscript` (append) + compaction.
- **`agent-session-store.ts` refactor**: `readSessionMessages`/`persistTurn`/`appendCompactBoundaryRecord`
  take a `SessionStore` instead of doing FS I/O directly; they call `store.readRecords`/`store.appendRecords`.
  `reconstructMessages` still runs on the records the store returns (unchanged).

## Tasks (TDD — RED before GREEN each)

### T1 — `SessionStore` interface + public export
- **TDD:** `test_sessionstore_is_two_methods` — a hand-written store implementing only `readRecords`/`appendRecords` type-checks and is accepted where `SessionStore` is expected; assert the interface has exactly those 2 methods (no getMessages/meta/objective).
- Add `src/types/session-store.ts`; export `SessionStore` from `index.ts` + `types/index.ts`.

### T2 — `FsSessionStore` default impl (append-only)
- **TDD:** `fs_store_roundtrip` — `appendRecords(agentId, [r1])` then `appendRecords(agentId, [r2,r3])`;
  `readRecords(agentId)` returns `[r1,r2,r3]` in order; the on-disk file is the native `.jsonl` at
  `transcriptPath` and is byte-parseable by `readTranscript`. `fs_store_append_is_additive` — second
  append does NOT rewrite/truncate the first (assert file grew, r1 line intact). Negative: `readRecords`
  on a missing session → `[]`.
- Impl in `src/internal/persistence/fs-session-store.ts`. Reuse `transcriptPath` + the existing file lock
  + atomic append (`withFileLock` + append). Keep the `mkdir -p` parent-dir fix from SE40.

### T3 — Wire `local.sessionStore` through hydrate/persist/compaction
- **TDD (unit):** `readSessionMessages` / `persistTurn` / `appendCompactBoundaryRecord` accept a
  `SessionStore` and call it (spy store asserts read/append invoked with the right records). Default
  path: `Agent.create({ local: { cwd, baseDir } })` (no sessionStore) → uses `FsSessionStore`, byte-
  identical to today (a golden test still passes).
- Add `LocalOptions.sessionStore?: SessionStore` (`types/agent.ts`); resolve in `local-agent.ts`; thread
  through `agent-session.ts` (`hydrateSession`, `persistTurnToTranscript`) + `agent-session-store.ts`.

### T4 — Cold-start resume from an EXTERNAL store (the headline)
- **TDD (integration):** an in-memory `SessionStore` (a `Map<agentId, SessionRecord[]>`) shared across
  two `Agent` instances in SEPARATE simulated processes (clear the in-memory session cache + registry
  between). Process 1: `Agent.create({ agentId, local: { sessionStore } })` → send (plant a fact) →
  dispose. Process 2 (caches cleared, NO local FS write): `Agent.resume(agentId, { local: { sessionStore } })`
  → the prior turn is hydrated from the store (assert `getSessionMessages`/reconstruct). With a real LLM
  (OpenRouter): the resumed agent recalls the fact across the store — real-LLM evidence per
  `real-llm-validation.md`.
- Also assert compaction (`compact_boundary`) records go through `appendRecords`.

### T5 — Serverless-shaped example (real impl, no stub)
- `examples/session-store-external/run.ts` — a real `SessionStore` backed by a `Map` (documented as the
  Postgres/Redis shape); shows create→send→dispose→resume-from-store recall across a simulated cold
  start. Runs 100% with the real key. Add to manifest + examples-workspace.

### T6 — docs.md + ADR + Changeset
- docs.md § Session persistence: document `SessionStore` (2 methods) + `local.sessionStore` + the default
  FS impl + the external-store/serverless pattern + `--continue` note (external store can still mirror to
  `~/.claude`). Add `local.sessionStore` to the Configuration reference type row.
- ADR: "Minimal 2-method SessionStore over the native format, not the removed ConversationStorageAdapter"
  (alternatives: revert adapter — rejected; shared baseDir only — insufficient for serverless).
- `packages/sdk/CHANGELOG.md` `[Unreleased] § Added`.

## Failure scenarios (external-I/O seam)
- `readRecords` throws (store down) on resume → surface a typed error, do NOT silently start empty
  (fail-fast; a test asserts the typed error, not a swallowed `[]`).
- `appendRecords` throws mid-run → the run's write is best-effort (same as today's FS write) but the error
  is logged with context; a test asserts it does not corrupt the in-memory session.
- Concurrent `appendRecords` for one agentId (two hosts) → append-only + documented ordering contract; FS
  default uses the file lock. (Cross-host locking is the external impl's responsibility — documented.)

## Concurrency tests
- `#### Concurrency tests` — two concurrent `appendRecords` on the FS default for one agentId serialize
  via the lock and both records survive (no torn line, no lost append).

## Drawbacks & Risks
1. Scope creep back to the barroque adapter — mitigated by the ADR locking the 2-method surface.
2. Consistency across hosts — append-only + documented contract; FS lock for the default; external impls own it.

## Unresolved Questions
- (none — the interface, wiring points, and defaults are all pinned against real src above.)

## Prior Art
- Removed `ConversationStorageAdapter` (git `2e31edf6~1`) — the anti-pattern to avoid (10 methods).
- a framework `BaseCheckpointSaver` (put/get over a canonical state; in-memory default + Postgres/Redis
  impls) — the SOTA "pluggable store over a canonical format" shape this mirrors, minimally.

## Acceptance / DoD (from ROADMAP SE41)
- [ ] 2-method `SessionStore` over native `SessionRecord`; no getMessages/meta/objective.
- [ ] `local.sessionStore` defaults to FS store; omitting ⇒ byte-identical behavior (golden test).
- [ ] Cold-start resume from external store works (integration + real-LLM recall).
- [ ] Native format + `--continue` preserved; compaction over the seam.
- [ ] TDD + serverless example (real impl) + docs.md + ADR + Changeset. No stubs.
