---
"@theokit/sdk": minor
---

SE39 — Claude Code transcript interop (read-only):

- **`ClaudeCodeTranscriptWriter` (`@theokit/sdk/persistence`)** — emit a session as a
  Claude-Code-compatible `.jsonl` so the ecosystem's read-side tools (`claude-code-log`,
  `ccusage`, transcript viewers) can parse it. Opt-in and additive (does NOT change
  `ConversationStorage`). Taps `onStep`, so tool calls survive as structured
  `tool_use`/`tool_result` blocks with matched ids, `uuid`/`parentUuid` envelope, and the
  `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` path — validated end-to-end against the
  REAL `claude-code-log` parser (round-trip + real-LLM). Best-effort interop against an
  officially-unstable format; functional `--continue` is a later milestone.
- **Fixed: `SendOptions.onStep` was asymmetric** — it emitted `toolCall` but never the paired
  `toolResult` (which `run.conversation()` and the `ConversationStep` union already carry). A
  live-stream consumer missed every tool result. `onStep` now emits both, in lock-step with
  `run.conversation()`.
