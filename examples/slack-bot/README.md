# example: slack-bot

Demonstrates `@theokit/gateway-slack` (Adoption Roadmap #7; ADRs D267-D285) — a
Slack bot that DMs back and echoes mentions in channels, with replies generated
by `@theokit/sdk` Agent.

## Setup

1. Go to <https://api.slack.com/apps> → **Create New App** → **From scratch**.
2. **Socket Mode** → toggle **Enable Socket Mode**.
3. **OAuth & Permissions** → add Bot Token Scopes:
   - `chat:write`
   - `app_mentions:read`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`
   - `users:read`
4. **Event Subscriptions** → enable + subscribe to bot events:
   - `message.im`
   - `message.channels`
   - `message.groups`
   - `message.mpim`
5. **Basic Information** → **App-Level Tokens** → generate token with `connections:write` scope. Copy as `xapp-...`.
6. **Install App** to your workspace → copy the **Bot User OAuth Token** (`xoxb-...`).

## Run

```bash
cp .env.example .env
# Fill SLACK_BOT_TOKEN (xoxb-), SLACK_APP_TOKEN (xapp-), OPENROUTER_API_KEY
pnpm install
pnpm run run
```

Then in Slack:
- DM the bot: any text. Bot replies via gpt-4o-mini.
- In a channel: `/invite @YourBot`, then `@YourBot hello`. Bot replies.
- In a channel without mention: nothing happens (D285 mention guard).

To allow the bot to respond to ALL channel messages (FAQ bot style), set
`requireMention: false` when constructing `SlackAdapter`. Be aware of cost
implications — every channel message will trigger an LLM call.

## What it shows

- `SlackAdapter` lifecycle (`connect` / `onInbound` / `sendMessage` / `disconnect`).
- Socket Mode (D268) — zero-infra; no public URL needed.
- `D285` mention guard for channels (default-true).
- `splitForSlack` (D272) handles long replies automatically.
- `mapSlackError` (D273) surfaces canonical error codes if `chat.postMessage` fails.
- Bot loop guard (D275) — bot doesn't reply to its own messages.

## Dogfood (env-gated per D284)

This example is the canonical dogfood path for `@theokit/gateway-slack`. It is
NOT automated in CI because we don't have a shared test workspace. Run manually
with your own Slack app tokens.
