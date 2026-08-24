# {{projectName}}

A Telegram bot powered by `@theokit/sdk` + `@theokit/gateway` — scaffolded
by `theokit init --template telegram-bot`.

## Setup

```bash
# 1. Create a bot via @BotFather: https://t.me/BotFather
#    /start → /newbot → name it → copy the token.
# 2. Configure:
cp .env.example .env
# Edit .env: set TELEGRAM_BOT_TOKEN and ONE of the provider API keys.

# 3. Install + run:
pnpm install
pnpm dev
```

Then DM your bot in Telegram. Every message gets streamed through the agent.

## What this does

- `GatewayRunner` + `TelegramAdapter` handle the platform plumbing.
- `AgentFactory.create` captures the shared config once; `factory.getOrCreate`
  keeps one persistent agent per chat, so memory and state survive across turns.
- Each inbound message → `agent.send` → reply back via `ctx.reply`.

## Customize

- Switch model: `AGENT_MODEL=ollama/llama3.2:3b` for local Ollama.
- Add custom tools: `Tool.create({ name, description, inputSchema, handler })`
  from `@theokit/sdk`, passed as `AgentFactory.create({ tools: [...] })`.
- Slash commands: `runner.command("name", handler)` — see
  `@theokit/gateway` docs.
