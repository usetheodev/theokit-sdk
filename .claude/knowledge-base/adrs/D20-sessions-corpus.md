---
id: D20
status: Decided
date: 2026-05-16
plan: chat-assistant-readiness
---

# D20 — `corpus="sessions"` indexes per-run summary markdown

## Context
`memory_search` accepted `corpus: "memory" | "sessions" | "wiki" | "all"` in its declared union (per ADR D5 + OpenClaw parity), but the `"sessions"` branch returned empty. The data source did not exist — no code wrote to `.theokit/memory/sessions/`. Past-conversation recall was advertised but unimplemented.

## Decision
After every run with `status: "finished"` AND a non-empty result, the SDK writes a markdown summary to `<cwd>/.theokit/memory/sessions/<runId>.md`. IndexManager discovers these files with `source: "sessions"`. The `memory_search` tool filters by source.

Summary format:
```markdown
---
runId: run-abc-123
agentId: agent-xyz
at: 2026-05-16T14:32:00Z
status: finished
---
## User
<truncated to 2000 chars, secrets redacted>

## Assistant
<truncated to 2000 chars, secrets redacted>
```

## Rationale
- Matches OpenClaw `corpus` parameter semantics.
- Per-run summary (not raw streams) keeps the index tractable; each summary becomes 1–2 chunks (user + assistant).
- Filing recall as a corpus filter — not a separate API — keeps the public surface narrow.
- Past-conversation recall is the differentiator for chat assistants over single-shot tools.

## Consequences
- New write per run (~200–500 bytes typical).
- EC-9: only `status === "finished"` triggers a write. Cancelled / errored / timed-out runs leave no marker so recall never returns broken-conversation fragments as authoritative context.
- EC-3: `writeSessionSummary` triggers `IndexManager.sync()` in background (fire-and-forget) immediately after the markdown write. `memory_search({ corpus: "sessions" })` sees the new file on the next call.
- Secret redaction (`redactSecrets`) applies to both user and assistant text before write.
- Truncation to 2000 chars per turn keeps individual files small; full transcripts live in the per-agent `messages.jsonl` (ADR D18).
- Retention policy is out-of-scope for v1.0 — users with millions of runs can prune via custom Cron jobs (deferred to v1.1).

## Alternatives Considered
- **Index the messages.jsonl directly** — rejected; JSONL is one record per turn, not a markdown-shaped chunk; the existing `chunkMarkdown` pipeline doesn't apply.
- **In-memory session corpus rebuilt every search** — rejected; doesn't survive restart; doesn't scale beyond the current session.
- **Index every run on every send** — rejected; only finished runs are worth recalling.
