# @usetheo/gateway-discord

Discord platform adapter for `@usetheo/gateway`. Wraps [discord.js](https://discord.js.org/) in the `BasePlatformAdapter` contract.

> **Status: 0.1.0 — pre-release.**

## Install

```bash
pnpm add @usetheo/gateway-discord @usetheo/gateway @usetheo/sdk discord.js
```

## Usage

```typescript
import { GatewayRunner } from "@usetheo/gateway";
import { DiscordAdapter } from "@usetheo/gateway-discord";

const adapter = new DiscordAdapter({
  token: process.env.DISCORD_BOT_TOKEN!,
  // intents defaults to [Guilds, GuildMessages, MessageContent,
  // DirectMessages, DirectMessageReactions]. Without MessageContent
  // the bot receives empty msg.content — silent failure (EC-C).
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`got: ${event.text}`);
  },
});

await runner.start();
```

## Limitations (v0.1)

- **Text-trigger commands only.** Proper Discord slash commands (registered via Application Commands API) are out of scope — use `event.text.startsWith("!cmd")` for now.
- **WebSocket only** (ADR D179). No webhook-based bot mode.
- **Voice channels** not exposed via `MessageEvent`. Use `event.discord?.raw` for advanced cases.

## License

Apache-2.0
