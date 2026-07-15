---
slug: native-session-format
milestone_id: SE40
created_at: 2026-07-15
goal: The native FS session store IS the Claude-shaped .jsonl (WRITE+READ/--continue for text+tool, append-only compaction); configurable baseDir; remove ClaudeCodeTranscriptWriter.
---

# Plan — SE40 core (native Claude-shaped session format + --continue)

## Baseline (from the discover blueprint — evidence-backed)

- WRITE: rich `LlmMessage[]` lives in `LoopContext.messages` but is flattened to `StoredMessage{role,
  content:string}` at `appendSessionMessage` (`agent-session.ts:117`). Native write needs the rich turn.
- READ: hydration seam at `hydrateSession → readPersistedForCache → adapter.getMessages → foldStoredToSession`
  (lossy). Plug a DAG reader there.
- COMPACTION: today `compactSessionFile → rewriteLockedSession` REWRITES the file (breaks the DAG). Must
  become append-only `compact_boundary` + continuation prefix (Claude semantics).
- Reader algorithm + record schema: fully specified in the blueprint (claude-code-log dag.py/models.py).

## Tasks (TDD each)

### T1 — Native transcript format module (re-home SE39 mapper, drop ClaudeCode naming)
A `session-transcript.ts` that: mints `uuid`(random)/`parentUuid` per turn; maps a rich turn
(text/thinking/tool_use{id}/tool_result{toolUseId}) → a Claude record with `message.{id,model,role,
content[]}` + envelope; encodes the path `<baseDir>/projects/<encodeProjectDir(cwd)>/<sessionId>.jsonl`.
Pure + append-friendly (one record per line, stable parent chain across appends).
- TDD: record shape; pairing (tool_use_id == tool_use.id); parentUuid chain across successive appends;
  redaction (reuse SE39 `redactValue`/`red`); path encoding.

### T2 — Native FS store writes the format + threads the rich turn
The default FS session store persists rich turns as Claude records (not flattened). Thread the rich
turn from the loop persist site (`appendSessionMessage`) — `StoredMessage` grows an optional structured
payload OR a new `appendTurn` path carries `{text, toolCalls, toolResults, thinking}`. Write to the
claude path; `baseDir` from config (default `~/.theokit`, settable `~/.claude`).
- TDD: a real agent send (fixture) produces a claude-shaped `.jsonl` at the encoded path; tool session
  keeps paired blocks; baseDir override respected.

### T3 — DAG-reconstruction reader → resume
`readSessionTranscript(path)`: parse lines → build uuid index → leaf = uuid never a parentUuid →
walk parentUuid to root (cycle-break) → dedup earliest-session → rebuild `LlmMessage[]` (assistant with
tool_use parts, user with tool_result parts). Plug into `hydrateSession`/`readPersistedForCache` so
resume seeds the rebuilt history. Reads OUR files AND a real Claude-Code-CLI `.jsonl`.
- TDD: write→read round-trips the LlmMessage[]; a hand-crafted real-shaped `.jsonl` (fork + dedup)
  reconstructs the right single path; `Agent.resume()` continues coherently (fixture + real-LLM).

### T4 — Append-only compaction (compact_boundary)
Replace `rewriteLockedSession` compaction with: append a `system` `compact_boundary` record (new root,
`parentUuid:null`, `compactMetadata{preTokens,trigger}`) + a `user` continuation whose text starts with
the exact `"This session is being continued…"` prefix. Never drop prior records. Resume replays from the
boundary root.
- TDD: compaction appends (does not shrink the file line-set destructively); boundary parses through
  claude-code-log; resume-after-compact continuity holds.

### T5 — Remove ClaudeCodeTranscriptWriter + config + docs
Delete `ClaudeCodeTranscriptWriter` + its export (no `ClaudeCode*` symbol). `baseDir` config surface.
`docs.md`: native format, baseDir config, `~/.claude` interop mode. CHANGELOG (breaking, v4.0).
- TDD: no `ClaudeCode` export; knip clean; the removed symbol is gone from the barrel.

### T6 — Acceptance
Round-trip through the REAL claude-code-log parser (reuse SE39 gate) + real-LLM write→read→continue on
OpenRouter (a session persisted, resumed, and continued coherently) + fork/dedup reader tests.

## Drawbacks & Risks
1. Format instability becomes native — mitigated: default `~/.theokit` isolated; round-trip gate on write;
   version-detect on read; `~/.claude` is opt-in.
2. Compaction ⇄ append-only DAG — mitigated: mirror Claude's compact_boundary; dedicated tests.
3. Breaking on-disk/API change (v4.0) — StoredMessage/adapter shape + storage layout change; migration
   importer is SE43 (deferred). Consumers of the old layout break at v4.0 (documented).

## Unresolved questions
(none blocking core — the reader algorithm + schema are pinned by the discover. Extended-thinking
signature is out of scope → SE42/#122.)

## Prior art
`knowledge-base/discoveries/blueprints/native-session-format-blueprint.md` +
`knowledge-base/references/claude-code-log` (dag.py/models.py — the reference reader).

## Resume pointer (checkpoint 2026-07-15 — T1 done)

**Done:** T1 core `session-transcript.ts` (builders + `reconstructMessages` DAG reader) — committed
`2742d3b4`, 6 tests green.

**Resume at T2 (WRITE native into the FS store).** The rich turn (`LlmMessage[]`) is NOT at the persist
site: `appendSessionMessage(agentId, {role, text}, …)` (`internal/runtime/session/agent-session.ts:100`)
already flattens to `StoredMessage{role, content:string}`. Two candidate approaches (owner to pick — the
low-churn onStep-driven one was offered):
1. **Rewrite path (full virada):** carry a rich turn from `local-agent-send.ts` → `appendSessionMessage`
   → a structured `StoredMessage`/`appendTurn` → FS store writes via `SessionTranscript` to
   `<baseDir>/projects/<encodeProjectDir(cwd)>/<safeSessionId(sessionId)>.jsonl`.
2. **onStep-driven (lower churn):** the FS store owns a `SessionTranscript` per conversation, fed by the
   loop's `onStep` (already carries text/thinking/toolCall/toolResult after the SE39 fix) + the user
   message; resume reads via `reconstructMessages`. No `StoredMessage` contract rewrite.

Then T3 (resume wiring at `hydrateSession→readPersistedForCache`), T4 (append-only compaction replacing
`rewriteLockedSession`), T5 (remove `ClaudeCodeTranscriptWriter`), T6 (round-trip + real-LLM
write→read→continue). Reuse the SE39 round-trip gate (`validate_claude_code_jsonl.py`).
