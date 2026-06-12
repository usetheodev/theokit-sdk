---
user-invocable: false
description: Gateway architecture and 10 platform adapters (Telegram, Slack, Discord, WhatsApp, Teams, Email, SMS, Mattermost, LINE, Matrix).
paths:
  - "**/*gateway*"
  - "**/*Gateway*"
  - "**/*telegram*"
  - "**/*slack*"
  - "**/*discord*"
  - "**/*whatsapp*"
---

# TheoKit SDK -- Gateways

Quick reference for the gateway architecture and all 10 platform adapters.

## Architecture

The gateway system uses a base adapter pattern. Each platform adapter extends `BasePlatformAdapter` from `@theokit/gateway`. The core package defines:

- `BasePlatformAdapter` -- abstract class with `connect`, `disconnect`, `sendMessage`, `onInbound`.
- `GatewayMessageEvent` -- discriminated union of all platform inbound events (keyed by `platform`).
- `OutboundMessage` -- what `sendMessage` accepts.
- `SendResult` -- `{ ok, messageId?, error? }`.
- Session router for multi-platform agent dispatch.

## BasePlatformAdapter

```typescript
abstract class BasePlatformAdapter {
  abstract readonly platform: PlatformName;
  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract sendMessage(out: OutboundMessage): Promise<SendResult>;
  abstract onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void;
  async startTyping(channelId: string): Promise<void> { /* noop */ }
  async stopTyping(channelId: string): Promise<void> { /* noop */ }
}
```

## GatewayMessageEvent (common fields)

```typescript
interface BaseMessageEvent {
  id: string;
  platform: PlatformName;
  sender: { id: string; username?: string; displayName?: string };
  channel: { id: string; type: "dm" | "group" | "thread"; topicId?: string };
  text: string;
  receivedAt: number;
  replyTo?: string;
}
```

## PlatformName

```typescript
type PlatformName =
  | "telegram" | "discord" | "slack" | "whatsapp" | "teams"
  | "email" | "sms" | "mattermost" | "line" | "matrix";
```

## Platform adapters

### 1. Telegram (`@theokit/gateway-telegram`)

```bash
pnpm add @theokit/gateway-telegram @theokit/gateway grammy
```

```typescript
import { TelegramAdapter } from "@theokit/gateway-telegram";

const adapter = new TelegramAdapter({ botToken: process.env.TELEGRAM_BOT_TOKEN! });
await adapter.connect();
```

Platform-specific: `event.telegram.chatId`, `event.telegram.messageId`, `event.telegram.threadId?`.

### 2. Discord (`@theokit/gateway-discord`)

```bash
pnpm add @theokit/gateway-discord @theokit/gateway discord.js
```

```typescript
import { DiscordAdapter } from "@theokit/gateway-discord";

const adapter = new DiscordAdapter({ botToken: process.env.DISCORD_BOT_TOKEN! });
await adapter.connect();
```

Platform-specific: `event.discord.guildId`, `event.discord.channelId`, `event.discord.messageId`.

### 3. Slack (`@theokit/gateway-slack`)

```bash
pnpm add @theokit/gateway-slack @theokit/gateway @slack/bolt @slack/web-api
```

```typescript
import { SlackAdapter } from "@theokit/gateway-slack";

const adapter = new SlackAdapter({
  botToken: process.env.SLACK_BOT_TOKEN!,
  appToken: process.env.SLACK_APP_TOKEN!,
  requireMention: true,  // default; public channels need @bot mention
});
await adapter.connect();
```

Platform-specific: `event.slack.teamId`, `event.slack.channelId`, `event.slack.ts`, `event.slack.threadTs?`.

### 4. WhatsApp (`@theokit/gateway-whatsapp`)

```bash
pnpm add @theokit/gateway-whatsapp @theokit/gateway
```

Two backends: `"cloud"` (Meta Cloud API) and `"web"` (whatsapp-web.js bridge).

Platform-specific: `event.whatsapp.wamid`, `event.whatsapp.backend`, `event.whatsapp.phoneNumberId?`.

### 5. Teams (`@theokit/gateway-teams`)

```bash
pnpm add @theokit/gateway-teams @theokit/gateway botbuilder
```

Platform-specific: `event.teams.activityId`, `event.teams.conversationId`, `event.teams.conversationType`, `event.teams.tenantId?`.

### 6. Email (`@theokit/gateway-email`)

```bash
pnpm add @theokit/gateway-email @theokit/gateway
```

Uses IMAP for inbound and SMTP for outbound.

Platform-specific: `event.email.messageId`, `event.email.subject`, `event.email.fromAddress`, `event.email.recipients`.

### 7. SMS (`@theokit/gateway-sms`)

```bash
pnpm add @theokit/gateway-sms @theokit/gateway
```

Backends: `"twilio"`, `"plivo"`, `"vonage"`. Inbound via webhook server.

Platform-specific: `event.sms.backend`, `event.sms.from` (E.164), `event.sms.to` (E.164).

### 8. Mattermost (`@theokit/gateway-mattermost`)

```bash
pnpm add @theokit/gateway-mattermost @theokit/gateway
```

Platform-specific: `event.mattermost.postId`, `event.mattermost.channelId`, `event.mattermost.rootId?`.

### 9. LINE (`@theokit/gateway-line`)

```bash
pnpm add @theokit/gateway-line @theokit/gateway
```

Inbound via webhook with signature verification. Reply tokens are cached (one-shot, 60s TTL).

Platform-specific: `event.line.sourceType`, `event.line.sourceId`, `event.line.messageId`.

### 10. Matrix (`@theokit/gateway-matrix`)

```bash
pnpm add @theokit/gateway-matrix @theokit/gateway matrix-js-sdk
```

Platform-specific: `event.matrix.roomId`, `event.matrix.eventId`, `event.matrix.memberCount`.

## Common usage pattern

```typescript
import { Agent } from "@theokit/sdk";

const adapter = new TelegramAdapter({ botToken: process.env.TELEGRAM_BOT_TOKEN! });
await adapter.connect();

adapter.onInbound(async (event) => {
  const agent = await Agent.getOrCreate(`${event.platform}-${event.sender.id}`, {
    apiKey: process.env.THEOKIT_API_KEY!,
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: process.cwd() },
    memory: { enabled: true, namespace: "bot", scope: "user", userId: event.sender.id },
  });

  await adapter.startTyping(event.channel.id);
  const run = await agent.send(event.text);
  const result = await run.wait();
  await adapter.stopTyping(event.channel.id);

  await adapter.sendMessage({
    channel: event.channel,
    text: result.result ?? "No response.",
    replyTo: event.id,
  });
});
```

## Error mapping convention

Each adapter maps platform errors to canonical `SendResult.error.code` values: `rate_limit`, `channel_not_found`, `no_permission`, `auth_error`, `message_too_long`, `platform_error`.
