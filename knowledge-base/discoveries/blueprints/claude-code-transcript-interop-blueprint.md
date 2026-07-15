# Blueprint — Claude Code transcript interop (SE39)

Distilled from a deep-research pass (2026-07-15) + empirical measurement of a real Claude Code
transcript (`~/.claude/projects/-home-paulo-Projetos-hodor/<uuid>.jsonl`, 7574 records). This is the
prior-art seed for the SE39 `/discover-plan`.

## Storage model (measured + docs-confirmed)

- Path: `~/.claude/projects/<cwd with each non-alphanumeric → '-'>/<session-id>.jsonl`.
  Example: `/home/paulo/Projetos/hodor` → `-home-paulo-Projetos-hodor`.
- One file per session; filename is the session UUID; **append-only** (one JSON object per line).
- Auto-purge after 30 days unless `cleanupPeriodDays` is raised.
- Sub-agents get their OWN files `agent-<shortId>.jsonl` in the same project dir.
- Sidecar dirs keyed by sessionId: `file-history/`, `todos/`, `session-env/`, `debug/`.

## The record is a DAG node, NOT a log line (the load-bearing insight)

- Every record has `uuid` + `parentUuid`. The conversation is a **tree/DAG**, reconstructed by walking
  `parentUuid` from a **leaf** (a `uuid` that no record points to as `parentUuid`) back to a root.
- Measured on hodor: 5356 records with parentUuid, 0 orphans, 3 roots, **55 branch points** (parent with
  >1 child — forks from edits/resume). File order ≠ chronological: **551/5737** records out of timestamp
  order. So: neither file-order nor timestamp-sort reconstructs the conversation — only the DAG walk does.
- `--continue` = pick a leaf (most-recent), replay the parent chain into a message array, compact if
  needed, write a NEW child session. `--resume` = leaf picker. Directory must match `cwd` or resume fails.
- `leafUuid` lives in `summary` entries (title ↔ conversation tip) and a first-line `last-prompt` marks a
  resumed/forked session.

## Record envelope (top-level fields)

`type`, `uuid`, `parentUuid`, `timestamp` (ISO), `sessionId`, `cwd`, `gitBranch`, `version`,
`isSidechain`, `userType`, `isMeta`; assistant adds `requestId`; user tool-results add
`sourceToolAssistantUUID`. Record `type`s seen: `user`, `assistant`, `system`, `mode`,
`permission-mode`, `last-prompt`, `attachment`, `file-history-snapshot`, `summary`/`ai-title`,
`pr-link`, `queue-operation`.

## `message` content blocks (the resume-blocker gap)

`message.content` is a block array: `text`, `thinking` (with a cryptographic `signature`),
`tool_use { id, name, input }`, `tool_result { tool_use_id, content, is_error }`. Measured on hodor:
1421 `tool_use`, 1423 `tool_result`, **1418 paired by id** (1 dangling = in-flight). `message.usage`
carries `input_tokens`/`output_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens`.

**Our gap:** `@theokit/sdk` `StoredMessage.content` is a flat `string` → destroys `tool_use_id ↔
tool_result_id` pairing → a resumed history has dangling `tool_use` → Anthropic API 400. This is the #1
thing SE39 must fix (emit structured blocks, preserve pairing).

## Risks (carried into the SE39 DoD)

1. **Format officially unstable** — Anthropic: the entry format is internal + changes between versions;
   parsers break on any release; they recommend `/export`. → SE39 is opt-in + additive + read-only;
   `--continue` gated to SE40 behind an ADR + spike; validate against ≥1 captured transcript in CI.
2. **Extended-thinking signature** — upstream `#63147`: resuming a session whose transcript stored the
   thinking text empty but kept the signature fails with `400 "thinking blocks cannot be modified"`.
   SE39 emits thinking faithfully per the round-trip test; resume-critical handling → SE40.
3. **Dedup on branch/resume** — the same `uuid` can appear in multiple files; naive aggregation
   double-counts. The writer must be deterministic about which file owns which record.

## Reference implementations (read-side schema authorities)

`knowledge-base/references/{claude-code-log, claude-code-transcripts, claude-code-jsonl-parser}` (cloned,
gitignored). The SE39 round-trip acceptance test parses an SDK-generated `.jsonl` through
`claude-code-log` and validates against the real hodor transcript schema.

## Proposed SE39 shape (for /to-plan)

Additive `ClaudeCodeTranscriptWriter` beside the existing `ConversationStorage` (unchanged): maps
`SDKMessage`/`StoredMessage` → Claude-Code records, mints `uuid`s + the `parentUuid` chain from run
order, emits structured content blocks with preserved tool-call pairing, redacts secrets, writes to the
`~/.claude/projects/<encoded-cwd>/` path (opt-in). Read-only in SE39; `--continue` acceptance in SE40.
