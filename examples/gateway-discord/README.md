# @usetheo/example-gateway-discord

Minimal Discord bot using `@usetheo/gateway` + `@usetheo/gateway-discord`. Proves the gateway abstraction holds against a second transport.

## Setup

1. **Create a Discord application** at https://discord.com/developers/applications
2. Add a **Bot** under "Bot" → enable `MESSAGE CONTENT INTENT` (required for `!ping`/`!ask` text commands).
3. Copy the **Bot Token** into `.env` as `DISCORD_BOT_TOKEN=...`.
4. Invite the bot to a test server: OAuth2 → URL Generator → scopes: `bot` → permissions: `Send Messages`, `Read Message History`. Open the generated URL, pick your test server.
5. Set `OPENROUTER_API_KEY` in `.env` for `!ask`.

## Run

```bash
pnpm install --ignore-workspace
pnpm dev
```

## Commands

| Command | Behavior |
|---|---|
| `!ping` | Replies `pong`. No LLM call — proves transport. |
| `!ask <question>` | Round-trips through `Agent.create` + `agent.send` + LLM reply via OpenRouter. |

## Architecture

```
Discord WebSocket
   ↓
DiscordAdapter (@usetheo/gateway-discord)
   ↓
GatewayRunner (@usetheo/gateway)
   ↓
SessionRouter → agentId (e.g. "discord-dm-<userId>")
   ↓
Agent.create / agent.send (@usetheo/sdk)
   ↓
OpenRouter
```

Same dispatch shape as the Telegram example — only the adapter changes.

## License

Apache-2.0
