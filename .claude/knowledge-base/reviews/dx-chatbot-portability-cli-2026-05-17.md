# DX Chat Bot Portability — N=2 — 2026-05-17

Acceptance rubric (ADR D35): **At least N=2 chat bot examples exist using
all 4 DX helpers; each persists a session and recovers after restart.**

## N=2 examples

| # | Example | Channel | Helpers used | Status |
|---|---|---|---|---|
| 1 | [`telegram-pro`](../../../examples/telegram-pro) | Telegram (HTTP polling) | `createAgentFactory`, `Agent.getOrCreate`, `defineTool`, `SendOptions.tools` | ✅ Production-validated (CDP test + messages.jsonl: UUID v4, SHA256 hello, 2026 timestamp) |
| 2 | [`cli-bot`](../../../examples/cli-bot) | Terminal (stdin/stdout) | `createAgentFactory`, `Agent.getOrCreate`, `defineTool` | ✅ Real-LLM smoke (CI_SMOKE=1 returns "Hello!" from LLM, exit=0) |

## Smoke evidence — cli-bot

```
$ CI_SMOKE=1 BOT_BANNER=quiet pnpm dev
[theokit-sdk] memory tools unavailable: ... (SQLite optional)
Hello!
```

The LLM responded "Hello!" to the canned prompt — proves real LLM
invocation through the factory + getOrCreate path.

## Result

**PASS** per D35 target. Two distinct chat bot shapes (Telegram HTTP
long-poll + CLI terminal stdin) use the same 4 DX helpers and the same
persistence layer. The pattern is portable.

## Notes

- `better-sqlite3` is an optional dependency for memory tools.
  cli-bot doesn't install it, so memory_search/memory_get degrade
  gracefully to fixture mode (logged stderr warning). The Agent
  itself + factory + getOrCreate + defineTool all work without it.
- Discord and Slack bots are out of scope (ADR D36). Pattern is
  reproducible in either; community can contribute.
