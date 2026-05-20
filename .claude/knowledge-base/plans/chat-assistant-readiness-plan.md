# Plan: Chat Assistant Readiness — Multi-Session Persistence

> **Version 1.0** — Fix the 5 limitations that prevent `@usetheo/sdk` from being a drop-in foundation for a persistent multi-user chat assistant (Telegram/Slack/Discord/etc). The blocker today: agent registry + session messages live in-memory only, so a bot process restart wipes every user's context. This plan adds persistent registry, persistent session messages, per-agent send mutex, `corpus="sessions"` memory recall, and ships a reference Telegram example to prove the pattern. Outcome: a user-built bot that survives restart with conversation continuity across all chats without the bot author writing persistence code.

## Context

### What exists today

- `LocalAgent` + `CloudAgent` register themselves in an **in-memory Map** (`packages/sdk/src/internal/runtime/agent-registry.ts`). On process restart the Map is empty → `Agent.resume(agentId)` throws `UnknownAgentError(code: "unknown_agent")`.
- Session messages (`getSessionMessages` / `appendSessionMessage` in `agent-session.ts`) are also in-memory `Map<agentId, SessionMessage[]>`. Restart wipes conversation history; even if the agent is recreated, the LLM sees the user as a stranger.
- `LocalAgent.send` has no mutex. Two HTTP webhook requests hitting the same `agentId` simultaneously interleave their `appendSessionMessage` calls → conversation order corrupts.
- `memory_search` accepts `corpus: "memory" | "sessions" | "wiki" | "all"` per ADR D5 + OpenClaw parity, but `"sessions"` is declared in the type union and **never indexed**. Past-conversation recall doesn't work.
- No reference example shows the chat assistant pattern. The `memory` example shows single-process recall but not the persistent-bot deployment pattern.

### Why now

Per the previous session's competitive audit: positioning the SDK as the foundation a developer would pick over Mastra (workflow engine) or hermes-agent (chat product) hinges on the SDK being a **trustworthy harness for chat assistant patterns**. Today it isn't — a bot author rewrites registry persistence, session storage, concurrency control, and session indexing themselves. That's ~500 LoC of boilerplate per consumer. Closing this gap turns the SDK from "useful for scripts" to "the obvious choice for long-running multi-user bots".

### Evidence

- `packages/sdk/src/internal/runtime/agent-registry.ts:14-22` — registry is `const REGISTRY = new Map<string, RegisteredAgent>()` only.
- `packages/sdk/src/internal/runtime/agent-session.ts:18-31` — sessions are `const SESSIONS = new Map<string, SessionMessage[]>()` only.
- `packages/sdk/src/internal/memory/index-manager.ts` — IndexManager indexes `MEMORY.md`, `notes/*.md`, and `wiki/*.md`. No `sessions/` source.
- `packages/sdk/src/internal/memory/tools.ts:createMemorySearchTool` — accepts `corpus` parameter but the filter for `"sessions"` returns empty.
- CLAUDE.md root: "Cross-process `Agent.resume` (in-memory only) — tracked as future work" → this plan IS that future work.

## Objective

A bot author using `@usetheo/sdk` can:

1. Create N agents per process (one per chat) with `Agent.create({ agentId: "tg-${chatId}", ... })` OR auto-generated ids.
2. Kill `-9` the process and restart it.
3. Call `Agent.resume("tg-${chatId}")` → agent comes back with **full conversation history** AND **memory facts** AND **active memory cache**.
4. Receive two concurrent webhook calls for the same chat → SDK serializes them automatically, no interleaved conversation corruption.
5. The agent, asked "what did we talk about yesterday?", uses `memory_search({ corpus: "sessions" })` to find past run summaries.

**Measurable goals:**

1. New `agent-registry-store.ts` persists every agent registration to `.theokit/agents/registry.json` (atomic write per ADR D8 pattern). Survives process restart.
2. New `agent-session-store.ts` persists session messages to `.theokit/agents/<agentId>/messages.jsonl` (append-only). Each agent has its own file; capped at 200 turns by default, configurable.
3. `LocalAgent.send` acquires a per-agent mutex (`withCwdMutex` key `agent-send:${agentId}`) so concurrent sends serialize cleanly.
4. After each `run.wait()`, the SDK writes a session summary to `.theokit/memory/sessions/<runId>.md`. IndexManager picks it up. `memory_search({ corpus: "sessions" })` returns ranked hits.
5. New `examples/telegram-bot/` reference example: real `grammy` bot, `Agent.resume`-on-message-arrival pattern, restart-safe, ~150 LoC.
6. Existing 250 vitest tests stay green. Plan adds 30+ new tests covering persistence + concurrency + session corpus.
7. Two new ADRs (D17-D18) and three (D19-D21) materialized.

## ADRs

### D17 — Agent registry persisted to `.theokit/agents/registry.json` (atomic write)

**Decision:** Every `registerAgent`, `updateRegisteredAgent`, `removeRegisteredAgent` call writes the full registry to `.theokit/agents/registry.json` via `replaceFileAtomic`. The in-memory `Map` stays as the read-through cache; persistence is a write-through layer.

**Rationale:** Matches ADR D8 (cron persists to `.theokit/cron/jobs.json` same way). JSON is human-editable, git-friendly, cheap to load. SQLite was considered — rejected for the same reasons cron rejected SQLite: ≤thousands of agents, single-process write semantics, atomic rename is enough.

**Consequences:** First `Agent.create` after process start triggers a registry load. Disk writes happen on every mutation but are infrequent (creates + disposes are not in the hot path). The `withCwdMutex` already used for memory writes also gates registry writes to prevent concurrent-write tearing.

