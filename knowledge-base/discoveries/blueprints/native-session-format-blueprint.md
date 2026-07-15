# Blueprint — SE40 Native Claude-shaped session format + --continue

Deep-research (3 parallel Explore agents, 2026-07-15) over the SDK internals + the cloned
`claude-code-log` (dag.py/models.py/factories — the reference reader). This is the plan seed.

## A. WRITE — the rich data IS lost at the persistence boundary (fixable)

- The loop HAS the rich data: `LoopContext.messages: LlmMessage[]` with `LlmToolCallPart{id}` +
  `LlmToolResultPart{toolUseId}` + text (`loop-context-init.ts:118-149`).
- But persistence FLATTENS it: `appendSessionMessage(agentId, {role, text}, …)`
  (`local-agent-send.ts:167`) → `SessionMessage{role,text}` (`session-types.ts:43`) →
  `StoredMessage{role, content:string, at}` (`conversation-storage.ts:25`) →
  `<cwd>/.theokit/agents/<id>/messages.jsonl` (`agent-session-store.ts:43,149`).
- **SE40 plug:** thread the rich `LlmMessage[]` (already in `LoopContext`) through to a new
  claude-shaped writer at the persist site; `StoredMessage`/the adapter grows a structured variant.

## B. READ / --continue — there is a hydration seam (fixable)

- `Agent.resume()` (`agent.ts:163`) → `hydrateSession()` (`agent-session.ts:158`) →
  `readPersistedForCache()` (`agent-session.ts:181`) → `adapter.getMessages()` →
  `foldStoredToSession()` (`agent-session.ts:203`, **lossy** — flattens tool_call/tool_result to text).
- **SE40 plug:** a claude-jsonl reader that walks the `parentUuid` DAG from the leaf → rebuilds
  `LlmMessage[]` with paired tool_use/tool_result → seeds history at `readPersistedForCache`.

## C. COMPACTION — INCOMPATIBLE as-is; must switch to append-only (the key architectural change)

- Today: `compact()` → `compactSessionFile` → `rewriteLockedSession` **REWRITES the file** (keeps last N
  lines) (`agent-session-store.ts:258-289`). This **breaks an append-only DAG** — dropping old records
  orphans `parentUuid` chains.
- Claude Code's model (from `claude-code-log` dag.py + factories): compaction is **NOT truncation**.
  It appends a `system` record `subtype:"compact_boundary"` (a NEW ROOT, `parentUuid:null`, with
  `compactMetadata:{preTokens,trigger}`) — treated as an **expected root** by the reader
  (`dag.py:423-427`). On resume it injects a `user` message whose text starts with the exact prefix
  `"This session is being continued from a previous conversation that ran out of context"`
  (`user_factory.py:383`) → the reader classifies it as the compacted summary. Old records stay.
- **SE40 must replace the rewrite with append-only compact_boundary semantics.**

## D. Reader contract (mirror claude-code-log dag.py)

Leaf = a `uuid` never used as any `parentUuid`. Walk `parent_uuid` back to root with **cycle-break**
(`dag.py:253-268`). **Dedup** duplicate uuids across files → keep the earliest-session entry
(`dag.py:159-171`). `compact_boundary` + `attachment` + `progress` are expected roots. `summary` records
(no uuid/timestamp/sessionId=None) link a title to a tip via `leafUuid` matching a real message uuid.

## E. Minimal required fields (beyond SE39)

Every entry: `type,uuid,parentUuid,sessionId,timestamp`. Assistant `message`: **`id`,`model`**,`role`,
`content[]` (SE39 already emits these). compact_boundary: `subtype`,`compactMetadata{preTokens:int,
trigger:str}`. Absence of `uuid`/`sessionId`/`message.role`/`message.content` breaks reconstruction.

## F. 🔴 BLOCKER (ecosystem problem — REPORTED) — extended-thinking --continue is NOT achievable now

- For `--continue` of an extended-thinking session, the `thinking` block must round-trip WITH its
  provider-issued cryptographic **`signature`** (else `400 "thinking blocks cannot be modified"`,
  upstream anthropics/claude-code#63147).
- **The SDK does NOT capture the signature — only the reasoning TEXT.** `LlmEvent` has
  `{type:"reasoning_delta"; text}` with no signature (`internal/llm/types.ts:122`); the OpenAI/OpenRouter
  delta shape has `reasoning`/`reasoning_content` but **no signature field** (`openai.ts:53`); the
  Anthropic adapter doesn't handle thinking at all. Nothing downstream (`SDKThinkingMessage`,
  `buildThinkingEvent`) carries a signature.
- **Verdict:** capturing the signature needs **provider-layer work** (the provider must expose
  `thinkingBlock.signature` in its stream) — out of reach of a format/persistence milestone.
  Extended-thinking `--continue` must be **CAVEATED/deferred**; text + tool sessions resume fine.

## G. Subagent sidecars — achievable now

`runChildAgent` (`a2a/subagent.ts:249`) gives each subagent run a unique `run.id` but discards it
(result inlined). SE40 can emit `agent-<childRunId>.jsonl` via a callback after `run.wait()` before
`dispose()`. Achievable without provider work.

## Slicing recommendation (discover-informed)

The written SE40 DoD is really 3-4 slices; one of them (extended-thinking resume) is provider-blocked:
- **A (core, 100%-deliverable):** native claude-shaped WRITE (thread rich LlmMessage[]) + READ/--continue
  for text+tool sessions + append-only compaction (compact_boundary + summary prefix) + round-trip +
  real-LLM write→read→continue. Remove ClaudeCodeTranscriptWriter. Configurable baseDir.
- **B (achievable, follow-on):** subagent `agent-*.jsonl` sidecars.
- **C (blocked):** extended-thinking `--continue` — needs provider signature capture. Caveat/defer.
- **D (mechanical):** migration importer old `messages.jsonl` → new.
