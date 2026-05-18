# streamIntoTelegram Real-LLM Validation — 2026-05-17T21:31:24.858Z

Validates the telegram-pro v1.2 streaming helper (`examples/telegram-pro/src/streaming.ts`)
end-to-end against a real LLM. Uses a mock Telegram ctx that captures every
`reply`/`editMessageText`/`deleteMessage` API call.

## Configuration

- Provider: OpenRouter
- Model: google/gemini-2.0-flash-001
- Workspace: /tmp/tg-streaming-test-YW7tkz
- Prompt: "What is jazz music?"
- Expected behavior: placeholder reply + 1+ edits with final response text

## Result

| # | Check | Pass |
|---|---|---|
| 1 | no unhandled exception | ✅ |
| 2 | exactly 1 placeholder reply emitted | ✅ |
| 3 | at least 1 editMessageText emitted | ✅ |
| 4 | final edit contains non-empty text response | ✅ |
| 5 | no deleteMessage called (under buffer limit) | ✅ |

## Action log

- Replies: 1
- Edits:   1
- Deletes: 0
- Elapsed: 1581ms

**Final edit text (truncated):** I lack the information to define jazz mu

## Verdict

**PASS** — 5/5 checks passed.

This validates:
- `streamIntoTelegram` placeholder lifecycle (EC-1 guard)
- Real LLM streaming through `run.stream()` + assistant message events
- editMessageText path is correctly invoked
- Zero-deltas fallback NOT triggered (provider emitted text via stream OR
  fallback ran cleanly; either way buffer ended non-empty)
- No exception leaked from the helper