### D18 — Session messages persisted to `.theokit/agents/<agentId>/messages.jsonl` (append-only)

**Decision:** Each agent has its own JSONL file at `.theokit/agents/<agentId>/messages.jsonl`. New turns append a single line. Reads stream the file from disk. Default cap: last 200 turns retained (older lines pruned via copy-on-write compaction when the file exceeds 400 lines).

**Rationale:** Conversation history is naturally append-only. JSONL is append-friendly (just `fs.appendFile`), failure-mode-safe (a partial write loses at most the last record), and trivially streamable. Per-agent file isolates concurrent reads/writes — no global lock contention.

**Consequences:** `.theokit/agents/<agentId>/` directory created lazily on first send. Compaction is opportunistic (run during `dispose()` or first append after threshold). 200 turns ≈ 100 user turns + 100 assistant — well above any single conversation, well below disk-hog territory.

### D19 — Per-agent send mutex (`withCwdMutex` keyed by `agent-send:${agentId}`)

**Decision:** `LocalAgent.send` wraps its body in `withCwdMutex("agent-send:" + agentId, async () => { ... })`. Concurrent `agent.send()` calls on the same agent serialize through the mutex.

**Rationale:** Two webhook requests hitting the same chat-id simultaneously would otherwise interleave `appendSessionMessage` calls; the resulting conversation history is corrupt and the LLM gets unprocessable context. Per-agent mutex is the smallest correct fix. `withCwdMutex` already exists and is battle-tested by the memory subsystem.

**Consequences:** Concurrent sends to DIFFERENT agents stay parallel. Concurrent sends to the SAME agent serialize — the second send waits for the first to finish. For a bot, this is the desired behavior (chat is intrinsically sequential per user).

### D20 — `corpus="sessions"` indexes per-run summary markdown

**Decision:** After every `run.wait()` resolves, the SDK writes `.theokit/memory/sessions/<runId>.md` containing: timestamp, agent id, user turn, assistant final text, run status. IndexManager.sync() discovers these files with `source: "sessions"`. `memory_search({ corpus: "sessions" })` filters by that source.

**Rationale:** Matches OpenClaw `corpus` parameter semantics. Per-run summary files (not raw streams) keep the index tractable and the chunks queryable. Past-conversation recall is the differentiator for chat assistants over single-shot tools.

**Consequences:** New write per run (~200-500 bytes typical). Index grows linearly with run count; users with millions of runs would want a retention policy (out-of-scope for v1.0; documented as v1.1 work via Cron + memory pruning).

### D21 — `Agent.resume(agentId)` falls back to disk when the in-memory registry misses

**Decision:** `Agent.resume(id)` first checks the in-memory registry. On miss, it reads `.theokit/agents/registry.json` from the calling process's cwd, validates the entry, rehydrates the agent (recreating `LocalAgent` or `CloudAgent` with the persisted options), restores the in-memory state, and returns the handle.

**Rationale:** Today resume only works in-process. With persistence (D17), the disk has the answer; resume becomes the natural API for "recover after restart". No new method; the existing API gains the capability.

**Consequences:** `Agent.resume` becomes a meaningfully different code path on miss. Validate that the persisted `agentOptions` are still safe to rehydrate (e.g., file paths still exist, MCP servers still reachable). On rehydration failure, throw `UnknownAgentError(code: "agent_rehydration_failed", cause: ...)`.

## Dependency Graph

```
Phase 0 (Agent registry persistence — D17, D21) ─┐
                                                 │
Phase 1 (Session messages persistence — D18) ────┤  (parallel-safe with Phase 0)
                                                 │
Phase 2 (Per-agent send mutex — D19) ────────────┤  (depends on Phase 1: serializes session writes)
                                                 │
Phase 3 (corpus=sessions — D20) ─────────────────┤  (depends on Phase 1: session summaries to index)
                                                 │
                                                 ▼
                                  Phase 4 (Telegram bot example)
                                                 │
                                                 ▼
                                  Phase 5 (Dogfood QA — MANDATORY)
```

- Phase 0 + 1 are independent → parallel.
- Phase 2 depends on Phase 1 (mutex protects the append-session-message call which now writes disk).
- Phase 3 depends on Phase 1 (session summaries are written by the run-complete hook which lives near session storage).
- Phase 4 needs all of 0-3 green.
- Phase 5 is the real-LLM dogfood gate (per `.claude/rules/real-llm-validation.md`).

---

## Phase 0: Agent registry persistence

**Objective:** `Agent.create → kill -9 → restart → Agent.resume(agentId)` works.

### T0.1 — `agent-registry-store.ts` persistence layer

#### Objective
Wrap `agent-registry.ts` with a write-through layer: every mutation writes the full registry to `.theokit/agents/registry.json` via `replaceFileAtomic`. Reads check in-memory first; on miss, lazy-load from disk.

#### Evidence
- `agent-registry.ts:14` — current `Map<string, RegisteredAgent>` is process-local only.
- ADR D8 cron persistence is the proven pattern (JSON + atomic write + per-cwd).

#### Files to edit
```
packages/sdk/src/internal/runtime/agent-registry-store.ts — (NEW) disk read/write layer
packages/sdk/src/internal/runtime/agent-registry.ts — (MODIFY) call store on every mutation
packages/sdk/src/agent.ts — (MODIFY) `Agent.resume` falls back to store on cache miss (D21)
packages/sdk/tests/golden/runtime/agent-registry-persistence.golden.test.ts — (NEW)
packages/sdk/CHANGELOG.md
```

