---
user-invocable: false
paths:
  - "**/*subscri*"
  - "**/*sse*"
  - "**/*websocket*"
  - "**/*ws.*"
description: TheoKit SDK Subscriptions API — defineSubscription, SSE/WebSocket transport, subscribe, tracked, resume tokens
---

# TheoKit Subscriptions

Typed WebSocket + W3C SSE subscriptions with opaque resume tokens. Available
via the `@theokit/sdk/subscription` sub-path import (not on the main barrel).

## Server side — `defineSubscription`

```typescript
import { defineSubscription } from "@theokit/sdk/subscription";
import { z } from "zod";

export default defineSubscription({
  input: z.object({
    room: z.string(),
    lastEventId: z.string().optional(),
  }),
  output: z.object({
    id: z.string(),
    text: z.string(),
    sender: z.string(),
    ts: z.number(),
  }),
  async *handler(input, ctx) {
    let cursor = input.lastEventId ?? "0";
    while (!ctx.signal.aborted) {
      const msgs = await fetchNewMessages(input.room, cursor);
      for (const m of msgs) {
        cursor = m.id;
        yield ctx.tracked(m.id, {
          id: m.id,
          text: m.text,
          sender: m.sender,
          ts: m.ts,
        });
      }
      await sleep(1000);
    }
  },
});
```

### `ctx.tracked(id, payload)`

Advertises a resume token alongside the payload. The client receives the token
and echoes it back on reconnect via `lastEventId`. The token is **opaque to
the SDK** — the server handler decides its semantics:

- Monotonic int: `"42"` — resume after event 42
- ULID: `"01H9X..."` — resume after that ULID
- Encrypted cursor: consumer decrypts + decodes
- Timestamp: `"2026-06-04T15:00:00Z"` — resume after that moment

## Client side — `subscribe`

```typescript
import { subscribe } from "@theokit/sdk/subscription";

for await (const msg of subscribe<
  { room: string },
  { id: string; text: string; sender: string; ts: number }
>(
  "chat",
  { room: "lobby" },
  {
    baseUrl: "http://localhost:3000",
    transport: "auto",             // 'ws' | 'sse' | 'auto' (default)
    maxReconnectAttempts: 10,      // 0 disables reconnect
  },
)) {
  console.log(`[${msg.sender}] ${msg.text}`);
}
```

## Transport selection

| Mode | When to use |
|---|---|
| `'auto'` (default) | Prefer WS, fall back to SSE — works everywhere |
| `'ws'` | Strict bidirectional — error if WS unavailable |
| `'sse'` | Browser-native EventSource, no upgrade required |

## Composing with LLM streaming

`Agent.streamObject` and `defineSubscription` are independent surfaces. Call
`Agent.streamObject` inside a subscription handler:

```typescript
export default defineSubscription({
  input: z.object({ topic: z.string() }),
  output: z.object({ kind: z.enum(["partial", "complete"]), text: z.string() }),
  async *handler(input, ctx) {
    let counter = 0;
    const iter = Agent.streamObject({
      schema: z.object({ text: z.string() }),
      prompt: `Write a haiku about ${input.topic}`,
      model: { id: "openrouter/openai/gpt-4o-mini" },
      apiKey: process.env.OPENROUTER_API_KEY,
      local: { settingSources: [] },
    });
    for await (const evt of iter) {
      if (evt.type === "partial") {
        yield ctx.tracked(String(++counter), {
          kind: "partial",
          text: JSON.stringify(evt.partial),
        });
      } else if (evt.type === "complete") {
        yield ctx.tracked(String(++counter), {
          kind: "complete",
          text: evt.object.text,
        });
      }
    }
  },
});
```

## Multi-runtime support

| Runtime | v1.7.0 | v1.8.x (planned) |
|---|---|---|
| Node 22+ | Yes (`ws` optional peer) | Yes |
| Cloudflare Workers | Consumer-supplied `WsAdapter` only | `@theokit/sdk-ws-cloudflare` |
| Bun | Consumer-supplied `WsAdapter` only | `@theokit/sdk-ws-bun` |
| Deno | Consumer-supplied `WsAdapter` only | `@theokit/sdk-ws-deno` |

## Security checklist

1. Authenticate WS upgrade via the request object — auth runs BEFORE upgrade
2. Validate input via Zod schema (done by SDK automatically)
3. Bind resume tokens to session when token leakage allows replay
4. Force-close on session revocation via `ctx.disconnect(code, reason)`
5. Never log payloads — telemetry captures `{subscriptionName, lastEventId}` only

## Why sub-path import?

`@theokit/sdk/subscription` is a dedicated entry point to isolate the
subscription module from the main `index.ts` DTS bundle. Once the internal
rollup-dts cycle is resolved, `Theokit.subscribe` can be promoted additively.
