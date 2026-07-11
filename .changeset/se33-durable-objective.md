---
"@theokit/sdk": minor
---

**SE33 — durable thread-scoped objective (`setObjective` over the existing `runUntil` + ConversationStorage).**

The SDK already ships the goal-judge loop (`agent.runUntil(goal, options)`, D115-D121) — but the goal was per-call and transient. SE33 adds the durable layer: a thread-scoped objective persisted through the EXISTING `ConversationStorageAdapter` seam, surviving reloads/restarts, managed via new `Agent` methods.

- **Persistence** — a namespaced `ObjectiveRecord` (`{ _schemaVersion: 1, objective, options?, status: "active"|"done"|"paused", runsUsed }`) keyed by `threadId`. `ConversationStorageAdapter` gains three OPTIONAL methods (`getObjectiveRecord` / `setObjectiveRecord` / `updateObjectiveRecord` — the last an ATOMIC read-modify-write so concurrent progress write-backs can't drop turns); the built-in `InMemoryConversationStorage` and `FileSystemConversationStorage` (a dedicated `.theokit/agents/<safe>/objective.json`, secret-redacted, file-locked, path-safe for exotic `threadId`s) implement them. Adapters that omit them degrade to a typed no-op — no new store, back-compat preserved.
- **Agent methods** — `agent.setObjective(objective, { threadId, ...options })` / `getObjective({ threadId })` / `updateObjectiveOptions({ threadId, ... })` (only provided fields written) / `clearObjective({ threadId })`. All no-op when the run is not memory-backed. A fresh agent sharing the same adapter reads the objective back (the adapter is the durability boundary).
- **Standing `goal` config** — `AgentOptions.goal` (`{ judgeModel?, maxRuns?, prompt? }`). Precedence (remembered in the record): per-objective `record.options` → standing `goal` config → built-in default (`maxRuns` 20). The judge is the activation switch: with no judge resolved, the standing objective is inert (no scoring, no budget consumed).
- **`runUntil(goal?, options?)`** — `goal` is now OPTIONAL. Existing callers pass `goal` (unchanged transient behavior). Omitting `goal` with `options.threadId` set reads the durable objective, resolves options by precedence, caps per-call `maxTurns` by the remaining durable budget, runs the loop, and writes `runsUsed`/`status` back — `maxTurns` exhaustion leaves the objective `active` so raising `maxRuns` later resumes. Omitting `goal` with no objective (or no `threadId`) yields a single `status_change: paused` and never throws.

Reuses existing seams only (the shipped `runUntil` loop + `ConversationStorage`) — no new loop, no parallel runtime, no in-agentic-loop step (that is SE34). ADR 0012. From the a peer framework Goals comparison (SDK Evolution roadmap SE33).
