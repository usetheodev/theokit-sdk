# @theokit/gateway-mattermost

Mattermost platform adapter for [`@theokit/gateway`](../gateway).

Works with self-hosted Mattermost (Docker / Kubernetes / bare metal) and Mattermost Cloud. WebSocket gateway for real-time inbound, REST v4 for outbound.

## Install

```bash
pnpm add @theokit/sdk @theokit/gateway @theokit/gateway-mattermost
pnpm add @mattermost/client ws
```

## Quick start

```ts
import { Agent } from "@theokit/sdk";
import { GatewayRunner } from "@theokit/gateway";
import { MattermostAdapter } from "@theokit/gateway-mattermost";

const adapter = new MattermostAdapter({
  baseUrl: "https://mattermost.acme.com",
  accessToken: process.env.MM_BOT_TOKEN!,
  // Optional: ignore non-DM channels unless explicitly mentioned (default: true).
  // requireMention: true,
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.platform !== "mattermost") return;
    await ctx.reply(`Echo: ${event.text}`);
  },
});

await runner.start();
```

## Setup

### Bot account + Personal Access Token

1. Sign in as a Mattermost admin.
2. **System Console → Integrations → Bot Accounts** — enable.
3. **Account Settings → Account Settings → Display → Show username 'bot' tag** — optional.
4. Create a bot account (Integrations → Bot Accounts → Add Bot Account).
5. Copy the generated access token (shown once — store securely in `.env`).
6. Add the bot to channels where it should listen.

### Required environment

```
MM_BASE_URL=https://mattermost.acme.com
MM_BOT_TOKEN=<paste-the-token>
```

## Behavior

| Mattermost channel type | Adapter `channel.type` | Notes |
|---|---|---|
| `D` (Direct Message) | `"dm"` | Always processes inbound. |
| `G` (Group DM) | `"group"` | Requires `@bot` mention by default. |
| `O` (Open / Public) | `"group"` | Requires `@bot` mention by default. |
| `P` (Private) | `"group"` | Requires `@bot` mention by default. |

Thread replies (`root_id` set on the Mattermost post) become `channel.type: "thread"` with `topicId` = root post id. Sending with `type: "thread"` + `topicId: <root>` posts as a thread reply.

### Mention guard (EC-2)

The default `requireMention: true` is enforced via:

1. **`metadata.mentions` array first** — Mattermost's API returns a list of user-ids mentioned in the post. The adapter checks if the bot's user-id is in this list. No ambiguity.
2. **Text regex fallback** — when metadata is absent, the adapter matches `\b@${botUsername}\b` with word boundary. This prevents `@theory_dept` from matching a bot called `theo`.

Override with `requireMention: false` to make the bot respond to every message in every channel it's a member of (loud — use cautiously).

## What's NOT supported in v0.1

| Feature | Status | Workaround |
|---|---|---|
| OAuth auth | Deferred to v0.2 (D401) | Use PAT |
| File uploads | Deferred to v0.2 (D404) | `adapter.getClient().uploadFile(...)` (escape hatch) |
| Slash command incoming webhooks | Not supported v0.1 | — |
| Ephemeral / hidden messages | Not supported v0.1 | — |

## ADRs

D397 – D404 in `.claude/knowledge-base/adrs/`.
