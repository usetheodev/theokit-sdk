# Telegram bot — restart-proof chat assistant

A ~120 LoC Telegram bot built on `@usetheo/sdk`. **One agent per chat, persistent across process restarts.** Real LLM. Real memory. Real session recall.

This example is the marquee proof that the SDK is a drop-in foundation for multi-user chat assistants. Restart the process, send another message — the bot still remembers the conversation.

## What it proves

- **ADR D17** — agent registry persists to `.theokit/agents/registry.json`. `Agent.resume(agentId)` works across `kill -9`.
- **ADR D18** — session messages persist to `.theokit/agents/<agentId>/messages.jsonl`. The LLM sees the full prior conversation on every send, even after restart.
- **ADR D19** — per-agent send mutex (`agent-send:<agentId>`). Concurrent webhook calls for the same chat serialize. No interleaved turns.
- **ADR D20** — `memory_search({ corpus: "sessions" })` finds past conversations. `/recall <query>` demonstrates it end-to-end.
- **ADR D21** — `Agent.resume(id)` falls back to disk when the in-memory registry misses. The bot author writes a single try/catch and gets full restart-proofing for free.

## Setup

1. Get a Telegram bot token from [@BotFather](https://t.me/botfather):
   - `/newbot`
   - Pick a name, then a username ending in `bot`.
   - Copy the token.

2. Copy the env template:

   ```bash
   cp .env.example .env
   ```

   Fill in:
   - `TELEGRAM_BOT_TOKEN` — from BotFather.
   - `OPENROUTER_API_KEY` — free at [openrouter.ai](https://openrouter.ai). The default model (`google/gemini-2.0-flash-001`) works on the free tier.
   - `THEOKIT_API_KEY` — use the same value as your OpenRouter key for OSS local mode. (The PaaS cloud runtime is pre-release.)

3. Install + run:

   ```bash
   pnpm install
   pnpm dev
   ```

## Restart-proof walkthrough

Open Telegram, message your bot:

| You | Bot |
|---|---|
| `/start` | Theo here. I remember things across restarts… |
| `Remember: my favorite framework is Vitest.` | Got it — Vitest. |
| `What's my favorite framework?` | Vitest. (recalled from MEMORY.md) |

Now **kill the bot process** (`Ctrl-C` or `kill -9 $(pgrep -f telegram-bot)`).

Restart:

```bash
pnpm dev
```

Send another message:

| You | Bot |
|---|---|
| `Remind me of my favorite framework.` | Vitest. (recalled from the persisted registry + memory) |
| `/recall vitest` | (lists past conversations that mentioned Vitest, with runId citations) |

Inspect the filesystem to see what survived:

```
.theokit/
├── agents/
│   ├── registry.json                       # one entry per chat
│   └── tg-<chatId>/messages.jsonl          # full conversation history
└── memory/
    ├── MEMORY.md                           # explicit facts
    └── sessions/<runId>.md                 # per-run summaries
```

## Concurrency

The per-agent send mutex (ADR D19) means: if a user sends three messages in three seconds, your bot processes them one at a time per chat — never interleaving. Different users still respond in parallel.

## Stability — important callout

> **Run exactly ONE SDK process per cwd.** The agent registry, the session JSONL, and the memory index are all keyed by `<cwd>/.theokit/`. Two SDK processes operating in the same workspace will race on `registry.json` (last-write-wins) and may lose mutations. Co-locating a bot + a standalone cron worker on the same workspace is unsupported in v1.0. If you need cron + bot in one workspace, use `Cron.start()` from inside the SAME bot process. Cross-process consensus is v1.x work.

## Group chats — important callout

> In group chats, `ctx.chat.id` is the **group id**, not the user id. Setting `memory.userId: String(ctx.chat.id)` mixes every group member's facts into one namespace. This example uses `ctx.from.id` as the fallback for non-private chats so each member gets isolated memory. Inspect `resolveUserId(ctx)` in `src/index.ts:18`.

## Files

- `src/index.ts` — the bot (~120 LoC).
- `package.json` — depends on `@usetheo/sdk` (workspace) and `grammy`.
- `.env.example` — copy to `.env` and fill in.

## Next steps

- Add a `Cron.create()` call to schedule a dreaming sweep every night.
- Swap the system prompt to specialize the bot for your domain.
- Add `tools.shell` for code execution (read-only sandbox by default).