#### Deep file dependency analysis
- `agent-registry-store.ts` is a leaf — imports `node:fs/promises`, `replaceFileAtomic`, `withCwdMutex`. No SDK runtime deps.
- `agent-registry.ts` keeps its in-memory `Map` as cache. Every mutation calls into the store via async post-hook.
- `agent.ts:Agent.resume` checks the Map first; if undefined, awaits a store load before throwing `UnknownAgentError`.
- Downstream: `Cron.run(jobId)` and `runCronJob` already call `Agent.get`/`Agent.resume` — they automatically benefit from persistence.

#### Deep Dives
- **File layout**: `.theokit/agents/registry.json` per cwd. Shape:
  ```json
  {
    "schemaVersion": "1.0",
    "agents": {
      "agent-uuid-1": {
        "agentId": "agent-uuid-1",
        "runtime": "local",
        "name": "...",
        "model": { "id": "..." },
        "createdAt": 1700000000000,
        "lastModified": 1700000000010,
        "archived": false,
        "options": { /* AgentOptions snapshot, secrets stripped per the cloud-config-serializer allow-list */ },
        "cwd": "/path/to/workspace",
        "status": "finished"
      },
      ...
    }
  }
  ```
- **Atomic write**: same `replaceFileAtomic` used by cron + memory. tmp file → fsync → rename.
- **Secret stripping**: registry persists `options` minus apiKey/headers/env (same allow-list as `cloud-config-serializer`). Reuse that helper.
- **Edge case (concurrent processes)**: two SDK processes writing the same `registry.json` could race. Mitigate with `withCwdMutex(.theokit/agents/registry, ...)` per-cwd. Out-of-scope: cross-process consensus (file locks). Documented limitation: "one SDK process per cwd".
- **Rehydration validation (D21)**: on `Agent.resume` miss → read registry → if entry has `cloud: { ... }`, instantiate `CloudAgent`; if `local: { ... }`, instantiate `LocalAgent`. If `options.local.cwd` doesn't exist anymore, throw `UnknownAgentError(code: "agent_rehydration_failed")` with cause.
- **Create-with-existing-id (EC-1 fix)**: `Agent.create({ agentId: "x" })` when "x" already exists in the persisted registry **throws `ConfigurationError(code: "agent_id_already_exists")`**. Forces consumers to use the resume-first pattern. The example pattern:
  ```ts
  try { return await Agent.resume(id); }
  catch (e) {
    if (e instanceof UnknownAgentError) return await Agent.create({ agentId: id, ... });
    throw e;
  }
  ```
  Without this, restart + create silently wipes conversation history.
- **Cross-process write race (EC-10 doc)**: the registry is a single JSON file per cwd. Two SDK processes on the same cwd writing concurrently produce a "last-write-wins" race — one process's mutation may be lost. v1.0 supports **exactly one SDK process per cwd**. Documented in the telegram-bot example README and the `docs.md` Stability section.
- **Pruning**: archived agents (lastModified > 30 days ago) are NOT auto-pruned in v1.0 — the registry just grows. Users can call `Agent.delete(agentId)` to compact.

#### Tasks
1. Create `agent-registry-store.ts`:
   - `loadRegistry(cwd: string): Promise<Record<string, RegisteredAgent>>` — reads JSON from disk; returns `{}` if missing.
   - `saveRegistry(cwd: string, registry: Record<string, RegisteredAgent>): Promise<void>` — writes via `replaceFileAtomic` under `withCwdMutex`.
   - `stripSecretsFromOptions(options: AgentOptions): SerializedAgentOptions` — reuse the serializer allow-list.
2. Modify `agent-registry.ts`:
   - On `registerAgent`, push to in-memory Map AND fire async `saveRegistry` (debounced 100ms to coalesce burst writes).
   - On `updateRegisteredAgent` / `removeRegisteredAgent` → same.
   - On `getRegisteredAgent` cache miss → optionally do a one-shot disk load (lazy hydration).
3. Modify `agent.ts:Agent.resume`:
   - Check in-memory; if hit, return as today.
   - On miss, load registry from cwd (derive from caller or default to `process.cwd()`).
   - If entry exists, rehydrate via `LocalAgent` or `CloudAgent` constructor passing the persisted options + agentId.
   - Validate `options.local.cwd` exists on disk; throw `agent_rehydration_failed` on validation failure.
4. Add 7 golden tests:
   - registry write round-trip
   - resume after process restart (simulated via fresh module load + same cwd)
   - resume failure on stale cwd
   - secrets stripped from persisted registry
   - concurrent registerAgent calls don't tear the file
   - archived flag persists
   - resume rehydrates CloudAgent correctly (fixture mode)
5. CHANGELOG entry.

#### TDD
```
RED:  registry-saved-on-create                  — Agent.create writes registry.json with the agent entry
RED:  registry-loaded-on-resume-after-restart   — fresh module load + Agent.resume returns rehydrated agent
RED:  resume-throws-on-missing-cwd              — persisted options.local.cwd no longer exists → agent_rehydration_failed
RED:  registry-strips-apiKey                    — apiKey field absent from persisted registry.json
RED:  registry-concurrent-writes-no-tear        — 100 parallel Agent.create calls produce valid JSON every time
RED:  registry-archived-flag-persists           — Agent.archive → restart → registry shows archived: true
RED:  cloud-agent-rehydration                   — persisted CloudAgent with theo_test_* key resumes cleanly
RED:  create-throws-when-id-exists (EC-1)       — second Agent.create with same agentId after restart throws ConfigurationError(code: "agent_id_already_exists")
RED:  recovers-from-corrupt-json (EC-4)         — write invalid bytes to registry.json; Agent.create → loadRegistry returns {} + stderr warning; subsequent save overwrites with valid JSON, no throw
RED:  registry-isolated-per-cwd (EC-5)          — Agent.create in cwd /tmp/a + Agent.create in cwd /tmp/b → two separate registry.json files; Agent.resume(id) from the wrong cwd throws unknown_agent
GREEN: Implement store + wire to agent-registry + agent.ts:Agent.resume + create-collision throw
REFACTOR: Extract debounced-save helper
VERIFY: pnpm --filter @usetheo/sdk test tests/golden/runtime/agent-registry-persistence
```

