---
"@theokit/sdk": minor
---

A resumed session can be re-rendered as tool cards, not prose (theokit#146).

The transcript always replayed correctly to the model, but the only projection a host could read
folded a tool call to the literal string `[tool call] NAME` — no call id, no arguments — and a
result to `[tool result] <body>`, with nothing tying the two together. A card-rendering TUI got flat
text on resume, which made cross-restart resume worth less than starting fresh.

Two additions, both additive:

- `SessionMessage` gains an optional `parts` array carrying `text`, `tool_use` (id, name, input) and
  `tool_result` (toolUseId, content, isError). `text` is byte-identical to before, so every existing
  reader — including the runtime's own prior-context replay — is untouched.
- New `Agent.transcript(agentId)` returns a local agent's persisted turns with both projections.
  Read-only; it opens the session store and walks the transcript, appending nothing. Throws
  `UnknownAgentError` for an unknown or non-local agent rather than returning an empty list, so a
  typo cannot look like an empty session.

`SessionMessage` and `SessionMessagePart` are exported from the package barrel.
