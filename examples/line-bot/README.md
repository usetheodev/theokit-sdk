# line-bot example

End-to-end LINE Messaging API echo agent using [`@usetheo/gateway-line`](../../packages/gateway-line).

## Setup

```bash
cp .env.example .env
# Fill LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, PUBLIC_URL, OPENROUTER_API_KEY
pnpm install
```

### LINE Developers Console

1. Sign in at [developers.line.biz/console](https://developers.line.biz/console).
2. Create or open a **Provider**.
3. Inside the Provider: **Create a new channel** → **Messaging API**.
4. Channel basic settings → copy **Channel secret** → `.env` as `LINE_CHANNEL_SECRET`.
5. Messaging API tab → issue a **Channel access token (long-lived)** → `.env` as `LINE_CHANNEL_ACCESS_TOKEN`.
6. (Optional) For mention guard in group chats: copy the bot's **User ID** (under Messaging API tab) → `LINE_BOT_USER_ID`.

### Webhook setup

```bash
ngrok http 3000
```

Paste the `https://abc.ngrok.io` URL into:
- LINE Developers Console → your channel → **Messaging API** → **Webhook URL**: `https://abc.ngrok.io/line`
- Toggle **Use webhook** ON.
- Disable **Auto-reply messages** (or LINE replies before your bot does).
- Disable **Greeting messages** (optional but recommended).

### Add the bot as a friend

LINE bots can only DM users who've added them as a friend.

1. Open the channel → **Messaging API**.
2. Scan the bot's QR code with the LINE app or click the "Add friend" link.

## Run

```bash
pnpm run
```

```
✓ LINE bot listening on port 3000
  LINE webhook URL: https://abc.ngrok.io/line
  DM the bot (add as friend first) or @-mention in a group.
```

### Live smoke

```bash
LINE_LIVE_SMOKE=1 pnpm smoke
```

Pushes one real text message to `LINE_TEST_USER_ID` (must be a user who's added the bot as a friend).

## Reply token vs Push

The adapter auto-uses Reply API (free) within 60s of receiving an event, then falls back to Push API. You don't have to think about it — but the `pushMessage` quota matters in production.

| Tier | Push messages/month |
|---|---|
| Free | 500 (LINE Light Plan) |
| Light | 4000 (¥0/month + ¥0.6/msg overage) |
| Standard | 30000 (¥10000/month) |

## Mention guard (D409)

In LINE, mentions come as an out-of-band `mentionees: [{ userId, ... }]` array — NOT inline `@text`. To respect that:

```ts
new LineAdapter({
  channelSecret: ...,
  channelAccessToken: ...,
  botUserId: "Uxxxxxxxxxxxxxxxxxxx",  // bot's own user id
  requireMention: true,  // default
});
```

Without `botUserId`, the guard is disabled. Pass it to ensure your bot only responds when explicitly addressed in groups.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `channel_secret_required` | `LINE_CHANNEL_SECRET` empty in `.env` |
| 401 invalid signature | Webhook URL in LINE Console doesn't match what's reaching the bot exactly |
| Bot receives DM but doesn't reply | LINE "Auto-reply messages" is enabled — disable it |
| Bot silent in group | No mentionee in `event.message.mentionees` and `requireMention: true` (default) — @-mention the bot or set `requireMention: false` |
| Image/sticker doesn't trigger handler | v0.1 only handles text (EC-4) — image/sticker filtered intentionally |