#### Acceptance Criteria
- [ ] `.theokit/agents/registry.json` exists after first `Agent.create`.
- [ ] Killing the Node process and reloading the SDK module + calling `Agent.resume(id)` returns a working agent (not throws).
- [ ] Persisted JSON does NOT contain `apiKey`, MCP headers, or any secret pattern (`sk-*`, `ghp_*`).
- [ ] 7 new tests pass.
- [ ] No regression in `agent-resume.golden.test.ts`.

#### DoD
- [ ] All tasks completed.
- [ ] `pnpm test` green.
- [ ] `pnpm typecheck` green.
- [ ] CHANGELOG entry references D17 + D21.

---

## Phase 1: Session messages persistence

**Objective:** Conversation history survives process restart. Bot remembers what was said.

### T1.1 — `agent-session-store.ts` with per-agent JSONL append-only file

#### Objective
Wrap `agent-session.ts` with disk persistence: `appendSessionMessage` appends to `.theokit/agents/<agentId>/messages.jsonl`; `getSessionMessages` reads from disk (cached for the lifetime of the agent in-memory).

#### Evidence
- `agent-session.ts:18-31` — `SESSIONS = new Map<string, SessionMessage[]>()` is in-memory only.
- Per `local-agent.ts:send`, prior messages are read on every send to construct conversation history for the LLM. Lost messages = lost context.

#### Files to edit
```
packages/sdk/src/internal/runtime/agent-session-store.ts — (NEW) JSONL append/read
packages/sdk/src/internal/runtime/agent-session.ts — (MODIFY) call store on append/get
packages/sdk/tests/golden/runtime/agent-session-persistence.golden.test.ts — (NEW)
packages/sdk/CHANGELOG.md
```

#### Deep file dependency analysis
- `agent-session-store.ts` is a leaf — `node:fs/promises` + JSONL parse helpers.
- `agent-session.ts` keeps in-memory Map cache; the disk file is the durable source.
- `local-agent.ts:send` reads `getSessionMessages` and appends — no change to its surface; persistence is transparent.

#### Deep Dives
- **File layout**: `.theokit/agents/<agentId>/messages.jsonl`. One JSON record per line: `{"role":"user"|"assistant","text":"...","at":timestampMs}`.
- **Append**: `fs.appendFile(path, JSON.stringify(record) + "\n")`. No mutex needed for single-writer-per-agent (Phase 2 guarantees this via the send mutex).
- **Read**: stream + JSON.parse per line. For the typical conversation (under 200 turns) full-load is acceptable. Cache in memory after first read.
- **Compaction**: when the JSONL exceeds 400 lines, write a fresh file keeping only the last 200. Run opportunistically at `appendSessionMessage` time (every 50 appends check size). **(EC-2 fix) Compaction MUST acquire `withCwdMutex("agent-send:" + agentId)` — the same mutex Phase 2 uses for `send()` — so an in-flight append never races a compaction rewrite. Without the mutex, compaction's read+rename window could lose the append.** Code shape:
  ```ts
  await withCwdMutex("agent-send:" + agentId, async () => {
    const lines = await readAllLines(path);
    if (lines.length <= 400) return;
    const trimmed = lines.slice(-200).join("\n") + "\n";
    await replaceFileAtomic(path, trimmed);
  });
  ```
- **Edge case (truncated/malformed line)**: malformed JSON line skipped with stderr warning. Conversation history degrades gracefully.
- **Cap configurability**: `AgentOptions.session?.maxTurns?: number` (default 200). Future v1.x.
- **Per-agent dir**: created lazily on first append. Coexists with `.theokit/agents/registry.json` from Phase 0.

#### Tasks
1. Create `agent-session-store.ts`:
   - `appendToSessionFile(cwd: string, agentId: string, message: SessionMessage): Promise<void>`
   - `readSessionFile(cwd: string, agentId: string): Promise<SessionMessage[]>`
   - `compactSessionFile(cwd: string, agentId: string, maxTurns: number): Promise<void>` — copy-on-write last N turns.
2. Modify `agent-session.ts`:
   - `getSessionMessages(agentId, cwd)` — checks cache; on miss reads file; populates cache.
   - `appendSessionMessage(agentId, message, cwd)` — appends to file AND cache.
   - Trigger compaction every 50 appends.
3. Modify `local-agent.ts:send` to pass `this.workspaceCwd` to the session store calls.
4. Add 6 tests:
   - append-then-restart-reads-history
   - compaction-trims-to-200
   - malformed-line-skipped
   - per-agent-isolation (two agents don't see each other's messages)
   - concurrent-append-from-mutex-doesnt-corrupt-file (after Phase 2)
   - dispose-final-flush
5. CHANGELOG entry.

#### TDD
```
RED:  append-then-read-after-restart           — appendSessionMessage; reload module; getSessionMessages returns the appended turn
RED:  compaction-trims-to-cap                  — 500 appends → file has at most 200 turns
RED:  malformed-line-skipped                   — write a half-line manually; readSessionFile skips it with warning
RED:  per-agent-isolation                      — two agentIds → two files; neither sees the other's turns
RED:  jsonl-format-valid                       — every line is parseable JSON (no half-writes)
RED:  session-survives-after-create-and-resume — Agent.create → send 2 → resume in fresh process → conversation visible
RED:  compaction-during-append-no-loss (EC-2)  — spawn 200 concurrent appendSessionMessage calls that cross the compaction threshold; assert ALL 200 turns are recovered after compaction completes
RED:  persists-text-with-newlines (EC-6)       — appendSessionMessage with text="line1\nline2\t\"quoted\""; restart; getSessionMessages returns text with embedded \n and " intact
RED:  skips-partial-last-line (EC-7)           — write 3 complete JSONL lines + manually truncate to half a 4th line; readSessionFile returns 3 turns + stderr warning, never throws
GREEN: Implement store + wire to agent-session.ts + compaction mutex
REFACTOR: None expected
VERIFY: pnpm test tests/golden/runtime/agent-session-persistence
```

