# ADR 0012 — Durable thread-scoped objective (SE33)

- **Status:** Accepted (2026-07-11)
- **Milestone:** SE33 (SDK Evolution — Mastra Goals parity, the durable half)
- **Relates:** `runUntil` goal loop (ADRs D115-D121), `ConversationStorageAdapter` + SE4 session-meta seam, SE29 (`WorkflowSnapshot._schemaVersion` discipline)

## Context

The SDK already ships the goal-judge loop — `agent.runUntil(goal, options)` (D115-D121): an LLM-as-judge drives the agent toward a goal until satisfied or `maxTurns`, with per-iteration feedback + typed `GoalEvent`s. But the goal is **per-call and transient** (a parameter, gone when the call returns). Mastra Goals add a **durable** layer: the objective is persisted in thread state, survives reloads/restarts, and is managed via `Agent` methods. SE33 adds that durable half, reusing existing seams (the `ConversationStorageAdapter` + the shipped `runUntil` loop) — no new subsystem, no new loop.

## Decision

**D1 — Persist the objective via a NEW pair of OPTIONAL adapter methods, NOT by extending `SessionMeta`.** `ConversationStorageAdapter` gains `getObjectiveRecord?(conversationId): Promise<ObjectiveRecord | undefined>` + `setObjectiveRecord?(conversationId, record: ObjectiveRecord | null): Promise<void>` (a `null` record CLEARS — mirroring how `SessionMetaPatch` `null` clears a tag). This mirrors the SE4 `getSessionMeta?`/`setSessionMeta?` optional-method + typed-degradation pattern EXACTLY. Rationale: `SessionMeta` is *display* metadata (title/tag); the objective is *application state* with a different shape and lifecycle — conflating them would break SE4's narrow scope. Optional methods ⇒ an adapter that omits them makes the agent's objective methods a no-op (never throw), same contract as SE4.

**D2 — `ObjectiveRecord` shape carries a schema version, keyed by `conversationId` = the caller's `threadId`.**
```
ObjectiveRecord {
  readonly _schemaVersion: 1     // mirror WorkflowSnapshot (SE29) — future-proof migration
  readonly objective: string
  readonly options?: DurableGoalOptions   // { maxRuns?, judgeModel?, prompt? } — the per-objective overrides
  status: 'active' | 'done' | 'paused'
  runsUsed: number
}
```
The record is stored under the `conversationId` the caller supplies as `threadId`. TheoKit's storage is conversation-keyed; the `threadId` IS the conversation key (faithful to Mastra's thread scoping, no new id concept).

**D3 — Precedence, remembered in the record: per-objective `record.options` → agent `goal` config → built-in default.** `setObjective` / `updateObjectiveOptions` write the per-objective overrides into `record.options`; they take precedence over the standing agent `goal` config, which takes precedence over the built-in defaults (`maxRuns` = 20 — the `runUntil` default; the default judge model). **The judge is the activation switch:** if no judge resolves (neither `record.options.judgeModel` nor agent `goal.judgeModel`/`goal.judge`), the standing objective is inert — `runUntil` on it is a no-op (no scoring, no budget consumed), mirroring Mastra.

**D4 — `runUntil(goal?, options?)` — `goal` becomes OPTIONAL (back-compat preserved).** Existing callers pass `goal` (unchanged behavior — the transient D115-D121 loop). When `goal` is omitted AND `options.threadId` is set, `runUntil` reads the durable `ObjectiveRecord`, resolves options by D3 precedence, runs the loop against `record.objective`, and WRITES BACK `runsUsed` + `status`: `done` on judge-satisfied, `paused` on abort, and **stays `active` on `maxTurns` exhaustion** (raising `maxRuns` later resumes). Omitting `goal` with no durable objective (or no `threadId`) is a no-op that yields a single `status_change: paused` with a clear reason (never throws).

**D5 — Extraction to respect G8.** The four agent methods (`setObjective`/`getObjective`/`updateObjectiveOptions`/`clearObjective`) live in a new `internal/runtime/local-agent/local-agent-goal-extensions.ts` (mirroring the existing `local-agent-runtime-extensions.ts`), delegating to a pure `internal/runtime/objective/objective-store.ts` (set/get/update/clear over an adapter). `local-agent.ts` only registers the thin method wrappers — keeps it under the 400-SLOC cap.

**D6 — No-op when not memory-backed.** No `threadId`, no storage adapter, or an adapter lacking `getObjectiveRecord`/`setObjectiveRecord` ⇒ the objective methods return `undefined`/`void` without throwing. Same typed-degradation contract as SE4's session manager.

**D7 — Atomic progress write-back (review HIGH-1).** The `runsUsed`/`status` write-back and the options merge are read-modify-writes. A third OPTIONAL adapter method — `updateObjectiveRecord(id, mutate)` — owns the whole get→mutate→set under the adapter's own concurrency guard (the FS adapter holds its file lock across BOTH the read and the write; the in-memory adapter is synchronously atomic). The store prefers it and falls back to a non-atomic get+set only when an adapter omits it. This closes the TOCTOU where two concurrent write-backs on one thread could each read a stale `runsUsed` and drop turns.

**D8 — Never-throw path guard for `threadId` (review HIGH-2).** The FS `objective.json` path derives from the caller-supplied `threadId` via the TOTAL `safeFilenameForId` (hashes exotic characters to a deterministic `h-<hex>` dir) instead of `sanitizeIdentifier` (which throws on non-conforming ids). This honors D6's never-throw contract for the public objective methods; conforming ids still pass through unchanged so the objective sits beside the transcript in the normal case. A non-positive `maxRuns` is a caller error, not a degradation — it fails fast with a typed `ConfigurationError` at the agent-method boundary. A fully-spent durable budget resolves to `exhausted` (a clean `paused` event) rather than entering the loop with a 0-turn budget.

## Consequences

- The durable objective is the majority of the Mastra Goals delta, shipped by reusing two existing seams (ConversationStorage + `runUntil`) — no new loop, no parallel runtime (stays inside the SDK-owns-runtime invariant).
- Adapters opt into durability by implementing two optional methods; those that don't degrade gracefully.
- SE34 (per-send `isTaskComplete` + `<current-objective>` projection + the ADR-gated in-loop step) builds on this record — the in-agentic-loop step is deliberately NOT part of SE33 (SE33 reuses the existing OUTER `runUntil` loop, zero loop surgery).

## Alternatives rejected

- **Extend `SessionMeta` with objective fields.** Rejected (D1) — conflates display metadata with application state; breaks SE4's scope.
- **A dedicated new store for objectives.** Rejected — the ConversationStorageAdapter already scopes per-conversation persistence; a second store duplicates the seam (DRY / Rule 9). Optional methods on the existing adapter is the minimal surface.
- **A new explicit `threadId` concept separate from the conversation key.** Rejected — TheoKit storage is conversation-keyed; reusing that key as the thread scope is faithful to Mastra and adds no id plumbing.
- **Ship the in-agentic-loop step in SE33.** Rejected — that touches the shipped agent loop (highest scrutiny); it is SE34, ADR-gated, demand-first.
