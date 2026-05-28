# @usetheo/gateway-matrix

Matrix protocol platform adapter for [`@usetheo/gateway`](../gateway).

Decentralized federation. Works with matrix.org, element.io, self-hosted Synapse/Dendrite, etc. Bot in `@bot:matrix.org` can receive from `@alice:element.io` via federation built-in.

## Install

```bash
pnpm add @usetheo/sdk @usetheo/gateway @usetheo/gateway-matrix
pnpm add matrix-js-sdk  # ~2MB peer-dep
```

## Quick start

```ts
import { Agent } from "@usetheo/sdk";
import { GatewayRunner } from "@usetheo/gateway";
import { MatrixAdapter } from "@usetheo/gateway-matrix";

const adapter = new MatrixAdapter({
  homeserverUrl: "https://matrix.org",
  accessToken: process.env.MATRIX_ACCESS_TOKEN!,
  userId: "@theo-bot:matrix.org",
});

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.platform !== "matrix") return;
    await ctx.reply(`Echo: ${event.text}`);
  },
});

await runner.start();
```

## Access token

Element web UI is the easiest path:

1. Sign in as the bot account.
2. **Settings → Help & About → Advanced**.
3. Click "**Access Token**" → reveal + copy.
4. Save as `MATRIX_ACCESS_TOKEN` in `.env`.

Keep this token secret — it grants full account access.

## DM detection (D416)

Matrix has no native "DM" concept — DMs are simply rooms with 2 members. The adapter applies the canonical heuristic:

```
room.getJoinedMemberCount() === 2 → channel.type: "dm"
≥3 members                       → channel.type: "group"
```

Edge case: a user who creates a 2-person room intended as a small group will still be detected as a DM. Use `event.matrix.roomId` + Matrix's `m.direct` account-data to override if you need precision.

## Initial sync flood guard (EC-3 absorbed)

On startup, `matrix-js-sdk` delivers the most recent ~10 events per room. A bot in 50 rooms = 500 events fired in seconds → 500 LLM calls = cost explosion. **The adapter filters events older than 60s** (`event.getTs() < Date.now() - 60_000`) so initial sync only delivers genuinely live messages. To replay history programmatically, use the raw `MatrixClient` via `adapter.getClient()`.

## Alias resolution (D419)

```ts
// All three accepted (caller's choice):
await ctx.reply("hi");                       // event.channel.id = room id from inbound
await adapter.sendMessage({
  channel: { id: "#general:matrix.org", type: "group" },  // alias resolved
  text: "...",
});
await adapter.sendMessage({
  channel: { id: "!abc123:matrix.org", type: "group" },   // room id direct
  text: "...",
});
```

Aliases are resolved + cached on first use. If the admin renames an alias mid-process, sends to the cached value fail (rare — restart resolves).

## What's NOT supported in v0.1

| Feature | Status | Workaround |
|---|---|---|
| E2EE rooms | Refused with warn stderr (D418) | Use unencrypted rooms; E2EE in v0.2 |
| Threads (MSC4140) | Deferred to v0.2 (D417) | All replies land at room root |
| Reactions / redactions | Inbound preserved via `event.matrix.raw` | Outbound: `adapter.getClient().sendEvent(...)` |
| Media (image/file/audio) | Inbound delivered with empty `text` | Read `event.matrix.raw.getContent()` for the file URL |
| Sync token persistence | Process-local | Restart re-syncs (mitigated by 60s freshness filter) |

## Federation transparency (D420)

The adapter doesn't handle federation — Matrix protocol does. Your bot in `@theo-bot:matrix.org` can be added to rooms by users on any homeserver and the conversation flows transparently. Outbound performance varies with remote homeserver latency; failure modes (e.g. remote unreachable) surface as `SendResult{send_failed}`.

## ADRs

D413 – D421 in `.claude/knowledge-base/adrs/`.