#### Acceptance Criteria
- [ ] `.theokit/agents/<agentId>/messages.jsonl` written on first send.
- [ ] Process restart + `Agent.resume(id)` + `getSessionMessages(id)` returns the full history.
- [ ] Compaction caps file at 200 turns by default.
- [ ] No regression in `agent-resume.golden.test.ts`.

#### DoD
- [ ] All tasks completed.
- [ ] `pnpm test` green.
- [ ] `pnpm typecheck` green.

---

## Phase 2: Per-agent send mutex (concurrency safety)

**Objective:** Two webhooks for the same chat-id can't corrupt conversation order.

### T2.1 — `withCwdMutex("agent-send:" + agentId)` around `LocalAgent.send`

#### Objective
Guarantee that `agent.send()` runs serially per agentId. Concurrent calls queue; conversation history stays linear.

#### Evidence
- `local-agent.ts:send` mutates `priorMessages` then `appendSessionMessage` then `dispatchRun`. Interleaved calls produce: user-A's question, user-B's question, A's answer, B's answer — but the LLM saw A's question + B's incomplete state.
- `withCwdMutex` already exists at `packages/sdk/src/internal/memory/cwd-mutex.ts`.

#### Files to edit
```
packages/sdk/src/internal/runtime/local-agent.ts — (MODIFY) wrap send body in withCwdMutex
packages/sdk/src/internal/runtime/cloud-agent.ts — (MODIFY) same wrap
packages/sdk/tests/golden/agent/concurrent-send.golden.test.ts — (NEW)
packages/sdk/CHANGELOG.md
```

#### Deep file dependency analysis
- `local-agent.ts:send` body wraps in `withCwdMutex` keyed by `agent-send:${agentId}`. The mutex is keyed by string; existing memory mutex calls use `cwd`-based keys; no collision.
- `cloud-agent.ts:send` same wrap. Cloud-side concurrent sends to PaaS still need to be serialized client-side because the SDK appends session messages locally before the HTTP call.

#### Deep Dives
- **Key**: `agent-send:${agentId}`. Distinct from memory mutex keys (which are cwd-based).
- **Lock granularity**: per-agent. Different agents' sends remain parallel.
- **Cancellation**: in-flight `agent.send()` cancel still works; the mutex releases when the function returns (even on throw).
- **Edge case (long-running send blocking new ones)**: documented behavior. Bots typically want this — one user's send doesn't drop the next.
- **Edge case (deadlock)**: impossible because the mutex is acquired and released within a single async call; no nested mutex acquisitions on the same key.

#### Tasks
1. Modify `LocalAgent.send` to wrap body in `withCwdMutex("agent-send:" + this.agentId, async () => { ... })`.
2. Modify `CloudAgent.send` same way.
3. Add 4 tests:
   - two-concurrent-sends-serialize: spawn 2 send() promises with different texts; assert session history has them in the order they completed, not interleaved.
   - different-agents-stay-parallel: send to A and B concurrently; assert both started within 10ms of each other.
   - cancel-mid-send-releases-mutex: cancel send A; send B should proceed immediately.
   - dispose-while-send-pending: dispose triggered with pending send; assert send completes (or throws cleanly) before dispose returns.
4. CHANGELOG entry.

#### TDD
```
RED:  two-concurrent-sends-serialize          — send A + send B concurrently; appendSessionMessage records appear in completion order, not interleaved mid-turn
RED:  different-agents-stay-parallel          — sendA started + sendB started both within 50ms of trigger
RED:  cancel-releases-mutex                   — cancel send A; send B starts within 100ms
RED:  dispose-with-pending-send-is-safe       — dispose during in-flight send; either completes or throws AgentDisposed
RED:  subagent-send-no-deadlock (EC-8)        — parent agent A's send invokes subagent B (distinct agentId); B.send acquires its own `agent-send:B` mutex; both complete without deadlock. Asserts mutexes are per-agentId, not global.
GREEN: Wrap with withCwdMutex on both agent runtimes
REFACTOR: None
VERIFY: pnpm test tests/golden/agent/concurrent-send
```

#### Acceptance Criteria
- [ ] 4 new tests pass.
- [ ] No regression in any other test (target: 280+ total).
- [ ] `agent.send()` performance for non-concurrent case unchanged (mutex acquire+release is microseconds).

#### DoD
- [ ] All tasks completed.
- [ ] `pnpm test` green.

---

## Phase 3: `corpus="sessions"` memory recall

**Objective:** Past conversations searchable. "What did we talk about Vitest last week?" works.

### T3.1 — Per-run session summary + IndexManager source

#### Objective
After every `run.wait()`, write a markdown summary to `.theokit/memory/sessions/<runId>.md`. IndexManager.sync() discovers them with `source: "sessions"`. `memory_search({ corpus: "sessions" })` filters by source.

#### Evidence
- `memory_search` tool already declares `corpus: "memory" | "sessions" | "wiki" | "all"` (per ADR D5). The `sessions` branch returns empty today.
- `wiki-loader.ts` is the working pattern for a new corpus source — adapt for sessions.

