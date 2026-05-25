# Deep Dive — Session + Registry (BASELINE 2026-05-25)

## `agent-session-store.ts` (current; Phase 1 target)

Path: `internal/runtime/agent-session-store.ts` (129 lines)

Functions:
- `sessionFilePath(cwd, agentId)` — sanitize + safePathJoin → `<cwd>/.theokit/agents/<safe>/messages.jsonl`
- `appendToSessionFile(cwd, agentId, message)` — mkdir + appendFile + redact
- `readSessionFile(cwd, agentId)` — readFile + line-by-line parse, skip malformed
- `compactSessionFile(cwd, agentId, maxTurns)` — truncate to last N lines via atomic write

**Direct fs imports:** `node:fs/promises` (mkdir, readFile, appendFile). No abstraction.

## `agent-session.ts` (Phase 1 target)

Path: `internal/runtime/agent-session.ts` (140 lines)

In-memory cache + chained queue:
- `sessions: Map<agentId, SessionMessage[]>` — in-process state
- `hydratedKeys: Set<string>` — idempotent hydration per (agentId, cwd)
- `pendingAppends: Map<string, Promise<void>>` — chained queue
- `appendCounts: Map<string, number>` — compaction trigger counter

Public functions:
- `appendSessionMessage(agentId, message, cwd?)` — push to cache, chained disk write fire-and-forget
- `getSessionMessages(agentId)` — sync read from cache
- `hydrateSession(agentId, cwd)` — first-time disk read merge
- `flushSessionWrites()` — test/dispose await all pendingAppends
- `compactSession(agentId, cwd)` — force-trigger compaction
- `clearSession(agentId)` / `clearAllSessions()` — test helpers

**Disk persistence is fire-and-forget** chained per (agent,cwd). Compaction runs every 50 appends.

## `agent-registry.ts` (Phase 2 affects — different concept)

Path: `internal/runtime/agent-registry.ts` (186 lines)

This is the **metadata registry**, NOT the live-agent cache that Phase 2 adds.

Holds:
- `agents: Map<agentId, RegisteredAgent>` — metadata (id, runtime, options, cwd, createdAt, lastModified, archived)
- `hydratedCwds: Set<string>` — idempotent hydration per cwd
- `pendingSaves: Map<cwd, Promise<void>>` — coalesced write-through
- `dirtyCwds: Set<string>` — re-loop guard

**No eviction.** `agents` Map is monotonic until `clearAgentRegistry()`.

Phase 2 creates a NEW module `live-agent-registry.ts` for in-memory caching of live `SDKAgent` instances — orthogonal concept.

## `AgentRunError` today (Phase 3 affects)

Path: `errors.ts:207-231`

Current shape:
```ts
class AgentRunError extends TheokitAgentError {
  name: 'AgentRunError'
  provider?: string
  raw?: string
  // constructor: { message, code: string, provider?, raw?, cause?, metadata? }
}
```

`code: string` is opaque (no union restriction). `isRetryable: false` always hard-coded in the AgentRunError super call. `metadata.retryAfter` is seconds (per D67 mapper convention).

Phase 3 tightens `code` to `AgentRunErrorCode` (finite enum), adds `retriable`/`retryAfterMs`/`providerError` as computed getters, plus `requestId`/`conversationId` fields.

## `real-local-run.ts` (Phase 4 affects)

Path: `internal/runtime/real-local-run.ts` (long file)

Contains the main send loop. Today receives `SendOptions` but **does not extract `.signal`** for downstream `streamChat(client, request, signal, ...)` call. The signal is consumed only inside `pre_user_send` adapter hook dispatch.

Phase 4 wires `SendOptions.signal` → `streamChat` call (the infrastructure already accepts it; just unwired in production path).
