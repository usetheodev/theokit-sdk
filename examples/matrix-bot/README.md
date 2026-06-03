# matrix-bot example

End-to-end Matrix echo bot using [`@theokit/gateway-matrix`](../../packages/gateway-matrix).

## Setup

```bash
cp .env.example .env
# Fill MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID, OPENROUTER_API_KEY
npm install --legacy-peer-deps
```

`matrix-js-sdk` has loose typescript peer ranges — `--legacy-peer-deps` keeps npm happy.

### Bot account

Easiest path: matrix.org.

1. Sign up for a new account (Element web → matrix.org → register).
2. Pick a sensible localpart (e.g. `theo-bot`).
3. Note the full Matrix ID: `@theo-bot:matrix.org`.

For self-hosted (Synapse/Dendrite), follow your admin's signup flow.

### Access token

Element web UI:

1. Sign in as the bot account.
2. **Settings → Help & About → Advanced**.
3. Click "Access Token" → reveal + copy.
4. Save as `MATRIX_ACCESS_TOKEN`. **Keep this secret** — anyone with the token can act as the bot.

### Invite the bot

In an Element room (UNENCRYPTED — v0.1 doesn't support E2EE):

1. Settings → People & invites → Invite → paste `@theo-bot:matrix.org`.
2. Accept the invite (Element will prompt the bot account; or in our adapter, joining is handled on first sync).

## Run

```bash
pnpm run
```

```
✓ Matrix bot connected
  Homeserver: https://matrix.org
  Bot user: @theo-bot:matrix.org
  Invite the bot to an UNENCRYPTED room to test. EC-3: live events only (≤60s).
```

Send a message in the room. The bot will respond.

## Live smoke

```bash
MATRIX_LIVE_SMOKE=1 MATRIX_TEST_ROOM='!abc:matrix.org' pnpm smoke
```

Posts one real message. `MATRIX_TEST_ROOM` can be a room id (`!`) or an alias (`#`).

## EC-3 — initial sync flood guard

When the bot starts, `matrix-js-sdk` delivers ~10 recent events per joined room. With 50 rooms that's 500 events → potential LLM call storm. **The adapter drops events older than 60s** so initial sync only fires for genuinely live messages.

This means: if a user messaged the room 5 minutes ago and the bot wasn't running, the bot ignores that history on boot. Restart-then-replay isn't supported in v0.1.

## DM detection

Matrix has no native DM concept — DMs are rooms with 2 members. The adapter applies the canonical heuristic (`memberCount === 2 → dm`). If you set up a 2-person room and intend it as a "small group", it will still be detected as DM.

## What's NOT supported in v0.1

| Feature | Status | Workaround |
|---|---|---|
| E2EE rooms | Refused with warn stderr (D418) | Use unencrypted rooms; E2EE in v0.2 |
| Threads (MSC4140) | Deferred to v0.2 | Replies land at root |
| Sync token persistence | Not exposed | Restart re-syncs (mitigated by 60s filter) |
| Reactions / redactions | Inbound preserved via `event.matrix.raw` | Outbound: `adapter.getClient().sendEvent(...)` |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `access_token_required` | `MATRIX_ACCESS_TOKEN` empty in `.env` |
| `user_id_required` | `MATRIX_USER_ID` missing or doesn't start with `@` |
| `connect failed` | Homeserver unreachable, token invalid, or matrix-js-sdk peer missing |
| Bot doesn't respond after boot | EC-3: events were old (>60s). Send a fresh message. |
| `encrypted_room_unsupported` | Room is E2EE; create or invite to an unencrypted room |
