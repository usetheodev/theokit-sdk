# mattermost-bot example

End-to-end Mattermost echo agent using [`@theokit/gateway-mattermost`](../../packages/gateway-mattermost).

## Setup

```bash
cp .env.example .env
# Fill MM_BASE_URL, MM_BOT_TOKEN, OPENROUTER_API_KEY (or other LLM key)
pnpm install
```

### Mattermost Console

1. Sign in as a Mattermost admin.
2. **System Console → Integrations → Bot Accounts** — toggle "Enable Bot Account Creation".
3. **Integrations → Bot Accounts → Add Bot Account**:
   - Username: `theo-bot` (or any lowercase alphanumeric)
   - Display name: optional
4. Click "Create" — copy the **access token** that appears (you only see it once).
5. Save the token in `.env` as `MM_BOT_TOKEN`.
6. Add the bot to channels where it should listen:
   - In any channel: `/invite @theo-bot`
   - Or via admin: System Console → Users → bot → Manage Teams.

### `.env` quick reference

| Key | Example | Purpose |
|---|---|---|
| `MM_BASE_URL` | `https://mattermost.acme.com` | Your server URL (no trailing slash) |
| `MM_BOT_TOKEN` | `abcXYZ123...` | PAT from step 4 |
| `OPENROUTER_API_KEY` | `sk-or-v1-...` | LLM provider key |
| `MM_TEST_CHANNEL_ID` | `c-1abc...` | Required only for `pnpm smoke` |

## Run

```bash
pnpm run
```

You should see:

```
✓ Mattermost bot connected
  Server: https://mattermost.acme.com
  DM the bot or @mention it in a channel to test.
```

### Test

- **DM**: Open a direct message to `@theo-bot`. Type anything. Bot replies.
- **Channel**: In a channel the bot is in, `@theo-bot hello`. Bot replies. Without `@mention`, the bot ignores the message (default `requireMention: true` — change in `run.ts` if you want loud mode).

### Live smoke

```bash
MATTERMOST_LIVE_SMOKE=1 pnpm smoke
```

Sends one real post to `MM_TEST_CHANNEL_ID`. Without `MATTERMOST_LIVE_SMOKE=1`, dry-mode only validates the adapter constructs without crashing.

## Threading (D399)

When a user replies to a thread, the inbound `event.channel.type` is `"thread"` and `event.channel.topicId` is the root post id. To reply in the same thread:

```ts
await ctx.reply("acknowledged"); // GatewayRunner preserves the inbound channel + topicId
```

The adapter automatically sets `root_id` on outbound posts when `channel.type === "thread"` (D399).

## Channel-type mapping (D402)

| Mattermost type | Adapter `channel.type` | Notes |
|---|---|---|
| `D` (DM) | `dm` | Always responds (no mention needed). |
| `G` (Group DM) | `group` | Requires `@bot` mention by default. |
| `O` (Open) | `group` | Requires `@bot` mention by default. |
| `P` (Private) | `group` | Requires `@bot` mention by default. |

The original Mattermost type is exposed at `event.mattermost.channelType` for callers needing the distinction.

## Mention safety (EC-2)

Bot username `theo` will NOT trigger on `@theory_dept` or `@theology`. The adapter:

1. Prioritizes `post.metadata.mentions` array (unambiguous user-id list from API).
2. Falls back to text regex with **word-boundary** `\b@theo\b`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `access_token_required` | `MM_BOT_TOKEN` empty in `.env` |
| `base_url_required` | `MM_BASE_URL` empty |
| `connect failed` | Server unreachable, token invalid, or server has TLS issue |
| `permission_denied` on send | Bot not in the channel; invite it first |
| Bot silent in channel | Channel is not DM and message doesn't contain `@bot` mention |

## ADRs

D397 – D404 in [`.claude/knowledge-base/adrs/`](../../.claude/knowledge-base/adrs/).
