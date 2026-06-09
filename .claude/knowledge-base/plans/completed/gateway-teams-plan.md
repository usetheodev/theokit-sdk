# Plan: `@theokit/gateway-teams` v0.1.0 (Roadmap v1.4 #3)

> **Version 1.2** (2026-05-23, after Phase 0 SDK inspection) — Ship the Microsoft Teams adapter for `@theokit/gateway` using the **modern `@microsoft/teams.apps` SDK v2.x** (Microsoft-published, replaces the legacy `botbuilder`). v1 scope: 1:1 + group chat + channel posts + plain text. Both reference projects (`referencia/hermes-agent/plugins/platforms/teams/adapter.py` and `referencia/openclaw/extensions/msteams/`) standardize on the same SDK — we follow suit. Adapter exposes `BasePlatformAdapter` contract (D172); platform-specific extensions (Adaptive Cards, channel posts, replies) sit behind `event.teams.raw` escape hatch (D180). Env-gated example with Azure Bot Service registration walkthrough in README. Expected outcome: builders can `pnpm add @theokit/gateway-teams` and reach the enterprise default messaging platform — Slack ✅ + Discord ✅ + WhatsApp ✅ + Teams completes the production-grade triangle.

> **Edge-case review 2026-05-23 absorbed (v1.1):** 7 MUST FIX identified by `/edge-case-plan` were incorporated:
> - **EC-1** (T1.3) — constructor validates non-empty credentials (not just `!== undefined`).
> - **EC-2** (Phase 0 NEW) — verify `@microsoft/teams.apps@2.x` TypeScript API surface BEFORE writing handler/send code. Plan was assuming `app.process(req, res)` and `app.send(ref, activity)` from Hermes Python; TS SDK may differ. Without this gate the entire package is broken.
> - **EC-3** (T2.3) — switch on `conversationType` has `default` arm with warn (don't crash on system activities).
> - **EC-4** (T2.3) — `sender.id` fallback chain: `from.id ?? from.aadObjectId ?? "anonymous"`.
> - **EC-5** (T2.4) — `ConversationReferenceStore` capped at 1000 entries with FIFO eviction (memory-leak guard).
> - **EC-6** (T5.1) — README documents Express middleware order (depends on EC-2 output: does Teams SDK need rawBody?).
> - **EC-7** (T4.1) — `mapTeamsError` accepts plain `Error` (no `.status`) — network errors, programmer errors must not crash the mapper. Folds in EC-10 (SHOULD TEST) as a TDD entry.
>
> SHOULD TEST (EC-8, EC-9) folded into existing TDD lists; DOCUMENT (EC-11, EC-12) noted as README troubleshooting entries.

## Context

### What exists today

- 4 gateways shipped: `@theokit/gateway-telegram`, `@theokit/gateway-discord`, `@theokit/gateway-slack`, `@theokit/gateway-whatsapp` (D170-D314).
- `@theokit/gateway@0.2.0` — `BasePlatformAdapter` + closed `PlatformName = "telegram" | "discord" | "slack" | "whatsapp"`. Opens to include `"teams"` per the D308-style pattern that worked for WhatsApp.
- `examples/whatsapp-bot/` already demonstrates the Express + webhook + agent-loop pattern. Teams will mirror that shape closely.

### What's missing

- No Teams adapter. Microsoft 365 is the corporate default; Slack adoption is real but Teams reaches enterprises that won't touch Slack. Auto-shipping a Teams adapter unlocks the B2B install base of the SDK.
- Roadmap v1.4 #3 in `CLAUDE.md` lists Teams as the next gateway after WhatsApp.

### Evidence motivating the work

- `referencia/hermes-agent/plugins/platforms/teams/adapter.py` (1188 lines) — battle-tested adapter on `microsoft-teams-apps` (Python, but maps 1:1 to JS package `@microsoft/teams.apps`). Documents the SDK as authentication + activity processor + proactive-send mechanism.
- `referencia/openclaw/extensions/msteams/` (~30k lines across the whole channel plugin) — production-grade TS implementation on `@microsoft/teams.apps@^2.0` + `@microsoft/teams.api@^2.0` + Express. Confirms our SDK choice.
- Both references run an HTTP server with a single `POST /api/messages` endpoint that the SDK fills with routing logic; JWT validation, replay protection, and signature verification all done by the SDK.

### Reference patterns we'll borrow

| Pattern | Source | Lesson |
|---|---|---|
| `@microsoft/teams.apps` v2 SDK | Hermes + OpenClaw | Modern, Microsoft-supported, replaces botbuilder. No alternative worth picking. |
| Express bridge for HTTP | OpenClaw | Already using Express in WhatsApp example; consistent across our gateways. |
| ConversationReference store (Map by chatId) | Hermes | Required to send proactive messages back to a conversation we received from. Captured on inbound. |
| Auth: Azure AD client credentials (TENANT/CLIENT_ID/CLIENT_SECRET) | Both | SDK handles JWT signing; we just pass the three env vars. |
| Channel type mapping: personal/groupChat/channel | Both | SDK exposes `conversation.conversationType`; map to our `"dm" | "group"` (channel posts → `"group"` with `topicId` = the channel id). |
| Strip `<at>Bot</at>` mentions before normalizing | Both | Teams sends mentions as HTML-ish tags inline; clean for downstream consumers. |

## Objective

**Done = a user can `pnpm add @theokit/gateway-teams`, register an Azure Bot Service app, set 3 env vars, and have their `@theokit/sdk` agent receive Teams 1:1/group/channel messages + respond.**

Measurable goals:

1. Package `@theokit/gateway-teams` v0.1.0 shippable via npm (publint + attw clean).
2. `TeamsAdapter` extends `BasePlatformAdapter`; passes `instanceof` checks; never throws on platform errors per D172 contract.
3. Webhook ingress: `POST /api/messages` wired via Express bridge into `@microsoft/teams.apps`.
4. Inbound normalization: 1:1, group chat, channel post → `TeamsMessageEvent` with portable fields + `event.teams.raw` escape hatch.
5. Outbound: `adapter.sendMessage` calls `App.send(conversationReference, activity)` with text split at 8000 chars.
6. `PlatformName` union extended to include `"teams"`.
7. `examples/teams-bot/` scaffold + README with 8-step Azure Bot Service registration walkthrough; env-gated live smoke.
8. `theo-opendocs` cookbook recipe auto-generated.
9. Drift checker clean.
10. SDK telegram-pro dogfood: 44/44 PASS (zero regression — plan only adds new package).

## ADRs

### D315 — SDK = `@microsoft/teams.apps@^2.0` + `@microsoft/teams.api@^2.0`
- **Decision:** Use the modern Teams Apps SDK v2 (Microsoft-published, 2024+). NOT the legacy `botbuilder-services` SDK.
- **Rationale:** Both Hermes (Python `microsoft-teams-apps`) and OpenClaw (TS `@microsoft/teams.apps@2.0.11`) chose this. The legacy `botbuilder` SDK is in maintenance mode; Microsoft directs new projects to the Teams Apps SDK. Switching later is more expensive than starting right.
- **Consequences:** Peer deps on `@microsoft/teams.apps` + `@microsoft/teams.api`. Both are large (~30 MB combined) but standard for the ecosystem. SDK does JWT validation, signature verification, activity routing, and conversation reference capture — we don't reimplement any of that.

### D316 — HTTP server: Express (consistent with WhatsApp Cloud example)
- **Decision:** Adapter exposes Express bridge helpers + an `App` instance. The user wires `app.use(express.json())` + `app.post("/api/messages", adapter.expressHandler())` in their own HTTP server.
- **Rationale:** Same pattern as our WhatsApp Cloud backend (D306). Doesn't force a transport choice (Express vs Hono vs Cloudflare Workers). OpenClaw uses Express; we match. Hermes uses aiohttp (Python — N/A).
- **Consequences:** User owns the HTTP server lifecycle. Adapter ships `createExpressHandler(adapter)` helper. Setup docs are explicit about webhook URL requirement (similar to WhatsApp).

### D317 — `ConversationReference` store: in-memory `Map<chatId, ConversationReference>`
- **Decision:** Adapter holds a `Map<string, ConversationReference>` keyed by the chat id. Populated on every inbound activity; consulted on outbound `send`.
- **Rationale:** Proactive send (replying to a conversation we received from) MUST have a `ConversationReference` per Teams Bot Framework. Persisting it to disk would survive restarts but adds I/O surface; v1 keeps it in-memory and documents that the bot must receive at least one message before it can reply (which is intrinsically true — there's no "send unsolicited to new user" path in v1 anyway).
- **Consequences:** Restart loses the reference map → bot can't reply to a chat that hasn't sent a fresh inbound. Acceptable v1 trade-off; v0.2 may add disk persistence via `$THEOKIT_HOME/teams-conv-refs.json` if demand emerges.

### D318 — Channel type mapping
- **Decision:**
  - `conversation.conversationType === "personal"` → `channel.type = "dm"`, `channel.id = conversationId`
  - `conversation.conversationType === "groupChat"` → `channel.type = "group"`, `channel.id = conversationId`
  - `conversation.conversationType === "channel"` → `channel.type = "group"`, `channel.id = conversationId`, `channel.topicId = channelId`
- **Rationale:** Our `BaseMessageEvent.channel.type` is `"dm" | "group" | "thread"`. Teams channels are conceptually "groups with a topic dimension"; mapping them to `"group"` + `topicId` is the cleanest fit. The `topicId` carries the actual channel id so callers can reply in the same channel.
- **Consequences:** Caller distinguishing channel-post vs group-chat needs `event.teams.conversationType === "channel"`. Documented in README.

### D319 — Bot Framework JWT validation delegated to SDK
- **Decision:** The SDK validates every inbound JWT (signature, audience = client id, issuer = Bot Framework). We do NOT reimplement.
- **Rationale:** Bot Framework auth is complex (JWKS rotation, multi-tenant signers). The SDK is Microsoft-maintained — best place for this. Reimplementing creates security risk and divergence.
- **Consequences:** If SDK has a bug in JWT validation, we inherit it. Trade-off accepted — same reasoning as the slack adapter delegating to `@slack/bolt`.

### D320 — Adaptive Cards: escape hatch only in v0.1
- **Decision:** v0.1 ships plain-text inbound + outbound. Adaptive Cards are visible via `event.teams.raw` (the full activity) and `adapter.getApp()` (the SDK App) escape hatch — power users can build cards directly with the SDK.
- **Rationale:** Adaptive Cards have a rich schema (TextBlock, ColumnSet, Action.Submit, etc.). First-class support means typing the entire Adaptive Card JSON Schema, which we'd duplicate. Deferring to v0.2 lets us validate adoption before investing.
- **Consequences:** README documents the escape hatch. v0.2 may add `adapter.sendCard(channel, card)` once we see real demand.

### D321 — Mention stripping: strip `<at>Bot</at>` tags before text normalization
- **Decision:** Teams sends mentions inline as HTML-like tags (`<at>Bot Name</at>`). Normalize by stripping the tags AND the bot's display name when present, BEFORE setting `event.text`.
- **Rationale:** Downstream consumers (agent loop) shouldn't see XML soup. Both Hermes and OpenClaw strip mentions. The `event.teams.raw.entities` field preserves the raw mention list for advanced use cases.
- **Consequences:** New helper `stripTeamsMentions(text, botMri?)`. Test with sample activities from `microsoft-teams.apps` docs.

### D322 — Outbound text limit: 8000 chars (conservative vs SDK 28000)
- **Decision:** `splitForTeams` chunks at 8000 chars max — well under the Teams hard limit (~28k per Hermes constant) but consistent with reasonable readability and clipboard-safe excerpts.
- **Rationale:** Hermes uses 28000 (the Teams hard limit), but at that length messages are walls of text Teams renders badly. 8000 is roughly 2-3 screens of text on desktop; matches our other adapters' "split for readability" instinct (Slack 4000, WhatsApp 4096). 8000 is also conservative against future Microsoft tightening of the limit.
- **Consequences:** Long agent replies split into multiple posts. Sequence preserved (we send in order, await each ack).

### D323 — Status receipts: NOT EMITTED in v0.1
- **Decision:** Teams Bot Framework emits "delivered" via the `typing` indicator pattern, but not a clean `delivered`/`read` callback. v0.1 ships `onInbound` only; `onStatusReceipt` is N/A.
- **Rationale:** Teams doesn't have a clean status-receipt model — `messageReaction` events exist but mean something different (user reacted with an emoji). Hermes doesn't expose status receipts for Teams. OpenClaw doesn't either. We follow.
- **Consequences:** `TeamsAdapter` does NOT implement `onStatusReceipt`. Our `WhatsAppAdapter` had it; Teams doesn't. Document the gap.

### D324 — Initial version `0.1.0`
- **Decision:** Same as siblings (D171, D314): pre-1.0 contract, breaking changes allowed within 0.x.
- **Rationale:** Bot Framework + Teams API surface change quarterly. We need room.
- **Consequences:** Standard `0.x` semver.

### D325 — `PlatformName` extends to `"teams"`
- **Decision:** Open the `@theokit/gateway` `PlatformName` union to include `"teams"`. Bump gateway to 0.3.0. Add `TeamsMessageEvent` variant.
- **Rationale:** Same pattern WhatsApp followed (D308). Additive; existing consumers unaffected.
- **Consequences:** Minor bump on `@theokit/gateway` from 0.2.0 → 0.3.0.

### D326 — Express handler factory (instead of bundled server)
- **Decision:** Adapter exposes `adapter.createExpressHandler()` — returns a request handler the user mounts at their chosen path. We do NOT spawn an HTTP server.
- **Rationale:** Same reasoning as D306 (WhatsApp). User may run inside Next.js, Hono, Lambda, etc. A handler-factory is portable; a server is opinionated.
- **Consequences:** Setup docs walk through wiring `app.post("/api/messages", adapter.createExpressHandler())`. Example provides a reference Express server.

## Dependency Graph

```
Phase 0 (verify SDK API surface — EC-2 absorbed)
   │
   ▼
Phase 1 (package skeleton + types + adapter)
   │
   ├──▶ Phase 2 (Webhook + inbound)         ───┐
   │                                              │
   ├──▶ Phase 3 (Outbound + send)             ───┤ parallel after Phase 1
   │                                              │
   └──▶ Phase 4 (Errors + lifecycle)          ───┘
              │
              ▼
       Phase 5 (Example + env-gated smoke)
              │
              ▼
       Phase 6 (Docs site update)
              │
              ▼
       Phase 7 (Dogfood + commit)
```

- **Phase 0** is a **hard prerequisite** (EC-2): without verifying the real `@microsoft/teams.apps@2.x` TS API surface, downstream pseudo-code for `app.process`/`app.send` may not match reality and the package is dead-on-arrival.
- **Phase 1** gates everything else.
- **Phases 2/3/4** are independent after types land.
- **Phase 5** depends on a working end-to-end (Phases 2 + 3).
- **Phase 6** depends on Phase 5 (cookbook generator reads `examples/teams-bot/`).
- **Phase 7** final.

---

## Phase 0: Verify SDK API surface (EC-2 absorbed)

### T0.1 — Inspect `@microsoft/teams.apps@2.x` TypeScript public API

#### Objective
Confirm the real method names + signatures before Phase 1-3 write code against them. Plan was drafted from Hermes (Python `microsoft-teams-apps`); TS package `@microsoft/teams.apps@2.x` MAY name methods differently.

#### Evidence
Plan tasks T2.2 (Express handler), T3.2 (sendMessage), T4.2 (connect) all assume `app.process(req, res)`, `app.send(ref, activity)`, and `app.initialize()`. If TS SDK names them `app.handle` / `app.sendActivity` / something else, ALL the code that touches the SDK is broken.

#### Files to edit
```
(read-only inspection; no edits in this task)
.claude/knowledge-base/plans/gateway-teams-sdk-inspection.md (NEW — write findings)
```

#### Deep file dependency analysis
- `node_modules/@microsoft/teams.apps/dist/index.d.ts` (after `pnpm view @microsoft/teams.apps@^2 dist` + temporary install) — read every public method on the `App` class.
- `referencia/openclaw/extensions/msteams/src/channel.runtime.ts` — OpenClaw is already TS and uses this SDK. Grep their usage.
- `referencia/openclaw/extensions/msteams/src/channel.message-adapter.ts` — same.

#### Deep Dives
Specific questions to answer in the inspection file:

1. **HTTP handler method**: is it `app.process(req, res)` or `app.handle(req, res)` or `app.handler` (property) or `app.adapter.processActivity(...)`?
2. **Send method**: is it `app.send(ref, activity)` or `app.sendActivity(ref, activity)` or `app.sendToConversation(ref, ...)`? Does it return the new activity id?
3. **Inbound subscription**: is the handler registration `app.on_message(fn)`, `app.onMessage(fn)`, `app.on("message", fn)`, `app.message(fn)`?
4. **Initialization**: is it `app.initialize()` (async), `app.start()`, or implicit on first request?
5. **Raw body requirement**: does the HTTP handler need raw `Buffer` body, or does it accept the already-parsed JSON? (EC-6 dependency.)
6. **`ConversationReference` extraction**: is there a helper (`getConversationReference(activity)`)? Or do we build manually?
7. **Error shape**: when `app.send` fails, does it throw an `Error` with `.statusCode`? `.status`? `.error.code`? Plain string message?

#### Tasks
1. `pnpm view @microsoft/teams.apps@^2 dist` to confirm latest version + dist tarball URL.
2. Either: `cd /tmp && npm install @microsoft/teams.apps@^2 @microsoft/teams.api@^2` AND inspect `.d.ts` files, OR: grep `referencia/openclaw/extensions/msteams/src/*.ts` for `app.send|app.process|app.on|app.handle|sendActivity|onMessage`.
3. Write findings to `.claude/knowledge-base/plans/gateway-teams-sdk-inspection.md` covering all 7 questions above.
4. Update plan's Phase 1-4 pseudo-code to match the real API names. If a name differs, edit the affected `### T{N}.{M}` block inline.

#### TDD
```
RED:     N/A (read-only inspection)
GREEN:   gateway-teams-sdk-inspection.md exists with all 7 questions answered concretely (not "unknown")
REFACTOR: Update Phase 1-4 pseudo-code in this plan to match findings
VERIFY:  Inspection file exists + Phase 1-4 use real method names
```

#### Acceptance Criteria
- [ ] All 7 questions in Deep Dives have concrete answers (method name + signature, not "TBD")
- [ ] Plan tasks T2.2, T3.2, T4.2 updated with correct API names
- [ ] EC-6 raw-body question definitively answered

#### DoD
- [ ] Inspection complete; no other phase starts without it

---

## Phase 1: Package skeleton + types + adapter

### T1.1 — Workspace package scaffold

#### Objective
Create `packages/gateway-teams/` mirroring the gateway-whatsapp/ skeleton (`package.json`, `tsup.config.ts`, `tsconfig.json`, `vitest.config.ts`, README placeholder, CHANGELOG).

#### Evidence
Sibling adapters all use the same skeleton (D171). Diverging would create maintenance burden and diverge from publint/attw config already validated.

#### Files to edit
```
packages/gateway-teams/package.json (NEW)
packages/gateway-teams/tsup.config.ts (NEW)
packages/gateway-teams/tsconfig.json (NEW)
packages/gateway-teams/vitest.config.ts (NEW)
packages/gateway-teams/CHANGELOG.md (NEW)
packages/gateway-teams/README.md (NEW — placeholder)
packages/gateway-teams/src/index.ts (NEW — empty barrel)
```

#### Deep file dependency analysis
- Template directly from `packages/gateway-whatsapp/package.json` — adjust name, peers (`@microsoft/teams.apps` + `@microsoft/teams.api`; both required peer deps, NOT optional since adapter doesn't work without them — different from WhatsApp's optional `whatsapp-web.js`).
- `tsup.config.ts`, `tsconfig.json`, `vitest.config.ts` identical shape.
- Workspace auto-includes via `packages/*` glob.

#### Deep Dives
- `peerDependencies`: `@theokit/gateway: workspace:^`, `@theokit/sdk: workspace:^`, `@microsoft/teams.apps: ^2.0.0`, `@microsoft/teams.api: ^2.0.0`. Express is OPTIONAL since the user provides their own server (the adapter only exposes the handler factory).
- `peerDependenciesMeta`: none optional (Teams SDK is required to function).
- `sideEffects: false` from the start (publint suggestion absorbed early).

#### Tasks
1. Copy `gateway-whatsapp/package.json` → `gateway-teams/package.json`. Edit: name, description, peers.
2. Copy tsup/tsconfig/vitest configs unchanged.
3. Create placeholder `README.md` + `CHANGELOG.md`.
4. Create empty `src/index.ts` (`export type {};`).
5. Run `pnpm install` at workspace root to register package.

#### TDD
```
RED:     test_package_resolves — `pnpm list @theokit/gateway-teams` shows it
GREEN:   Package skeleton in workspace
REFACTOR: None expected
VERIFY:  pnpm install && pnpm list @theokit/gateway-teams
```

#### Acceptance Criteria
- [ ] `packages/gateway-teams/` directory exists with 7 files
- [ ] `pnpm install` succeeds at root
- [ ] `pnpm --filter @theokit/gateway-teams build` works (empty index emits empty dist)

#### DoD
- [ ] Skeleton commitable
- [ ] Workspace recognizes new package

---

### T1.2 — Extend `PlatformName` union + add `TeamsMessageEvent`

#### Objective
Open the `MessageEvent` discriminated union to include `"teams"`.

#### Evidence
Same pattern WhatsApp used (D308). Closed union → adapter must extend before emitting events.

#### Files to edit
```
packages/gateway/src/types/message-event.ts — extend PlatformName + add TeamsMessageEvent
packages/gateway/src/index.ts — export TeamsMessageEvent
packages/gateway/package.json — bump 0.2.0 → 0.3.0
packages/gateway/CHANGELOG.md — record bump
packages/gateway/tests/types/message-event.test.ts — add teams variant test + extend exhaustive switch
```

#### Deep file dependency analysis
- `message-event.ts` exports `PlatformName` (closed union) + variants. Consumers narrow via `switch (event.platform)`.
- All sibling adapters depend on this type. Minor bump is safe (additive only).
- `tests/types/message-event.test.ts` has an exhaustive-switch test (already extended for whatsapp); adding teams keeps it passing without rebuilds.

#### Deep Dives
- `TeamsMessageEvent` shape:
  ```typescript
  export interface TeamsMessageEvent extends BaseMessageEvent {
    readonly platform: "teams";
    readonly teams: {
      /** Teams activity id (`messageActivity.id`). */
      readonly activityId: string;
      /** Teams conversation id. */
      readonly conversationId: string;
      /** "personal" | "groupChat" | "channel" — Teams native field. */
      readonly conversationType: "personal" | "groupChat" | "channel";
      /** Tenant id of the sender (Azure AD). */
      readonly tenantId?: string;
      /** Channel id (only when conversationType === "channel"). */
      readonly channelId?: string;
      /** Team id (only when conversationType === "channel"). */
      readonly teamId?: string;
      /** Raw Teams `MessageActivity` — narrowed by the adapter package. */
      readonly raw: unknown;
    };
  }
  ```

#### Tasks
1. Add `"teams"` to `PlatformName` union.
2. Add `TeamsMessageEvent` interface.
3. Add to the `MessageEvent` union export.
4. Update `@theokit/gateway/package.json` to `0.3.0`.
5. Add CHANGELOG entry under `[Unreleased]`.
6. Update `tests/types/message-event.test.ts` exhaustive switch + add a `makeTeamsEvent` helper.

#### TDD
```
RED:     test_platform_name_includes_teams — `const _p: PlatformName = "teams"` typechecks
RED:     test_teams_event_narrows — switch on `event.platform === "teams"` narrows access to `event.teams.conversationType`
RED:     test_exhaustive_switch_covers_teams — extends the existing exhaustive test to include teams
GREEN:   Types compile + tests pass
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway typecheck && pnpm --filter @theokit/gateway test
```

#### Acceptance Criteria
- [ ] `PlatformName` includes `"teams"`
- [ ] `TeamsMessageEvent` exported from `@theokit/gateway`
- [ ] Sibling adapters (whatsapp, slack, telegram, discord) still typecheck
- [ ] CHANGELOG entry added (0.3.0)

#### DoD
- [ ] Type opens cleanly
- [ ] Zero regression in sibling packages

---

### T1.3 — `TeamsAdapter` class extends `BasePlatformAdapter`

#### Objective
Public-facing adapter. Holds the `@microsoft/teams.apps` `App` instance + `ConversationReference` store + lifecycle methods.

#### Evidence
This is the public surface — all docs, examples, types flow through here.

#### Files to edit
```
packages/gateway-teams/src/adapter.ts (NEW)
packages/gateway-teams/src/index.ts (extend barrel — re-export Adapter + types)
packages/gateway-teams/src/conversation-ref-store.ts (NEW — Map wrapper)
```

#### Deep file dependency analysis
- `adapter.ts` imports `App` + `ActivityContext` + `MessageActivity` from `@microsoft/teams.apps`.
- `conversation-ref-store.ts` is a tiny module — `Map<string, ConversationReference>` with a method `recordFromActivity(activity)` and `lookup(chatId)`.
- `index.ts` exports: `TeamsAdapter`, `TeamsAdapterOptions`, `TeamsMessageEvent` (re-export from gateway).

#### Deep Dives
- `TeamsAdapterOptions`:
  ```typescript
  export interface TeamsAdapterOptions {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly tenantId: string;
    /** D321: bot MRI (Teams Resource Identifier) for mention stripping. Optional but recommended. */
    readonly botMri?: string;
    /** Display name shown when stripping `<at>Bot</at>` tags. */
    readonly botDisplayName?: string;
  }
  ```
- Constructor:
  1. **(EC-1 absorbed)** Validate the three required options are **non-empty strings**, not just `!== undefined`. Empty string is a common `.env`-typo failure mode:
     ```typescript
     for (const [k, v] of Object.entries({ clientId, clientSecret, tenantId })) {
       if (typeof v !== "string" || v.length === 0) {
         throw new ConfigurationError(`TeamsAdapter: ${k} is required and must be non-empty`, { code: "missing_api_key" });
       }
     }
     ```
     Throws **at construction**, not at `connect()` — fail fast.
  2. Construct `new App({ client_id, client_secret, tenant_id })` from `@microsoft/teams.apps` (exact method names from Phase 0 inspection).
  3. Register `app.on_message` handler — calls private `_handleInbound(ctx)`.
  4. Initialize empty `ConversationReferenceStore`.
- `_handleInbound(ctx)`:
  1. Record conversation reference (D317).
  2. Build `TeamsMessageEvent` (T2.3 normalization).
  3. Call user's `handler(event)` if set.
- `sendMessage(out)`:
  1. Resolve `ConversationReference` from store by `out.channel.id`. If missing, return `{ ok: false, error: { code: "invalid_request", message: "No conversation reference for ${chatId} — bot must receive a message first." } }`.
  2. Split text via `splitForTeams` (T3.2).
  3. Send each chunk via `app.send(ref, { type: "message", text: chunk })`.
  4. Return last activity id as `messageId`.

#### Tasks
1. Create `conversation-ref-store.ts` (Map wrapper, ~50 lines).
2. Create `adapter.ts` extending `BasePlatformAdapter`.
3. Implement constructor + SDK App init.
4. Implement `connect`, `disconnect`, `sendMessage`, `onInbound` (delegate to internal state).
5. Add `getApp(): App | undefined` escape hatch (mirrors `SlackAdapter.getApp`).
6. Add `createExpressHandler()` method (returns `(req, res) => Promise<void>` that defers to `app.process(req, res)`).
7. Update `index.ts` barrel.

#### TDD
```
RED:     test_adapter_is_base_platform_adapter — `new TeamsAdapter() instanceof BasePlatformAdapter`
RED:     test_adapter_platform_is_teams — `adapter.platform === "teams"`
RED:     test_adapter_oninbound_replaces (EC-H) — second call replaces first
RED:     test_adapter_send_without_conv_ref_returns_error — no `Map` entry → `{ ok: false, code: "invalid_request" }`
RED:     test_adapter_send_with_empty_text_returns_error — `{ ok: false, code: "empty_text" }`
RED:     test_adapter_constructor_validates_non_empty (EC-1) — passing `clientId: ""` / `undefined` throws `ConfigurationError(missing_api_key)` AT CONSTRUCTION (not at connect)
RED:     test_adapter_conv_ref_store_recorded_on_inbound — `Map` has entry after `_handleInbound`
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-teams test
```

#### Acceptance Criteria
- [ ] `TeamsAdapter` extends `BasePlatformAdapter`
- [ ] Constructor validates 3 required options
- [ ] `instanceof BasePlatformAdapter` is true
- [ ] All 7 tests above pass
- [ ] File ≤ 350 lines

#### DoD
- [ ] Adapter implements full contract
- [ ] SDK initialization isolated (testable with a fake App)

---

## Phase 2: Webhook + inbound normalization

### T2.1 — `createTeamsApp(opts)` SDK helper

#### Objective
Centralize the `@microsoft/teams.apps` `App` construction in a tiny function so tests can inject a fake App.

#### Evidence
Hermes and OpenClaw both wrap App construction — testability + a single place to configure `ClientOptions.headers` (set `User-Agent: theokit-gateway-teams/0.1.0`).

#### Files to edit
```
packages/gateway-teams/src/internal/teams-app.ts (NEW)
```

#### Deep file dependency analysis
- `teams-app.ts` exports a single function `createTeamsApp(opts): App` that wraps `new App({...})`.
- `adapter.ts` consumes it. Test seam injects a fake.

#### Tasks
1. Create `teams-app.ts`.
2. Implement factory: validate args, set `ClientOptions.headers.User-Agent = "theokit-gateway-teams/0.1.0"`, return `App`.

#### TDD
```
RED:     test_create_teams_app_sets_user_agent — App receives "theokit-gateway-teams/<version>" header
RED:     test_create_teams_app_throws_on_missing_credentials
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-teams test teams-app.test.ts
```

#### Acceptance Criteria
- [ ] Pure function (no side effects)
- [ ] User-Agent set correctly

#### DoD
- [ ] Helper stable; consumed by adapter

---

### T2.2 — Express handler factory

#### Objective
`adapter.createExpressHandler()` returns a handler the user mounts at `POST /api/messages`.

#### Evidence
D326. WhatsApp follows this exact pattern (D306).

#### Files to edit
```
packages/gateway-teams/src/adapter.ts — add createExpressHandler()
```

#### Deep file dependency analysis
- Method on `TeamsAdapter`.
- Returns `(req: ExpressRequest, res: ExpressResponse) => Promise<void>`.
- Delegates to `app.process(req, res)` (Teams SDK has a built-in HTTP processor).

#### Deep Dives
- Implementation:
  ```typescript
  createExpressHandler() {
    return async (req: ExpressRequest, res: ExpressResponse) => {
      const app = this.app;
      if (app === undefined) {
        res.status(500).json({ error: "TeamsAdapter not connected." });
        return;
      }
      // app.process delegates to SDK route handler (JWT + signature + activity dispatch)
      await app.process(req as any, res as any);
    };
  }
  ```
- Don't require `express` as a peer — the handler is shape-compatible with any framework that hands `(req, res)`.

#### Tasks
1. Add `createExpressHandler()` to `adapter.ts`.
2. Defensive `if (this.app === undefined)` guard.

#### TDD
```
RED:     test_express_handler_throws_500_when_not_connected
RED:     test_express_handler_delegates_to_app_process — fake app's `process` is called with (req, res)
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-teams test adapter.test.ts
```

#### Acceptance Criteria
- [ ] Handler is `async (req, res) => Promise<void>`
- [ ] No `express` import (peer-free)

#### DoD
- [ ] Handler usable from any framework

---

### T2.3 — Inbound normalization (MessageActivity → TeamsMessageEvent)

#### Objective
Convert `@microsoft/teams.api` `MessageActivity` into our portable `TeamsMessageEvent`.

#### Evidence
Hermes `_on_message` does the same translation in Python. OpenClaw has a `channel.message-adapter.ts`. We do it once.

#### Files to edit
```
packages/gateway-teams/src/normalize.ts (NEW)
```

#### Deep file dependency analysis
- `normalize.ts` exports `normalizeTeamsActivity(activity, botMri?, botDisplayName?): TeamsMessageEvent`.
- `adapter.ts` consumes it in `_handleInbound`.

#### Deep Dives
- Channel mapping (D318). **(EC-3 absorbed)** default arm prevents crash on system / typing / conversationUpdate activities that may not carry `conversationType`:
  ```typescript
  const convId = activity.conversation?.id ?? "unknown";
  switch (activity.conversation?.conversationType) {
    case "personal":    return { type: "dm", id: convId };
    case "groupChat":   return { type: "group", id: convId };
    case "channel":     return { type: "group", id: convId, topicId: extractChannelId(activity) };
    default:
      // EC-3: unknown conversationType (old client / system message). Warn once + degrade to dm.
      console.warn("[teams] unknown conversationType:", activity.conversation?.conversationType);
      return { type: "dm", id: convId };
  }
  ```
- Mention stripping (D321): strip `<at>Bot</at>` + bot display name when present. **EC-9 (SHOULD TEST) absorbed**: regex tolerates HTML attributes (`<at type="user" mri="...">Bot</at>`):
  ```typescript
  function stripTeamsMentions(text: string, botMri?: string, botDisplayName?: string): string {
    // `<at ATTRS>NAME</at>` — strip outer tags (with optional attributes), keep inner text.
    let cleaned = text.replace(/<at(?:\s+[^>]*)?>([^<]*)<\/at>/gi, "$1");
    if (botDisplayName !== undefined) {
      const escaped = botDisplayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      cleaned = cleaned.replace(new RegExp(escaped, "g"), "").replace(/\s+/g, " ").trim();
    }
    return cleaned;
  }
  ```
- Sender mapping. **(EC-4 absorbed)** fallback chain — `activity.from.id` may be undefined for system activities or when only `aadObjectId` is present. Downstream consumers use `sender.id` as a session-key, so undefined breaks `Agent.getOrCreate`:
  ```typescript
  sender: {
    id: activity.from?.id ?? activity.from?.aadObjectId ?? "anonymous",
    displayName: activity.from?.name,
  }
  ```
- `receivedAt`: `activity.timestamp` (ISO string) → `Date.parse() || Date.now()`.

#### Tasks
1. Create `normalize.ts`.
2. Implement `stripTeamsMentions(text, botMri?, botDisplayName?)`.
3. Implement `normalizeTeamsActivity(activity, botMri?, botDisplayName?): TeamsMessageEvent`.
4. Export both from barrel.

#### TDD
```
RED:     test_normalize_personal_chat_to_dm — activity with conversationType="personal" → channel.type="dm"
RED:     test_normalize_group_chat_to_group — conversationType="groupChat" → channel.type="group"
RED:     test_normalize_channel_post_to_group_with_topic — conversationType="channel" → channel.type="group" + topicId
RED:     test_normalize_unknown_conversation_type_defaults_to_dm (EC-3) — conversationType=undefined → channel.type="dm" + console.warn
RED:     test_normalize_sender_falls_back_to_aad (EC-4) — `from.id` undefined but `from.aadObjectId="aad-1"` → sender.id="aad-1"
RED:     test_normalize_sender_anonymous_when_no_id (EC-4) — `from` undefined entirely → sender.id="anonymous"
RED:     test_strip_mentions_removes_at_tags — `<at>Bot</at> hi` → `Bot hi` (when botDisplayName not set)
RED:     test_strip_mentions_handles_html_attributes (EC-9) — `<at type="user" mri="...">Bot</at> hi` → cleaned (regex tolerates attrs)
RED:     test_strip_mentions_removes_bot_display_name — `<at>Bot</at> hi` with botDisplayName="Bot" → `hi`
RED:     test_normalize_preserves_raw_activity — `event.teams.raw` is the input activity
RED:     test_normalize_handles_empty_text — empty body → `text: ""`
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-teams test normalize.test.ts
```

#### Acceptance Criteria
- [ ] All channel types mapped correctly
- [ ] Mention stripping deterministic
- [ ] `event.teams.raw` carries the full activity

#### DoD
- [ ] Normalizer pure (no I/O)
- [ ] Tests use static fixtures (sample MessageActivity JSON)

---

### T2.4 — Conversation reference store

#### Objective
Tiny `Map<chatId, ConversationReference>` wrapper. Records on inbound; consulted on outbound.

#### Evidence
Hermes does this in `_conv_refs: Dict[str, Any]`. Required by Teams Bot Framework — proactive send needs a `ConversationReference`.

#### Files to edit
```
packages/gateway-teams/src/conversation-ref-store.ts (NEW — created in T1.3 stub; this task fills in real logic)
```

#### Deep file dependency analysis
- `conversation-ref-store.ts` exports `ConversationReferenceStore` class.
- `adapter.ts` instantiates it.

#### Deep Dives
- API. **(EC-5 absorbed)** capped at 1000 entries with FIFO eviction to prevent memory leak in long-running bots (5k+ unique chats over months → unbounded growth without cap):
  ```typescript
  const MAX_CONVERSATION_REFS = 1000;

  export class ConversationReferenceStore {
    private readonly map = new Map<string, ConversationReference>(); // insertion-order preserved
    recordFromActivity(activity: MessageActivity): void {
      const ref = extractConversationReference(activity);
      const chatId = activity.conversation?.id;
      if (chatId === undefined || ref === undefined) return;
      // EC-5: drop oldest when at cap. Map iteration order = insertion order.
      if (this.map.size >= MAX_CONVERSATION_REFS && !this.map.has(chatId)) {
        const firstKey = this.map.keys().next().value;
        if (firstKey !== undefined) this.map.delete(firstKey);
      }
      // Re-insert to bump position (LRU-on-write).
      this.map.delete(chatId);
      this.map.set(chatId, ref);
    }
    lookup(chatId: string): ConversationReference | undefined { return this.map.get(chatId); }
    /** Test seam. */
    get size(): number { return this.map.size; }
    /** Test seam. */
    clear(): void { this.map.clear(); }
  }
  ```
- `recordFromActivity` extracts the `ConversationReference` from the activity via SDK helper (`getConversationReference(activity)` if exposed by `@microsoft/teams.api` per Phase 0 inspection; otherwise we build manually from `activity.conversation` + `activity.from` + `activity.recipient` + `activity.channelId` + `activity.serviceUrl`).
- **Trade-off documented**: bots serving more than 1000 unique chats lose oldest refs first. Affected user needs to send a new inbound before bot can reply — acceptable for v0.1 (rare in practice; v0.2 may add disk persistence per D317).

#### Tasks
1. Create `conversation-ref-store.ts`.
2. Implement `ConversationReferenceStore`.
3. Test with synthetic activities.

#### TDD
```
RED:     test_conv_ref_store_starts_empty
RED:     test_conv_ref_store_records_from_activity
RED:     test_conv_ref_store_lookup_returns_undefined_for_unknown
RED:     test_conv_ref_store_overwrites_for_same_chat_id — second record replaces
RED:     test_conv_ref_store_caps_at_1000_entries (EC-5) — inserting 1001st chatId drops the oldest
RED:     test_conv_ref_store_lru_on_write (EC-5) — re-inserting an existing chatId bumps it to "newest" position
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-teams test conversation-ref-store.test.ts
```

#### Acceptance Criteria
- [ ] Idempotent on repeat insert (overwrites, doesn't append)
- [ ] No I/O

#### DoD
- [ ] Store used by `_handleInbound`

---

## Phase 3: Outbound + send

### T3.1 — `splitForTeams` 8000-char splitter

#### Objective
Split long messages at 8000 chars (D322), preserving markdown / line breaks.

#### Evidence
Mirrors `splitForSlack` (4000), `splitForTelegram` (4096), `splitForWhatsApp` (4096). Same algorithm, different limit.

#### Files to edit
```
packages/gateway-teams/src/split.ts (NEW)
```

#### Deep file dependency analysis
- `split.ts` exports `splitForTeams(text: string): string[]`.
- `adapter.sendMessage` consumes it.

#### Deep Dives
- Algorithm: try `\n\n` → `\n` → `. ` → hard cut at 8000.
- UTF-16 surrogate-pair guard: don't split mid-emoji.
- Empty-part filter at end (EC-8 lesson from WhatsApp).

#### Tasks
1. Create `split.ts` adapting WhatsApp's version.
2. Adjust limit to 8000.
3. Keep UTF-16 surrogate guard + empty-part filter.

#### TDD
```
RED:     test_split_under_8000_returns_single
RED:     test_split_breaks_at_double_newline
RED:     test_split_breaks_at_single_newline_when_no_double
RED:     test_split_hard_cut_at_8000_when_no_boundary
RED:     test_split_preserves_surrogate_pairs
RED:     test_split_filters_empty_parts
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-teams test split.test.ts
```

#### Acceptance Criteria
- [ ] 6 splitter tests pass
- [ ] No part exceeds 8000 chars

#### DoD
- [ ] Splitter integrated into sendMessage

---

### T3.2 — `TeamsAdapter.sendMessage` end-to-end

#### Objective
Tie everything together: split → lookup conversation ref → send via `App.send`.

#### Evidence
This is the public outbound path. Without this, the adapter receives but can't reply.

#### Files to edit
```
packages/gateway-teams/src/adapter.ts — extend sendMessage
```

#### Deep file dependency analysis
- `adapter.ts` already has stub `sendMessage` from T1.3.
- Adds: split + ref lookup + per-part send.

#### Deep Dives
- Pseudocode:
  ```typescript
  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) return { ok: false, error: { code: "empty_text", message: "Empty text rejected." } };
    const ref = this.convRefStore.lookup(out.channel.id);
    if (ref === undefined) {
      return { ok: false, error: { code: "invalid_request", message: `No conversation reference for ${out.channel.id} — bot must receive a message first.` } };
    }
    const parts = splitForTeams(out.text);
    if (parts.length === 0) return { ok: false, error: { code: "empty_text", message: "Text reduced to zero parts after splitting." } };
    let lastActivityId: string | undefined;
    for (const part of parts) {
      try {
        const result = await this.app!.send(ref, { type: "message", text: part });
        lastActivityId = result?.id;
      } catch (err) {
        return { ok: false, error: mapTeamsError(err) };
      }
    }
    return lastActivityId !== undefined ? { ok: true, messageId: lastActivityId } : { ok: true };
  }
  ```

#### Tasks
1. Update `sendMessage` to wire split + ref lookup + per-part send.
2. Wrap each `app.send` in try/catch → `mapTeamsError` (T4.1).
3. Return first failure if any part fails.

#### TDD
```
RED:     test_send_short_message_one_app_send_call
RED:     test_send_long_message_splits_into_n_parts
RED:     test_send_no_conv_ref_returns_error
RED:     test_send_app_throws_returns_error
RED:     test_send_returns_last_activity_id
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-teams test
```

#### Acceptance Criteria
- [ ] All adapter tests pass
- [ ] Send never throws on platform errors
- [ ] Long text splits correctly

#### DoD
- [ ] Public surface complete

---

## Phase 4: Errors + lifecycle

### T4.1 — Error mapper (`mapTeamsError`)

#### Objective
Map `@microsoft/teams.api` errors (Bot Framework HTTP errors + Azure auth errors) → canonical `SendResult.error`.

#### Evidence
Mirrors `mapWhatsAppCloudError`, `mapSlackError`. Per-dialect mapper pattern (D67, D300).

#### Files to edit
```
packages/gateway-teams/src/errors.ts (NEW)
```

#### Deep file dependency analysis
- `errors.ts` exports `mapTeamsError(err): ErrorPayload`.
- Used by `adapter.sendMessage` + future status pipelines.

#### Deep Dives
- Teams SDK throws errors with codes/messages. Common patterns:
  - HTTP 401/403 → `auth_failed` (likely expired token or wrong tenant)
  - HTTP 429 → `rate_limit`
  - HTTP 400 → `invalid_request`
  - HTTP 5xx → `server_error`
  - Network → `server_error`
  - Unknown → `unknown`
- The SDK exception MAY have `status` / `statusCode` / `code` fields depending on Phase 0 inspection. **(EC-7 absorbed)** Mapper MUST tolerate plain `Error` (no `.status`) — network errors from Node fetch (`ECONNREFUSED`, `ECONNRESET`) and programmer errors don't carry HTTP status. Implementation guards:
  ```typescript
  export function mapTeamsError(err: unknown): ErrorPayload {
    if (err === null || err === undefined) return { code: "unknown", message: "Unknown error" };
    const e = err as { status?: number; statusCode?: number; message?: string };
    const status = e.status ?? e.statusCode;
    const message = e.message ?? String(err);
    // status-based first
    if (status === 401 || status === 403) return { code: "auth_failed", message };
    if (status === 429) return { code: "rate_limit", message };
    if (status === 400) return { code: "invalid_request", message };
    if (typeof status === "number" && status >= 500) return { code: "server_error", message };
    // network-error fallback
    if (/ECONN|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(message)) return { code: "server_error", message };
    return { code: "unknown", message };
  }
  ```

#### Tasks
1. Create `errors.ts`.
2. Implement `mapTeamsError(err)` with status + string matching.

#### TDD
```
RED:     test_map_401_to_auth_failed
RED:     test_map_403_to_auth_failed
RED:     test_map_429_to_rate_limit
RED:     test_map_400_to_invalid_request
RED:     test_map_5xx_to_server_error
RED:     test_map_unknown_to_unknown
RED:     test_map_handles_non_error_input — string, undefined
RED:     test_map_plain_error_without_status (EC-7, absorbs EC-10) — `new Error("ECONNREFUSED")` → `{ code: "server_error", message: "ECONNREFUSED" }` (does NOT crash)
RED:     test_map_handles_statusCode_field (EC-7) — some SDKs use `statusCode` not `status`; both must work
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-teams test errors.test.ts
```

#### Acceptance Criteria
- [ ] 7 canonical codes covered (auth_failed, rate_limit, invalid_request, server_error, unknown)
- [ ] Pure function (no I/O)

#### DoD
- [ ] Mapper consumed uniformly by adapter

---

### T4.2 — `connect`/`disconnect` lifecycle

#### Objective
`connect()` initializes the SDK App; `disconnect()` tears it down. Both idempotent.

#### Evidence
D172 contract. Sibling adapters all implement this.

#### Files to edit
```
packages/gateway-teams/src/adapter.ts — finalize connect/disconnect
```

#### Deep file dependency analysis
- Refines T1.3 skeleton.
- `app.initialize()` is the SDK's setup call (Hermes does the same).

#### Deep Dives
- `connect()`:
  ```typescript
  async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      this.app = createTeamsApp({ clientId, clientSecret, tenantId, ... });
      this.app.on_message(async (ctx) => await this._handleInbound(ctx));
      await this.app.initialize();
      this.connected = true;
      return true;
    } catch (err) {
      console.error("[teams] connect failed:", err);
      return false;
    }
  }
  ```
- `disconnect()`:
  ```typescript
  async disconnect(): Promise<void> {
    this.app = undefined;
    this.connected = false;
    this.convRefStore.clear();
  }
  ```

#### Tasks
1. Refine `connect()` per pseudocode.
2. Refine `disconnect()` per pseudocode.
3. Verify idempotency on repeated calls.

#### TDD
```
RED:     test_connect_returns_true_on_success
RED:     test_connect_idempotent — second call returns true with same App instance
RED:     test_connect_returns_false_on_init_failure — SDK throws → returns false (not throws)
RED:     test_disconnect_idempotent — second call is noop
RED:     test_disconnect_clears_conv_refs
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-teams test
```

#### Acceptance Criteria
- [ ] Both methods idempotent
- [ ] `connect` returns false on failure (never throws on platform errors)

#### DoD
- [ ] Adapter is fully lifecycle-compliant

---

## Phase 5: Example + env-gated smoke

### T5.1 — `examples/teams-bot/` scaffold

#### Objective
Reference Express server using `TeamsAdapter`; env-gated.

#### Evidence
D284 + D326. Mirrors `examples/whatsapp-bot/`.

#### Files to edit
```
examples/teams-bot/package.json (NEW)
examples/teams-bot/.env.example (NEW)
examples/teams-bot/README.md (NEW)
examples/teams-bot/run.ts (NEW)
examples/teams-bot/tsconfig.json (NEW)
```

#### Deep file dependency analysis
- Standalone example package — independent install.
- Depends on `@theokit/sdk` + `@theokit/gateway-teams` (workspace) + `@microsoft/teams.apps` + `@microsoft/teams.api` + `express`.

#### Deep Dives
- `.env.example`:
  ```
  TEAMS_CLIENT_ID=
  TEAMS_CLIENT_SECRET=
  TEAMS_TENANT_ID=
  TEAMS_BOT_DISPLAY_NAME=Theo
  OPENROUTER_API_KEY=
  PORT=3978
  ```
- `run.ts` pattern. **(EC-6 absorbed)** Express middleware order is critical — depends on Phase 0 finding whether Teams SDK needs `rawBody`:
  - **If Phase 0 confirms SDK accepts pre-parsed JSON** (likely path, since JWT is in `Authorization` header — not body-signed like WhatsApp):
    ```typescript
    app.use(express.json());
    app.post("/api/messages", adapter.createExpressHandler());
    ```
  - **If Phase 0 finds SDK needs raw body** (same as WhatsApp Cloud):
    ```typescript
    app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
    app.post("/api/messages", adapter.createExpressHandler());
    ```
  README documents the requirement prominently (which mode applies). Without the right middleware, **100% of requests get 401 silently** — same failure mode as WhatsApp EC-2.
- README has 8-step walkthrough:
  1. Register app in Azure AD (App Registration)
  2. Create Bot Service in Azure portal pointing at your webhook URL
  3. Grant Microsoft Graph permissions
  4. Copy client_id, generate client_secret, copy tenant_id
  5. Configure `.env`
  6. Expose local server via ngrok
  7. Update Bot Service Messaging Endpoint to ngrok URL
  8. Install bot into Teams (sideload manifest)
- README **Troubleshooting** section absorbs documented edges:
  - **(EC-11)** "After restarting the bot, users may need to send a message before the bot can reply proactively." (ConversationReferenceStore is in-memory.)
  - **(EC-12)** "Bot doesn't see my message → check single-tenant vs multi-tenant in Azure Portal. Single-tenant bots silently reject cross-tenant messages."
  - Auth failures → check tenant_id, client_secret expiration.

#### Tasks
1. Create package.json with deps.
2. Create `run.ts`.
3. Create `.env.example` with required vars.
4. Create README with Azure setup walkthrough.

#### TDD
```
RED:     N/A (example code; typecheck only)
GREEN:   pnpm typecheck on the example dir
VERIFY:  cd examples/teams-bot && pnpm install --ignore-workspace && npx tsc --noEmit
```

#### Acceptance Criteria
- [ ] Example typechecks
- [ ] README has 8-step Azure walkthrough
- [ ] `.env.example` lists every required var

#### DoD
- [ ] Example runnable (modulo Azure-side setup)

---

### T5.2 — Env-gated live smoke

#### Objective
One-shot send via SDK directly (no webhook server required) — verifies credentials work.

#### Evidence
`.claude/rules/real-llm-validation.md` — anything claiming "validated" needs real backend hit. Smoke is the standard way to env-gate the validation.

#### Files to edit
```
examples/teams-bot/smoke.ts (NEW)
```

#### Deep file dependency analysis
- Standalone validation script.
- Builds `TeamsAdapter`, calls `connect()`, asserts no errors.
- For a true end-to-end proactive send, would need a pre-recorded `ConversationReference` — out of scope for v1 smoke.

#### Deep Dives
- Script:
  1. Read env. If `TEAMS_CLIENT_ID`/`SECRET`/`TENANT_ID` missing → log skipped + exit 0.
  2. Construct adapter, call `connect()`.
  3. Assert `connect` returned true.
  4. Disconnect, exit 0.
- Doesn't send a message (that needs an existing conversation). Validates: auth works.

#### Tasks
1. Create `smoke.ts`.
2. Implement env check + skip gate.
3. Implement connect + assertion.

#### TDD
```
RED:     N/A (smoke is itself the test)
GREEN:   With env unset: exits 0 with "skipped" message
GREEN:   With env set + valid creds: connect returns true + exit 0
VERIFY:  cd examples/teams-bot && pnpm tsx smoke.ts
```

#### Acceptance Criteria
- [ ] Skips cleanly without creds
- [ ] Connects successfully with valid creds

#### DoD
- [ ] Smoke documented in README

---

## Phase 6: Docs site update

### T6.1 — Update `concepts/gateways.mdx`

#### Objective
Add Teams row to the shipped-adapters table.

#### Files to edit
```
../theo-opendocs/content/theokit-sdk/concepts/gateways.mdx
```

#### Tasks
1. Add `@theokit/gateway-teams` row.
2. Update roadmap blurb: WhatsApp ✅, Teams ✅, Email pendente.

#### TDD
```
RED:     test_gateways_mdx_lists_teams — grep for teams in the table
GREEN:   Edit
VERIFY:  grep -i teams ../theo-opendocs/content/theokit-sdk/concepts/gateways.mdx
```

#### Acceptance Criteria
- [ ] Page lists Teams alongside Slack/Telegram/Discord/WhatsApp

#### DoD
- [ ] Build verde

---

### T6.2 — Cookbook recipe auto-gen

#### Objective
Regenerate cookbook to pick up `examples/teams-bot/`.

#### Files to edit
```
../theo-opendocs/content/theokit-sdk/cookbook/teams-bot.mdx (regenerated)
```

#### Tasks
1. Run `pnpm generate:sdk-cookbook` in theo-opendocs.
2. Confirm `cookbook/teams-bot.mdx` emitted.

#### Acceptance Criteria
- [ ] Recipe rendered in `out/`

#### DoD
- [ ] Build verde

---

### T6.3 — Drift checker

#### Files to edit
None — verification only.

#### Tasks
1. `pnpm --filter @theokit/sdk run docs:drift`.
2. Confirm exit 0.

#### Acceptance Criteria
- [ ] Drift checker exits 0

#### DoD
- [ ] Zero drift

---

## Phase 7: Dogfood + commits

### T7.1 — SDK dogfood (sanity)

#### Objective
Plan doesn't touch SDK runtime, but confirm zero regression.

#### Tasks
1. Boot telegram-pro bot.
2. Run `/dogfood full`.
3. Confirm 44/44 PASS.

#### Acceptance Criteria
- [ ] Telegram-pro dogfood 44/44 PASS, zero regression

#### DoD
- [ ] Sanity confirmed

---

### T7.2 — Package validation (publint + attw)

#### Objective
Confirm the new package is npm-publishable.

#### Tasks
1. Build the package.
2. Run `publint dist/` and `attw --pack`.
3. Resolve any errors.

#### Acceptance Criteria
- [ ] publint clean
- [ ] attw clean

#### DoD
- [ ] Package ready to publish

---

### T7.3 — Commit + push (both repos)

#### Objective
Land the work.

#### Tasks
1. theokit-sdk: stage new package + CHANGELOG + roadmap update + plan + inventory.
2. theokit-sdk: commit `feat(gateway): @theokit/gateway-teams v0.1.0 (Roadmap v1.4 #3)`.
3. theokit-sdk: push.
4. theo-opendocs: commit cookbook regen + gateways.mdx edit.
5. theo-opendocs: push.

#### Acceptance Criteria
- [ ] Both repos have commits
- [ ] Both pushed to main

#### DoD
- [ ] Work landed

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | SDK = `@microsoft/teams.apps` v2 (D315) | T1.1, T2.1 | Peer dep + createTeamsApp helper |
| 2 | Express bridge for HTTP (D316) | T2.2 | createExpressHandler factory |
| 3 | ConversationReference store (D317) | T2.4 | Map wrapper |
| 4 | Channel type mapping (D318) | T2.3 | Normalize personal/groupChat/channel |
| 5 | JWT validation via SDK (D319) | T2.1 | SDK App.process |
| 6 | Adaptive Cards via raw escape (D320) | T2.3 | event.teams.raw exposes activity |
| 7 | Mention stripping (D321) | T2.3 | stripTeamsMentions helper |
| 8 | 8000-char split (D322) | T3.1, T3.2 | splitForTeams + send loop |
| 9 | No status receipts in v0.1 (D323) | T1.3 | TeamsAdapter doesn't impl onStatusReceipt |
| 10 | v0.1.0 version (D324) | T1.1 | package.json |
| 11 | PlatformName opens (D325) | T1.2 | Union extended to "teams" |
| 12 | Express handler factory (D326) | T2.2 | createExpressHandler method |
| 13 | Example + smoke | T5.1, T5.2 | examples/teams-bot/ |
| 14 | Docs update | T6.1, T6.2, T6.3 | concepts + cookbook + drift |
| 15 | Zero regression | T7.1 | Telegram-pro dogfood 44/44 |
| 16 | npm publishable | T7.2 | publint + attw |
| 17 | SDK API surface verified before code (EC-2) | T0.1 | gateway-teams-sdk-inspection.md + plan pseudo-code corrected |
| 18 | Constructor rejects empty credentials (EC-1) | T1.3 | non-empty validation + test |
| 19 | Normalize tolerates missing conversationType (EC-3) | T2.3 | default switch arm + warn + test |
| 20 | Sender fallback chain (EC-4) | T2.3 | from.id ?? aadObjectId ?? "anonymous" + tests |
| 21 | ConversationReferenceStore capped at 1000 (EC-5) | T2.4 | FIFO LRU + 2 tests |
| 22 | Express middleware order documented (EC-6) | T5.1 | README explicit ordering |
| 23 | mapTeamsError tolerates plain Error (EC-7) | T4.1 | regex network-error fallback + tests |

**Coverage: 23/23 (100%)**

## Global Definition of Done

- [ ] Phases 0-7 complete (Phase 0 SDK inspection is mandatory — EC-2)
- [ ] All tests passing in `@theokit/gateway-teams`
- [ ] `@theokit/gateway` bumped to 0.3.0 (union opened for `"teams"`)
- [ ] `examples/teams-bot/` scaffold + README + smoke
- [ ] theo-opendocs `concepts/gateways.mdx` updated + cookbook regenerated
- [ ] Drift checker clean
- [ ] publint + attw clean on the new package
- [ ] CHANGELOG entries in both `gateway` and `gateway-teams` packages
- [ ] CLAUDE.md Roadmap v1.4 #3 marked ✅ DONE
- [ ] **SDK dogfood telegram-pro: 44/44 PASS** (zero regression)
- [ ] Live smoke either PASS (with Azure setup) or skipped honestly per `.claude/rules/real-llm-validation.md`

## Final Phase: Dogfood QA (MANDATORY)

> Plan does not touch SDK runtime. Dogfood is **sanity** + Teams-specific **smoke**.

### Execution

1. SDK sanity: `/dogfood full` — telegram-pro must remain 44/44 PASS.
2. Teams smoke: `cd examples/teams-bot && pnpm tsx smoke.ts`.

### Acceptance Criteria

- [ ] SDK dogfood: 44/44 PASS (zero regression)
- [ ] Teams smoke: PASS (with creds) OR skip honestly (without creds)
- [ ] Zero CRITICAL or HIGH issues introduced

### If Dogfood Fails

1. SDK regression → unexpected (no SDK changes). Investigate.
2. Smoke fail → check Azure setup (App Registration, Bot Service, tenant id).
3. Pre-existing issues documented, do not block.
