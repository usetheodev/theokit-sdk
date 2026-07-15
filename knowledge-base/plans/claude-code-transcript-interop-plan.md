---
slug: claude-code-transcript-interop
milestone_id: SE39
created_at: 2026-07-15
goal: Emit @theokit/sdk sessions as Claude-Code-compatible .jsonl (read-only writer; --continue is SE40).
---

# Plan — SE39 Claude Code transcript interop (read-only writer)

## Baseline (discover, evidence-backed)

- **Tap point:** `SendOptions.onStep` (`types/run.ts:370`) → `ConversationStep` union
  (`types/conversation.ts:71-75`): `assistantMessage{text}`, `thinkingMessage{text,thinkingDurationMs?}`,
  `toolCall{callId,name,args}`, `toolResult{callId,name,result,isError}`. The `callId` is the LLM
  tool_use id (`loop.ts:224` `call.id`, `loop.ts:231` `result.toolUseId ?? call.id`) → stable pairing.
  `Run.stream()` is NOT used: its `SDKToolUseMessage.call_id` comes from a separate `generateCallId()`
  (`tool-dispatch.ts:78`) and would break tool_use↔tool_result pairing.
- **Target schema (claude-code-log models.py, the strict consumer):** each record needs `type`, `uuid`,
  `parentUuid`, `isSidechain`, `userType`, `cwd`, `sessionId`, `version`, `timestamp`, `message`.
  user `message={role,content[]}`; assistant `message={id,type:"message",role,model,content[]}`.
  Content blocks: `text{text}`, `thinking{thinking,signature?}`, `tool_use{id,name,input}`,
  `tool_result{tool_use_id,content,is_error?}`. Pairing: `tool_result.tool_use_id == tool_use.id`.
- **Home:** `./persistence` sub-path (out of the tight main bundle; beside ConversationStorage).

## Tasks

### T1 — Pure mapper (RED first)
`claudeCodeRecords(steps, { userMessage, cwd, sessionId, model, version })` → `ClaudeCodeRecord[]`.
Groups steps into turns: [thinking? + text? + toolCall*] → one assistant record;
[toolResult*] → one user record. Mints `uuid = <sessionId>-<n>`, chains `parentUuid`. Redacts secrets.
- TDD: user record shape; assistant record with text+thinking+tool_use blocks; tool_result user record
  with `tool_use_id` matching the tool_use `id` (ZERO dangling); envelope fields present; empty-session
  edge; a negative case (a toolResult with no preceding toolCall → still valid, no crash).

### T2 — `ClaudeCodeTranscriptWriter.create()` (uniform X.create, SE36)
`create({ cwd?, sessionId?, model?, version?, dir? })` → `{ onStep, records(userMessage),
write(userMessage): Promise<string> }`. Path: `dir ?? ~/.claude/projects/<cwd nonalnum→'-'>/`,
file `<sessionId>.jsonl`. `write` uses the atomic-write/jsonl helpers already in `internal/persistence`.
- TDD: path-encoding (`/a/b` → `-a-b`); write produces a file whose lines each parse as JSON;
  `onStep` accumulation feeds `records`.

### T3 — Round-trip through the REAL consumer (the acceptance gate)
Feed a synthetic tool-calling step sequence → `records` → `.jsonl` → parse with the cloned
`claude-code-log` (python) → assert exit 0 (no Pydantic error) AND the tool_use/tool_result pair is
recognized. This is the DoD's "parses through a real ecosystem parser" gate.

### T4 — Wiring + real-LLM integration
Env-gated real-LLM test: run an agent with a tool, pass `writer.onStep`, `write()`, then parse the file
with claude-code-log. Assert: user+assistant records, ≥1 tool_use with a matching tool_result, no
dangling. Export `ClaudeCodeTranscriptWriter` from `persistence.ts`.

### T5 — docs.md + CHANGELOG
Document under a clearly-labeled "Claude Code transcript interop (best-effort, read-only)" note:
targets an officially-unstable format; `--continue` is SE40. CHANGELOG § Added.

## Drawbacks & Risks
1. **Format instability** — pin `version` to a known-good value; the round-trip test against the real
   parser is the guard; opt-in + additive so a schema break never touches core.
2. **Thinking signature** — SE39 emits `thinking{thinking}` WITHOUT a forged signature (a fake signature
   would be worse); resume-critical signature handling is SE40. Documented.

## Unresolved questions
(none — the schema + tap point are pinned by the discover evidence.)

## Prior art
`knowledge-base/discoveries/blueprints/claude-code-transcript-interop-blueprint.md` +
`knowledge-base/references/{claude-code-log,claude-code-transcripts,claude-code-jsonl-parser}`.
