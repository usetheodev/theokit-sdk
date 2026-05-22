# @usetheo/gateway-slack

Slack platform adapter for `@usetheo/gateway`. Adoption Roadmap #7; ADRs D267-D285.

## Install

```bash
pnpm add @usetheo/gateway-slack @usetheo/gateway @usetheo/sdk @slack/bolt @slack/web-api
```

## Setup

1. Create a Slack app at <https://api.slack.com/apps> → **From scratch**.
2. Enable **Socket Mode** (Settings → Socket Mode → toggle on).
3. Under **OAuth & Permissions** → add Bot Token Scopes: `chat:write`, `app_mentions:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `users:read`.
4. Generate an **App-Level Token** with scope `connections:write` (Settings → Basic Information → App-Level Tokens).
5. Install the app to a workspace; copy the **Bot User OAuth Token** (`xoxb-...`).

## Usage

```typescript
import { SlackAdapter } from "@usetheo/gateway-slack";
import type { GatewayMessageEvent } from "@usetheo/gateway";

const adapter = new SlackAdapter({
  botToken: process.env.SLACK_BOT_TOKEN!,    // xoxb-...
  appToken: process.env.SLACK_APP_TOKEN!,    // xapp-...
  // requireMention: true (default) — bot in public channels only responds when mentioned.
  // Set to false for FAQ bots that should hear every message.
});

await adapter.connect();

adapter.onInbound(async (event: GatewayMessageEvent) => {
  if (event.platform !== "slack") return;
  await adapter.sendMessage({
    channel: event.channel,
    text: `Echo: ${event.text}`,
    format: "plain",
  });
});

// On shutdown:
await adapter.disconnect();
```

## v1 limitations (documented)

- **Socket Mode only** (D268) — HTTP webhook deferred to v1.x (D269).
- **`requireMention: true` default for channels** (D285) — prevents cost explosion. Opt out with `requireMention: false`.
- **No file uploads** (D280), **no Block Kit** (D281), **no reactions/modals/slash commands** (D282) — escape hatch via `adapter.getApp()` for advanced use.
- **Tool-aware send** — text only, max 4000 chars per chunk (D272). Multi-chunk responses preserve thread.

## License

Apache-2.0
