# Subscriptions (streaming)

A subscription is a typed, server-pushed stream with **opaque resume tokens** — a client that disconnects reconnects and picks up exactly where it left off. Import from `@theokit/sdk/subscription`. Full reference: [`docs.md` § `@theokit/sdk/subscription`](../../docs.md).

## Server: describe a subscription

`Subscription.create` takes an input type and an async generator that yields outputs. Wrap each payload with `tracked(id, payload)` so the transport can stamp a resume token:

```typescript
import { Subscription, tracked } from "@theokit/sdk/subscription";

const chat = Subscription.create<{ room: string }, { text: string }>({
  name: "chat",
  subscribe: async function* (input, ctx) {
    for await (const msg of roomStream(input.room, ctx.signal)) {
      yield tracked(msg.id, { text: msg.text });
    }
  },
});
```

`ctx.signal` aborts the generator when the client goes away — honor it to stop upstream work.

## Client: consume + resume

`subscribe(url, opts)` returns an `AsyncGenerator` of events. Pass `lastEventId` (the last token you saw) to resume after a disconnect — the server replays only what you missed:

```typescript
import { subscribe } from "@theokit/sdk/subscription";

let lastEventId: string | undefined;
for await (const event of subscribe(url, { lastEventId })) {
  render(event.payload);
  lastEventId = event.id;   // persist this to survive a reload
}
```

## Resume tokens

- `tracked(id, payload)` — wrap a payload with a resume token (the `id` you choose, usually a monotonic message id).
- `isTrackedEnvelope(x)` — narrow an incoming value to a tracked envelope.
- The token is **opaque** to the client — treat it as a cursor, not a parseable value.

## Transports

`Subscription.create` produces a transport-agnostic descriptor; drive it over WebSocket or W3C SSE. The Node `ws` adapter is the canonical server adapter. Composes with [`Agent.streamObject`](../../docs.md) for structured streaming.

## Errors

Typed: `SubscriptionError`, `SubscriptionDisconnectError` (the client dropped), `SubscriptionInputError` (bad input to `subscribe`).

## Next

- [Stream events](../concepts/stream-events.md) — the per-run `SDKMessage` / `RunEvent` stream (a different, in-run surface)
- [1.6 → 1.7 subscriptions migration](../migration/1.6-to-1.7-subscriptions.md)
- [`docs.md` § `@theokit/sdk/subscription`](../../docs.md) — the full contract