#### Files to edit
```
packages/sdk/src/internal/memory/session-summary-writer.ts — (NEW) writes .theokit/memory/sessions/<runId>.md
packages/sdk/src/internal/memory/session-loader.ts — (NEW) IndexManager sources `.theokit/memory/sessions/*.md` with source="sessions"
packages/sdk/src/internal/memory/index-manager.ts — (MODIFY) sync() reads sessions directory like it reads wiki
packages/sdk/src/internal/memory/tools.ts — (MODIFY) memory_search filter by source handles "sessions"
packages/sdk/src/internal/runtime/local-agent.ts — (MODIFY) attachPostRunHook writes session summary
packages/sdk/tests/golden/memory/sessions-corpus.golden.test.ts — (NEW)
packages/sdk/CHANGELOG.md
```

#### Deep file dependency analysis
- `session-summary-writer.ts` is a leaf — `replaceFileAtomic` + markdown formatter.
- `session-loader.ts` mirrors `wiki-loader.ts:discoverWikiFiles`.
- `index-manager.ts:sync` adds a third file source (memory + wiki + sessions).
- `tools.ts:createMemorySearchTool` — the `corpus` filter already routes; just needs the sessions branch wired.
- `local-agent.ts:attachPostRunHook` already exists for post-run side-effects (memory write); adding session summary write is one more side-effect.

#### Deep Dives
- **Summary format** (`<runId>.md`):
  ```markdown
  ---
  runId: run-abc-123
  agentId: agent-xyz
  at: 2026-05-16T14:32:00Z
  status: finished
  ---
  ## User
  What's the magic-number?

  ## Assistant
  The magic-number for this workspace is 8675309.
  ```
- **Indexing**: existing `chunkMarkdown` handles the format. Each session file becomes 1-2 chunks (user + assistant). Embedded if embedding provider configured.
- **Search filter**: `tools.ts` already passes `sources` filter to `IndexManager.search`. Sessions source value is `"sessions"`.
- **Edge case (very long assistant response)**: summary file truncates to first 2000 chars per turn. Full transcript stays in `messages.jsonl` (Phase 1); the index summary is for recall, not transcript reconstruction.
- **Privacy**: same `redactSecrets` from memory subsystem applied before writing summaries. `sk-*` / `ghp_*` patterns stripped.
- **Status filter (EC-9 fix)**: ONLY `run.status === "finished"` triggers a session summary write. Cancelled, errored, or timed-out runs do NOT produce a session summary. Recall corpus would otherwise return fragments of failed conversations as valid context.
- **Sync timing (EC-3 fix)**: `writeSessionSummary` triggers `IndexManager.sync()` in background (fire-and-forget) immediately after the markdown write. Sync failures emit a stderr warning but never block the post-run hook. This guarantees `memory_search({ corpus: "sessions" })` sees the newly written summary on the NEXT call — no ambiguous lazy trigger. Code shape:
  ```ts
  await writeSessionSummary(...);
  void this.memoryIndex?.sync().catch((cause) => {
    process.stderr.write(`[theokit-sdk] session index sync failed: ${cause.message}\n`);
  });
  ```
- **Retention**: out-of-scope for v1.0. Users with millions of runs can clean via cron + custom pruning script. Documented as v1.1 work.

#### Tasks
1. Create `session-summary-writer.ts`:
   - `writeSessionSummary({ cwd, runId, agentId, userText, assistantText, status, at }): Promise<void>`
   - Truncate texts > 2000 chars
   - Apply `redactSecrets`
   - Write via `replaceFileAtomic`
2. Create `session-loader.ts`:
   - `discoverSessionFiles(cwd): Promise<MemoryFileEntry[]>` — same shape as wiki-loader.
3. Modify `index-manager.ts:sync()`:
   - Add sessions directory read after wiki.
4. Modify `tools.ts:createMemorySearchTool`:
   - When `corpus === "sessions"`, filter `IndexManager.search` results by `source === "sessions"`.
5. Modify `local-agent.ts:attachPostRunHook`:
   - On `run.wait()` resolve with `status: "finished"`, call `writeSessionSummary`.
6. Add 5 tests:
   - session-summary-written-on-run-complete
   - memory_search-corpus-sessions-returns-hits
   - memory_search-corpus-memory-excludes-sessions (don't leak)
   - secrets-redacted-in-summary
   - corrupt-session-file-skipped (malformed frontmatter doesn't crash sync)
7. CHANGELOG entry.

#### TDD
```
RED:  session-summary-written-on-run-finish         — agent.send → run.wait → .theokit/memory/sessions/<runId>.md exists with user/assistant
RED:  memory-search-corpus-sessions-returns-hit     — pre-seed 3 session files; memory_search({ corpus: "sessions", query: ... }) returns ranked hits
RED:  memory-search-corpus-memory-excludes-sessions — memory_search({ corpus: "memory" }) does NOT return session hits
RED:  session-summary-redacts-secrets               — user message contains "sk-real-token"; summary file shows "***" instead
RED:  malformed-session-file-skipped                — drop a corrupt .md file under sessions/; sync skips it with warning
RED:  session-searchable-after-run-wait (EC-3)      — run.wait() resolves with status:"finished" → memory_search({ corpus:"sessions" }) on the SAME agent returns the just-finished run's content (sync triggered automatically)
RED:  no-summary-on-cancelled-run (EC-9)            — run.cancel() before completion → .theokit/memory/sessions/<runId>.md does NOT exist; memory_search returns no hits for that run
RED:  no-summary-on-errored-run (EC-9)              — stub LLM 500 → run.status="error" → no session file written
GREEN: Implement writer + loader + IndexManager wiring + tools filter + post-run hook + status filter + sync trigger
REFACTOR: Extract shared "loader" pattern (wiki + sessions could share)
VERIFY: pnpm test tests/golden/memory/sessions-corpus
```

#### Acceptance Criteria
- [ ] After 5 sends + waits on an agent, `.theokit/memory/sessions/` contains 5 files.
- [ ] `memory_search({ corpus: "sessions", query: "magic-number" })` returns hits with `source: "sessions"`.
- [ ] `memory_search({ corpus: "memory" })` excludes session hits.
- [ ] Secrets redacted in summary files.
- [ ] 5 new tests pass.

#### DoD
- [ ] All tasks completed.
- [ ] `pnpm test` green.
- [ ] `pnpm typecheck` green.

---

## Phase 4: Telegram bot reference example

**Objective:** Real, deployable example proving the entire chat assistant pattern works.

### T4.1 — `examples/telegram-bot/`

#### Objective
~150 LoC `grammy` bot. Per-chat agent via `Agent.resume`. Memory enabled with `userId: String(chatId)`. Active recall. Survives restart.

#### Evidence
- All competitors that target chat (openclaw, hermes-agent) ship channel adapters. Without an example, SDK consumers do this from scratch.
- Phase 0-3 land the infrastructure; this example IS the proof.

#### Files to edit
```
examples/telegram-bot/package.json — (NEW)
examples/telegram-bot/tsconfig.json — (NEW)
examples/telegram-bot/.env.example — (NEW)
examples/telegram-bot/.gitignore — (NEW)
examples/telegram-bot/src/index.ts — (NEW) ~150 LoC bot
examples/telegram-bot/README.md — (NEW) setup + restart proof
examples/README.md — add entry to inventory
```

#### Deep file dependency analysis
- Standalone example, links to `@usetheo/sdk` via `file:../../packages/sdk` (existing pattern).
- New devDep: `grammy` (Telegram bot framework, zero deps itself, modern, TS-native).

#### Deep Dives
- **Persistence:** uses Phase 0's persistent agent registry. Restart pattern:
  ```ts
  async function getAgent(chatId: number) {
    const agentId = `tg-${chatId}`;
    try {
      return await Agent.resume(agentId);
    } catch (e) {
      if (e instanceof UnknownAgentError) {
        return await Agent.create({
          agentId,
          apiKey: process.env.THEOKIT_API_KEY,
          model: { id: "google/gemini-2.0-flash-001" },
          local: { cwd: process.cwd() },
          memory: {
            enabled: true,
            namespace: "telegram-bot",
            scope: "user",
            userId: String(chatId),
            activeRecall: { enabled: true, queryMode: "recent" },
          },
          systemPrompt: "You are a personal assistant on Telegram. Be concise.",
        });
      }
      throw e;
    }
  }
  ```
- **Concurrency:** Phase 2's mutex makes this safe even with rapid-fire user messages.
- **Cron daemon:** the bot's process can also `Cron.start()` for scheduled dreaming sweeps (e.g., `0 3 * * *` triggers `Memory.runDreamingSweep` per active chat).
- **Voice (out of scope):** README points at Whisper/ElevenLabs integration; not coded.
- **EC-10 doc — single-process-per-cwd:** README MUST include a warning callout: **"Run exactly ONE SDK process per cwd. Co-locating a bot + a standalone cron worker on the same workspace will race on `.theokit/agents/registry.json` and lose mutations. If you need cron + bot, use `Cron.start()` from inside the SAME bot process."**
- **EC-11 doc — Telegram group chats:** README MUST include: **"For group chats, `ctx.chat.id` is the GROUP id, not the user. Setting `memory.userId: String(ctx.chat.id)` mixes all group members' facts into one namespace. Use `memory.userId: String(ctx.from.id)` for per-user memory in groups. The default `chatId` works only for 1:1 DMs."** Example snippet:
  ```ts
  const userId = ctx.chat.type === "private" ? String(ctx.chat.id) : String(ctx.from?.id ?? "anonymous");
  ```

#### Tasks
1. Scaffold `examples/telegram-bot/` with the standard 6 files.
2. README explicitly documents: (a) get a Telegram bot token from @BotFather, (b) `cp .env.example .env`, (c) `pnpm dev`, (d) chat with bot, (e) restart the process, (f) chat again — bot remembers.
3. Wire `Agent.resume` first, fall back to `Agent.create` on `UnknownAgentError`.
4. Use `Memory` namespace correctly (`namespace: "telegram-bot"`, `scope: "user"`, `userId: chatId`).
5. Demo `memory_search({ corpus: "sessions" })` via a `/recall` command.
6. Update `examples/README.md` with the entry.

#### TDD
```
RED:  bot-builds-typescript                — `pnpm --filter ./examples/telegram-bot build` succeeds (no actual bot run)
RED:  bot-agent-created-on-first-message   — unit test simulating ctx.message: assert Agent.create called with tg-<id>
RED:  bot-agent-resumed-on-subsequent       — second message with same chatId calls Agent.resume, not create
GREEN: Implement bot
REFACTOR: None expected
VERIFY: example builds + README walkthrough runs
```

#### Acceptance Criteria
- [ ] `examples/telegram-bot/` builds cleanly.
- [ ] README documents the restart-proof pattern.
- [ ] `examples/README.md` lists it as "Real LLM + Real Telegram bot — survives restart".

#### DoD
- [ ] Example builds.
- [ ] User can clone, set token, run, chat, restart, chat again, see memory.

---

## Phase 5: Dogfood QA (MANDATORY)

> Per `.claude/rules/real-llm-validation.md` — REAL LLM required, fixture mode does not count.

**Objective:** Validate the full chat assistant pattern end-to-end with a real Telegram bot.

### Execution

1. `nvm use` (Node 22.12+).
2. Set `THEOKIT_API_KEY` + `OPENROUTER_API_KEY` + `TELEGRAM_BOT_TOKEN` in `examples/telegram-bot/.env`.
3. `pnpm install && pnpm dev` in the example dir.
4. From your phone, message the bot:
   - "Remember: my favorite framework is Vitest."
   - Wait for reply ✓
   - "What's my favorite framework?" → expect "Vitest" via memory recall.
5. Kill the bot process (`Ctrl-C` or `kill -9`).
6. Restart: `pnpm dev`.
7. Message: "Remind me of my favorite framework." → expect "Vitest" — PROVES `Agent.resume` + persistent session messages.
8. Wait 1 minute, send 10 messages in burst (concurrency proof for Phase 2 mutex).
9. Send `/recall vitest` → expect session-search returns past mentions.
10. Inspect filesystem:
    - `.theokit/agents/registry.json` exists with 1 agent entry (per chat).
    - `.theokit/agents/tg-<chatId>/messages.jsonl` exists with the conversation.
    - `.theokit/memory/MEMORY.md` has the persisted preference.
    - `.theokit/memory/sessions/<runId>.md` exists for each run.

### Acceptance Criteria

- [ ] Bot responds to first message (real LLM).
- [ ] Memory recall works in the same process.
- [ ] **Bot resume after restart preserves conversation** (THE marquee test).
- [ ] Concurrent messages don't corrupt history (assert via reading `messages.jsonl` after burst).
- [ ] `/recall <query>` returns session hits from past runs.

### If Dogfood Fails

1. Bisect: which Phase introduced the regression?
2. Fix and re-run.
3. NEVER downgrade to fixture mode to make it pass.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Agent registry in-memory only — restart wipes agents | T0.1 (D17/D21) | JSON persist + lazy load + resume rehydration |
| 2 | Session messages in-memory only — restart wipes history | T1.1 (D18) | JSONL append per-agent + compaction |
| 3 | Concurrent send corrupts conversation order | T2.1 (D19) | Per-agent `withCwdMutex` |
| 4 | `corpus="sessions"` declared but not implemented | T3.1 (D20) | Per-run summary writer + IndexManager source + tools filter |
| 5 | No reference example for chat assistant pattern | T4.1 | `examples/telegram-bot/` end-to-end |
| 6 | Persisted registry must not leak secrets | T0.1 (allow-list) | Reuse cloud-config-serializer allow-list |
| 7 | Multi-agent isolation (each user gets own agent + memory) | T0.1 + T1.1 | Per-agent dir + namespace/userId already supports it |
| 8 | Past-conversation recall | T3.1 | `memory_search({ corpus: "sessions" })` |
| 9 | Dogfood proves the pattern works under real conditions | T4.1 + Phase 5 | Real Telegram bot + restart-proof test |
| 10 | (EC-1) `Agent.create` with existing agentId undefined | T0.1 | Throws `agent_id_already_exists`; forces resume-first pattern |
| 11 | (EC-2) Compaction race with append within process | T1.1 | Compaction holds `agent-send:<id>` mutex (same as Phase 2) |
| 12 | (EC-3) `corpus="sessions"` recall ambiguous when sync runs | T3.1 | `writeSessionSummary` triggers `IndexManager.sync()` in background |
| 13 | (EC-4) Corrupt registry.json crashes load | T0.1 | Fall back to `{}` + stderr warning + recover on next save |
| 14 | (EC-5) Cross-cwd agent leak | T0.1 | Per-cwd registry isolation enforced by file path |
| 15 | (EC-6) Newlines in message text break JSONL | T1.1 | `JSON.stringify` writer + `JSON.parse` per-line reader |
| 16 | (EC-7) Half-written JSONL line on crash | T1.1 | Reader skips with warning, never throws |
| 17 | (EC-8) Subagent send deadlocks parent's mutex | T2.1 | Per-agentId mutex keys (no global lock) |
| 18 | (EC-9) Failed runs pollute corpus=sessions | T3.1 | Only `status:"finished"` writes summary |
| 19 | (EC-10) Cross-process registry write race | T0.1 + T4.1 | Documented as "one SDK process per cwd" in plan + README |
| 20 | (EC-11) Telegram group memory mixing | T4.1 | README documents `ctx.from.id` for groups |

**Coverage: 20/20 gaps covered (100%)**

## Global Definition of Done

- [ ] All 5 phases completed.
- [ ] `pnpm test` green (target: 280+ tests after additions; currently 250).
- [ ] `pnpm validate` green (publint + attw + quality).
- [ ] `pnpm quality:dead` (full knip) green.
- [ ] 4 new ADRs in `.claude/knowledge-base/adrs/` (D17-D20; D21 documented in D17).
- [ ] CLAUDE.md ADR table updated.
- [ ] CHANGELOG `[Unreleased]` entries for each phase.
- [ ] `examples/telegram-bot/` builds + dogfooded against a real bot token.
- [ ] No regression in existing 5 memory dogfood examples.
- [ ] Persistence files documented in `docs.md` Stability section.

## Final Phase: Dogfood QA (MANDATORY)

Specified above as Phase 5. Re-states for ceremonial completeness — the plan is NOT done until a real Telegram bot survives a real `kill -9`.

### Acceptance Criteria
- [ ] Real Telegram bot deployed.
- [ ] Conversation persists across restart.
- [ ] Concurrent messages serialize correctly.
- [ ] `/recall` command returns session search results.
- [ ] Zero CRITICAL issues introduced.

### If Dogfood Fails
1. Bisect.
2. Fix.
3. Re-run — NEVER fixture mode shortcut (real-llm-validation rule).
