# @theokit/gateway-telegram

Telegram platform adapter for `@theokit/gateway`. Wraps [grammy](https://grammy.dev/) in the `BasePlatformAdapter` contract.

> **Status: 0.1.0 — pre-release.**

## Install

```bash
pnpm add @theokit/gateway-telegram @theokit/gateway @theokit/sdk grammy
```

`grammy` is a peer dep — install the version your bot needs.

## Usage

```typescript
import { GatewayRunner } from "@theokit/gateway";
import { TelegramAdapter } from "@theokit/gateway-telegram";

const adapter = new TelegramAdapter({
  token: process.env.TELEGRAM_BOT_TOKEN!,
  allowedUsers: ["7528967933"], // optional
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    await ctx.reply(`got: ${event.text}`);
  },
});

await runner.start();
```

## Helpers

- `shouldRespondInChat(ctx, policy)` — group-chat policy (DM = always reply, group = only on `@mention` or reply-to-bot or slash command). Register as a `pre_inbound` hook.
- `splitForTelegram(text)` — auto-splits text >4096 chars across multiple `sendMessage` calls.

## Platform escape hatch

For Telegram features not portable across platforms (voice transcription, photo OCR, sticker handling), use `event.telegram?.raw` to access the underlying grammy `Context`:

```typescript
runner.onInbound(async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as import("grammy").Context;
  if (ctx.message?.voice) { /* ... */ }
});
```

## License

Apache-2.0
