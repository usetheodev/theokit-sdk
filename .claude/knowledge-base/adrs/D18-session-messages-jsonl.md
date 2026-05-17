---
id: D18
status: Decided
date: 2026-05-16
plan: chat-assistant-readiness
---

# D18 — Session messages persist to per-agent JSONL append-only file

## Context
`getSessionMessages / appendSessionMessage` in `agent-session.ts` were an in-memory `Map<agentId, SessionMessage[]>`. On restart the Map was empty; even if `Agent.resume` restored the agent registration, the LLM saw the user as a stranger because the conversation history was gone.

## Decision
Each agent owns a JSONL file at `<cwd>/.theokit/agents/<agentId>/messages.jsonl`. Each turn appends a single line: `{"role": "user" | "assistant", "text": "...", "at": <timestampMs>}`. Reads stream the file from disk. Default cap: last 200 turns retained; opportunistic compaction triggers when the file exceeds 400 lines.

## Rationale
- Conversation history is naturally append-only — JSONL is append-friendly (`fs.appendFile`), failure-mode-safe (a partial last write loses at most one record), and trivially streamable.
- Per-agent file isolates concurrent reads/writes — no global lock contention across agents.
- 200 turns ≈ 100 user + 100 assistant: well above any single conversation, well below disk-hog territory.

## Consequences
- `.theokit/agents/<agentId>/` directory created lazily on first send.
- Compaction is opportunistic (runs every 50 appends after threshold + once during `dispose()`).
- EC-2 race-fix: appends and compaction chain through a single per-`(agentId, cwd)` promise queue, so the compaction's read+rename window can never overlap a concurrent append.
- EC-6: `JSON.stringify` on append + `JSON.parse` per-line on read preserve newlines, tabs, and embedded quotes across restart.
- EC-7: malformed last line (e.g., from a power-loss mid-write) is skipped with a stderr warning; the reader never throws.
- `LocalAgent.initialize()` calls `hydrateSession(agentId, cwd)` to load disk into the in-memory cache before the first send.

## Alternatives Considered
- **SQLite per agent** — rejected; same trade-offs as cron (ADR D8). JSONL streams better and is git-friendly.
- **Single workspace-wide JSONL** — rejected; cross-agent locking would serialize unrelated chats.
- **No persistence (in-memory only)** — rejected; this IS the gap.
