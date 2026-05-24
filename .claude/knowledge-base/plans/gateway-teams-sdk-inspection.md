# `@microsoft/teams.apps@2.0.11` SDK Inspection (T0.1 — Phase 0 / EC-2)

> Date: 2026-05-23
> Inspected via `pnpm install @microsoft/teams.apps@^2 @microsoft/teams.api@^2` + reading `.d.ts` files.
> Purpose: lock down the real TS API surface BEFORE writing adapter code (EC-2 absorbed).

## Versions

- `@microsoft/teams.apps`: `2.0.11`
- `@microsoft/teams.api`: `2.0.11` (peer-installed; transitively from apps)

## Answers to the 7 Phase 0 questions

### Q1: HTTP handler method?

**Not** `app.process(req, res)`. The SDK has a **pluggable HTTP server adapter** via the `httpServerAdapter?: IHttpServerAdapter` option in `AppOptions`. The package ships a ready-made `ExpressAdapter`:

```typescript
import { App, ExpressAdapter } from "@microsoft/teams.apps";
import express from "express";

const expressApp = express();
expressApp.use(express.json());
const httpServerAdapter = new ExpressAdapter(expressApp);
const teamsApp = new App({ clientId, clientSecret, tenantId, httpServerAdapter });
await teamsApp.start(port);  // SDK registers POST /api/messages on expressApp
```

The SDK does NOT expose a bare `(req, res) => Promise<void>` handler for the user to mount manually. Instead, the user gives the SDK an Express app and the SDK mounts its own routes (default `/api/messages`).

### Q2: Send method?

```typescript
app.send(conversationId: string, activity: ActivityLike): Promise<SentActivity>
```

**Important:** takes a **plain `conversationId` string**, NOT a `ConversationReference` object. Hermes Python used `ConversationReference`; TS SDK simplifies this.

Returns `SentActivity` which has `{ id: string } & ActivityParams` — `.id` is the wamid-equivalent.

Also exposed: `app.reply(conversationId, messageId, activity)` for threaded replies in channels.

### Q3: Inbound subscription?

```typescript
app.on(name: 'activity' | 'activity.sent' | 'activity.response' | 'error' | 'signin' | 'start', cb)
app.message(pattern: string | RegExp, cb)
```

EventEmitter-style. For our adapter we use `app.on('activity', cb)` to receive every inbound activity, then narrow to `MessageActivity` by checking `activity.type === 'message'`.

### Q4: Initialization?

```typescript
await app.initialize()  // async
await app.start(port?)  // async; calls initialize() internally if not yet called
await app.stop()        // async
```

Idempotent? `start()` checks `isInitialized`. Calling `start()` twice → second is fast-path noop.

### Q5: Raw body requirement?

**No** raw body required. SDK validates JWT from the `Authorization` header (Bearer token from Bot Framework). Body is regular parsed JSON — standard `express.json()` middleware works. No `verify` callback needed (unlike WhatsApp's HMAC-signed body).

### Q6: ConversationReference extraction?

**NOT NEEDED.** `app.send(conversationId, activity)` takes the conversation id string directly. The SDK manages internal references.

**This eliminates the entire `ConversationReferenceStore` from the plan (T2.4 simplifies to a no-op).**

To send back to a chat we received from, we just remember `activity.conversation.id` from inbound and pass that string to `app.send`. The SDK's internal token cache + service URL routing handles everything.

For sanity we still track which conversations we've seen (for proactive-send hygiene) but it's a `Set<string>` not a `Map<string, ConversationReference>`.

### Q7: Error shape?

`app.send` returns a promise. On HTTP failure (4xx/5xx from Bot Framework backend), it throws. The thrown error appears to be a plain `Error` or extension; we'll need to inspect `.status` / `.statusCode` / `.message` and tolerate plain Error per EC-7. No specific error class is exported from the SDK.

## Bonus discoveries

### `AppActivityOptions.mentions.stripText: boolean`

The SDK has BUILT-IN mention stripping! Set in `AppOptions`:

```typescript
const app = new App({
  clientId, clientSecret, tenantId,
  activity: { mentions: { stripText: true } },
});
```

When `true`, the SDK automatically removes `<at>...</at>` tags from inbound `activity.text` BEFORE we see it. **D321 / EC-9 effectively becomes free** — we just set the option and we're done.

(We keep our own `stripTeamsMentions` helper for completeness, but it's only used if the SDK option fails for some reason.)

### `ConversationAccount.conversationType` typing

```typescript
readonly conversationType: 'personal' | 'groupChat' | Omit<string, 'personal' | 'groupChat'>;
```

Microsoft uses an open type — `'personal' | 'groupChat' | (other string)`. The "other string" in practice is `"channel"` for Teams channel posts. We compare with explicit string literal in our switch. EC-3 default arm still required.

## Plan impact summary

| Question | Answer | Plan change |
|---|---|---|
| HTTP handler | `httpServerAdapter` option + ExpressAdapter | T2.2 rewrites: no `createExpressHandler` factory; instead `getExpressAdapter()` returns the `ExpressAdapter` wired into user's app |
| Send | `app.send(conversationId, activity)` | T3.2 simplifies: no ref lookup, just `app.send(out.channel.id, { type: "message", text: chunk })` |
| Inbound | `app.on('activity', cb)` | T1.3: handler registration uses `'activity'` event |
| Initialize | `await app.start(port)` | T4.2: `connect()` calls `app.start()` |
| Raw body | Not needed | T5.1 EC-6: standard `express.json()` middleware; document this is the right path |
| ConversationReference | Not needed (string id only) | **T2.4 DROPS** to a no-op (or removed entirely); EC-5 LRU concern downgrades to a `Set` membership-test cap |
| Error shape | plain Error with optional `.status` | T4.1 keeps the EC-7 plain-error fallback |
| Mention stripping | SDK option `stripText: true` | D321 + EC-9: SDK does it; our helper becomes a fallback only |

## Decision: Update plan v1.1 → v1.2

Apply these adjustments to `gateway-teams-plan.md`:

1. T2.4 (ConversationReferenceStore) **DOWNGRADES** to optional `Set<string>` for tracking seen conversations + EC-5 cap on `Set` (1000) — but it's barely needed since `app.send` doesn't require it. We can DROP the file entirely if we don't have a reason to track sent-to conversations.
2. T2.2 (Express handler factory) **PIVOTS** to `getExpressAdapter()` — returns the SDK's `ExpressAdapter` wired into a user-supplied Express app.
3. T3.2 (sendMessage) **SIMPLIFIES** — no ref lookup, just call `app.send(out.channel.id, { type: "message", text: chunk })`.
4. T5.1 (example) **SIMPLIFIES** — wire `ExpressAdapter` once, SDK registers routes.

Plan v1.2 to follow.
