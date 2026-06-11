# Plan: `@theokit/gateway-whatsapp` v0.1.0 (Roadmap v1.4 #2)

> **Version 1.1** (2026-05-23) — Ship the WhatsApp adapter for `@theokit/gateway` with **two backends**: (1) official Meta WhatsApp Business Cloud API and (2) unofficial subprocess bridge to `whatsapp-web.js` (Hermes pattern). v1 scope: DMs + groups + text + status receipts. Multi-backend choice mirrors `referencia/hermes-agent/gateway/platforms/whatsapp.py` rationale — businesses on verified numbers use Cloud, dev/personal use Web bridge. Env-gated example with local webhook receiver. Expected outcome: builders can add `@theokit/gateway-whatsapp` to their stack and reach ~2 bi users on the largest messaging platform of the planet, via the same `MessageEvent` surface they already use for Slack/Telegram/Discord.

> **Edge-case review 2026-05-23 absorbed (v1.1):** 8 MUST FIX identified by `/edge-case-plan` were incorporated into the tasks:
> - **EC-1** (T2.2 + T5.1) — `verifyWebhookSubscription` helper for Meta's GET handshake; without it the webhook never registers.
> - **EC-2** (T5.1) — Express `express.json({ verify })` to preserve `rawBody`; without it 100% of signature verifications fail.
> - **EC-3** (T2.2) — Length guard before `timingSafeEqual` (otherwise `RangeError` DoS).
> - **EC-4** (T2.2) — Filter `message.type !== "text"` in normalize (v1 text-only; image/audio/video/etc would crash consumers expecting `text` field).
> - **EC-5** (T3.1) — Verify PID cmdline before killing (otherwise we kill the user's `vim` if OS recycled the PID).
> - **EC-6** (T3.3) — `connect()` 120s timeout + `WhatsAppConnectTimeoutError` (otherwise app hangs forever if QR not scanned).
> - **EC-7** (T1.4) — Digit-only normalizer in mention filter (so `+5511999...` matches `@5511999` matches `@99999-9999`).
> - **EC-8** (T4.2) — Filter empty parts from split output (otherwise consecutive newlines produce empty `sendMessage` calls Meta rejects).
>
> SHOULD TEST (EC-9/10/11) folded into TDD lists; DOCUMENT (EC-12/13) noted as small implementation details.

## Context

### What exists today

- 3 gateways shipped: `@theokit/gateway-telegram`, `@theokit/gateway-discord`, `@theokit/gateway-slack` (ADRs D170-D285).
- `@theokit/gateway` base package — `BasePlatformAdapter` abstract class (D172), `MessageEvent` discriminated union (D173), `SendResult` outbound shape, hooks contract (D176-D177).
- Slack adapter (`packages/gateway-slack/`) is the closest pattern reference — peer-dep workspace package, Socket Mode transport, `MessageEvent` variant with `slack: { raw, channel }`.
- `MessageEvent.platform` is currently typed `"telegram" | "discord" | "slack"` (closed union).

### What's missing

- No WhatsApp adapter. ~2 bi users globally. Dominant in LATAM, Asia, Africa — markets where Slack/Discord are minority. Enterprise B2C onboarding flows expect WhatsApp.
- Roadmap v1.4 #2 in `CLAUDE.md` lists WhatsApp as the next gateway after Docs site (just shipped).

### Evidence motivating the work

- `referencia/hermes-agent/gateway/platforms/whatsapp.py` (1250 lines) — battle-tested adapter that supports BOTH Cloud API and Web bridge backends. Comment at file top documents the "no official bot API for personal accounts" tension that justifies the dual approach.
- `referencia/openclaw/extensions/whatsapp/` — TypeScript channel plugin (different shape but same backend duality).
- User-confirmed scope (2026-05-23): "Temos que criar versao oficial e nao oficial igual o hermes".

## Objective

**Done = a user can `pnpm add @theokit/gateway-whatsapp`, configure either `backend: "cloud"` or `backend: "web"`, and have their `@theokit/sdk` agent receive WhatsApp DMs + group messages + emit responses, with status receipts surfacing back via hooks.**

Measurable goals:

1. Package `@theokit/gateway-whatsapp` v0.1.0 shippable via npm (publint + attw clean).
2. `WhatsAppAdapter` extends `BasePlatformAdapter`; passes `instanceof` checks; never throws on platform errors per D172 contract.
3. Cloud backend: `POST /messages` (send) + `POST <webhook-url>` (inbound) with `X-Hub-Signature-256` verification.
4. Web backend: subprocess to `whatsapp-web.js` (stdio JSON-lines IPC), Hermes-style PID file + port-kill protection.
5. `MessageEvent.platform` union extended to include `"whatsapp"`.
6. `examples/whatsapp-bot/` scaffold + README; env-gated live smoke (skips if creds absent).
7. `theo-opendocs` cookbook recipe auto-generated.
8. Drift checker clean.
9. SDK telegram-pro dogfood: 44/44 PASS (zero regression — this plan only adds new package).

## ADRs

### D303 — Multi-backend strategy (Cloud + Web)
- **Decision:** Ship two backends in v1: `cloud` (Meta WhatsApp Business Cloud API) and `web` (subprocess bridge to `whatsapp-web.js`). Backend chosen via `WhatsAppAdapterOptions.backend: "cloud" | "web"`.
- **Rationale:** WhatsApp has no official bot API for personal accounts. Businesses on verified numbers must use Cloud API; dev/personal accounts use Web bridge. Hermes ships both and the comment at the top of their file justifies the duality with the same reasoning. Shipping only Cloud excludes 80% of dev-loop users who don't have Meta Business verification. Shipping only Web means we can't onboard production B2C builders.
- **Consequences:** v1 surface area doubles. We isolate backend code behind `WhatsAppBackend` interface — `WhatsAppAdapter` itself is backend-agnostic. Future backends (Baileys, Twilio) plug in via the same interface.

### D304 — Cloud backend uses native `fetch` (no Meta SDK)
- **Decision:** No `@meta/whatsapp-business-cloud-api` or similar — just typed `fetch` calls.
- **Rationale:** Same reasoning as D294 (Bedrock has no Anthropic SDK wrappers). Cloud API is REST + webhook; the Meta SDK adds 50+ MB of transitive deps for shape conveniences we can replicate in ~300 lines. Aligns with `BedrockAnthropicClient` + `OpenAIClient` patterns (no SDK adapters).
- **Consequences:** We own the wire format — must keep up with Meta API changes (slow cadence: v18.0 stable since 2023). Cleaner type story; no peer dep.

### D305 — Web bridge backend uses subprocess (no embedded `whatsapp-web.js`)
- **Decision:** Spawn `whatsapp-web.js` (Node) as a child process; IPC via stdio JSON-lines. NOT a peer dep — user installs `whatsapp-web.js` standalone in their app and we spawn its CLI.
- **Rationale:** `whatsapp-web.js` ships ~150 MB of Puppeteer + Chromium peer deps + native modules. Embedding as direct dep balloons our package. Hermes uses subprocess for the same reason (their `whatsapp.py` spawns Node bridge). Subprocess also isolates crashes — if `whatsapp-web.js` panics on a malformed message, our adapter survives.
- **Consequences:** User responsibility to install `whatsapp-web.js` separately. Our adapter ships a small bridge script (`bridge/whatsapp-web-bridge.mjs`) the subprocess executes. Lifecycle complexity: PID file (Hermes pattern), port-kill on stale, graceful SIGTERM.

### D306 — Webhook receiver is OUT OF SCOPE
- **Decision:** Cloud backend EXPECTS the user to provide their own HTTP server (Express, Hono, Cloudflare Worker). Our adapter exposes `verifyWebhookSignature(rawBody, signature)` + `handleWebhookPayload(json)` helpers; user calls them inside their route handler.
- **Rationale:** Embedding a server forces a transport choice (Node http, Hono, Express) on the user. Slack adapter sidesteps this via Socket Mode (no inbound HTTP). WhatsApp Cloud has no equivalent — webhook is the only inbound. By exposing helpers instead of a server, the adapter works in Lambda, Workers, Express, Hono, Next.js — anywhere `fetch` works. The `examples/whatsapp-bot/` provides a reference Express server.
- **Consequences:** Setup docs MUST be explicit ("you need a webhook URL"). v1.x can add `WhatsAppCloudBackend.createNodeServer()` convenience if demand emerges.

### D307 — Status receipts via dedicated hook
- **Decision:** Status receipts (`sent`, `delivered`, `read`) are NOT inbound `MessageEvent`s. They surface via a separate `onStatusReceipt(handler)` method on `WhatsAppAdapter`.
- **Rationale:** Status receipts are about an outbound message (we sent, was it delivered?), not user input. Treating them as `MessageEvent` pollutes the discriminated union — every consumer would need to filter them out. A dedicated callback matches the semantic distinction and keeps `BasePlatformAdapter` clean.
- **Consequences:** WhatsApp gets a `WhatsAppAdapter`-specific hook (not in `BasePlatformAdapter`). Mirrors the platform-specific escape hatch pattern (D180).

### D308 — `MessageEvent.platform` opens to `"whatsapp"`
- **Decision:** Extend `PlatformName` union in `@theokit/gateway` to include `"whatsapp"`. Add `WhatsAppMessageEvent` variant with `whatsapp: { rawWamid, phoneNumberId, contactName, raw }`.
- **Rationale:** D173 mandates discriminated union by `platform`. Closed union grows with each new adapter; this is the expected pattern (Slack added the same way in T1.1 of plan D267-D285).
- **Consequences:** Minor version bump on `@theokit/gateway` (0.1.x → 0.2.0). Existing adapters unaffected since they read their own variant only.

### D309 — Group event filtering: mention-required by default for groups
- **Decision:** When backend emits a group message, the adapter drops it UNLESS:
  - The message replies to a bot message, OR
  - The message mentions the bot by configured `botPhoneId`, OR
  - `requireMention: false` is explicitly set.
- **Rationale:** D285 (Slack): same default. WhatsApp groups have ≤1024 members; every message would flood the agent. Mention-required by default is the only sane behavior for cost + UX. Hermes uses the same default (their `_whatsapp_require_mention` defaults to True).
- **Consequences:** First-time builders see "my bot doesn't respond in group" until they read the docs. Documented in README + example.

### D310 — Outbound message split at 4096 chars
- **Decision:** WhatsApp text body limit is 4096 UTF-8 chars per message (Cloud API). Split at boundary; preserve markdown by splitting on `\n\n` then `\n` then `.` then hard 4096.
- **Rationale:** Same pattern as `splitForSlack` (4000) and `splitForTelegram` (4096). WhatsApp limit is 4096; same algorithm.
- **Consequences:** New `splitForWhatsApp` helper. Tested identically to Slack/Telegram via mirrored test file.

### D311 — Phone number ID = Cloud-only concept
- **Decision:** Cloud backend requires a `phoneNumberId` (Meta-issued, not the user-facing phone number). Web backend does NOT — uses the linked session's number directly.
- **Rationale:** Cloud API addresses senders/recipients via `phoneNumberId` (looks like `123456789012345`). User-facing phone (`+5511999...`) is only for contact lookup. Web bridge uses the WhatsApp Web session — number is implicit.
- **Consequences:** Type `WhatsAppCloudConfig.phoneNumberId: string` is required for Cloud, absent in Web config. Discriminated union shape.

### D312 — Webhook signature verification uses SHA256 HMAC
- **Decision:** Verify `X-Hub-Signature-256` header on every webhook callback via HMAC-SHA256(appSecret, rawBody). Reject if mismatch.
- **Rationale:** Meta API contract. Skipping verification = anyone with the webhook URL can spoof messages. The verification IS the security boundary.
- **Consequences:** Adapter exposes `verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string): boolean`. User MUST call this before `handleWebhookPayload`. Documented as REQUIRED.

### D313 — Bridge subprocess uses PID file lock
- **Decision:** Web bridge writes its PID to `$THEOKIT_HOME/whatsapp-bridge-<sessionId>.pid` on start. On adapter init, if a stale PID exists, kill that process; if port-bind fails (Hermes pattern), kill whatever holds the port.
- **Rationale:** Hermes ships this pattern (`_kill_stale_bridge_by_pidfile`, `_kill_port_process`). Without it, two adapter instances in the same workspace fight over the bridge — second crashes. The lock makes lifecycle deterministic.
- **Consequences:** Adapter needs filesystem access ($THEOKIT_HOME). Cannot run two WhatsApp adapters in the same process targeting the same session (intentional — WhatsApp Web only allows one client per linked phone).

### D314 — Initial version `0.1.0` (matches sibling gateways)
- **Decision:** Ship as `0.1.0` like `gateway-slack`, `gateway-discord`, `gateway-telegram` (D181). Breaking changes allowed within 0.x.
- **Rationale:** v0.x signals pre-1.0 contract. WhatsApp Cloud API itself has minor surface changes per quarter; we need room to track.
- **Consequences:** Standard `0.x` semver contract.

## Dependency Graph

```
Phase 0 (audit)
   │
   ▼
Phase 1 (package skeleton + types + base adapter)
   │
   ├──▶ Phase 2 (Cloud backend)              ───┐
   │                                              │
   ├──▶ Phase 3 (Web bridge backend)          ───┤ parallel
   │                                              │
   └──▶ Phase 4 (errors + split + sendMessage) ──┘
              │
              ▼
       Phase 5 (example + live smoke)
              │
              ▼
       Phase 6 (docs site update + gateway union open)
              │
              ▼
       Phase 7 (dogfood + commit)
```

- **Phase 1** is the gate. Once types land, Phases 2/3/4 can run in parallel (independent files).
- **Phase 5** depends on at least Phase 2 OR Phase 3 (need at least one working backend).
- **Phase 6** depends on Phase 5 (example must exist for cookbook generator).

---

## Phase 0: Audit

### T0.1 — Inventory `BasePlatformAdapter` contract obligations

#### Objective
Confirm exactly which methods / properties `WhatsAppAdapter` must implement.

#### Evidence
`packages/gateway/src/adapter/base.ts` is the source of truth. Without re-reading the contract, easy to miss an abstract method.

#### Files to edit
```
(read-only; no edits in this task)
packages/gateway/src/adapter/base.ts — confirm contract
packages/gateway-slack/src/adapter.ts — reference implementation
```

#### Deep file dependency analysis
- `base.ts` defines `BasePlatformAdapter` abstract class — every adapter implements `platform`, `connect`, `disconnect`, `sendMessage`, `onInbound`. Optional overrides: `startTyping`, `stopTyping`.
- `gateway-slack/src/adapter.ts` is the most recent example — copy its shape (class extends, peer deps, `getApp` escape hatch).

#### Deep Dives
- Read `base.ts` top to bottom; note the EC-H rule (`onInbound` replaces, does not stack).
- Confirm `SendResult` shape — must return `{ ok, messageId?, error? }`.
- Note that `connect()` MUST be idempotent.

#### Tasks
1. Read `packages/gateway/src/adapter/base.ts` end-to-end.
2. Read `packages/gateway-slack/src/adapter.ts` lifecycle methods.
3. Document the WhatsApp-specific lifecycle constraints in a brief inline note (not a new file).

#### TDD
```
RED:     N/A (this is a read-only audit task)
GREEN:   The implementer can list the 4 abstract methods + 2 optional overrides from memory.
REFACTOR: None expected.
VERIFY:  grep "abstract " packages/gateway/src/adapter/base.ts  # 4 lines
```

#### Acceptance Criteria
- [ ] Implementer can articulate the `BasePlatformAdapter` contract.
- [ ] `instanceof BasePlatformAdapter` will be true on our adapter at the end of Phase 1.

#### DoD
- [ ] Audit complete; ready to scaffold Phase 1.

---

## Phase 1: Package skeleton + types + base adapter

### T1.1 — Workspace package scaffold

#### Objective
Create `packages/gateway-whatsapp/` with `package.json`, `tsup.config.ts`, `tsconfig.json`, `vitest.config.ts` mirroring `gateway-slack/`.

#### Evidence
Sibling adapters all use the same skeleton (D171). Diverging would create maintenance burden + diverge from publint/attw config we already validated.

#### Files to edit
```
packages/gateway-whatsapp/package.json (NEW)
packages/gateway-whatsapp/tsup.config.ts (NEW)
packages/gateway-whatsapp/tsconfig.json (NEW)
packages/gateway-whatsapp/vitest.config.ts (NEW)
packages/gateway-whatsapp/CHANGELOG.md (NEW)
packages/gateway-whatsapp/README.md (NEW — placeholder)
pnpm-workspace.yaml — confirm `packages/*` glob covers (no change expected)
```

#### Deep file dependency analysis
- `package.json` template from `gateway-slack/package.json` — adjust name, peers (no `@slack/bolt`).
- `tsup.config.ts` — same dual ESM+CJS+DTS shape.
- `tsconfig.json` — extends `tsconfig.base.json`.
- `vitest.config.ts` — same shape.
- Workspace auto-includes new package via `packages/*` glob.

#### Deep Dives
- `package.json` peers: `@theokit/gateway`, `@theokit/sdk`. Optional peer: `whatsapp-web.js` (web backend) — declared optional via `peerDependenciesMeta`.
- `tsup.config.ts` mirrors `gateway-slack` exactly (input: `src/index.ts`, format: `["esm", "cjs"]`, dts: true).

#### Tasks
1. Copy `gateway-slack/package.json` → `gateway-whatsapp/package.json`. Edit: name, description, peers, version 0.1.0.
2. Copy `gateway-slack/tsup.config.ts` → `gateway-whatsapp/tsup.config.ts` (no edits).
3. Copy `gateway-slack/tsconfig.json` → `gateway-whatsapp/tsconfig.json` (no edits).
4. Copy `gateway-slack/vitest.config.ts` → `gateway-whatsapp/vitest.config.ts` (no edits).
5. Create empty `src/index.ts` (will populate in T1.2-T1.4).
6. Create placeholder `README.md` (full version in Phase 6).
7. Run `pnpm install` at workspace root to register new package.

#### TDD
```
RED:     test_package_resolves — `pnpm list @theokit/gateway-whatsapp` shows it
GREEN:   Package skeleton in workspace
REFACTOR: None expected
VERIFY:  pnpm install && pnpm list @theokit/gateway-whatsapp
```

#### Acceptance Criteria
- [ ] `packages/gateway-whatsapp/` directory exists with 6 files
- [ ] `pnpm install` succeeds at root
- [ ] `pnpm --filter @theokit/gateway-whatsapp build` works (empty index emits empty dist; OK)

#### DoD
- [ ] Skeleton commitable
- [ ] Workspace recognizes new package

---

### T1.2 — Extend `PlatformName` union + add `WhatsAppMessageEvent`

#### Objective
Open the `MessageEvent` discriminated union to include `"whatsapp"`.

#### Evidence
Same pattern Slack used (D274). Closed union → adapter must extend before emitting events.

#### Files to edit
```
packages/gateway/src/types/message-event.ts — extend PlatformName + add WhatsAppMessageEvent
packages/gateway/CHANGELOG.md — record 0.1.x → 0.2.0 bump
```

#### Deep file dependency analysis
- `message-event.ts` exports `PlatformName` (closed union) + variants. Consumers narrow via `switch (event.platform)`.
- All sibling adapter packages depend on this type. Bumping minor is safe (additive only).
- Bump `gateway` from current to 0.2.0 to signal opening union.

#### Deep Dives
- `WhatsAppMessageEvent` shape:
  ```typescript
  export interface WhatsAppMessageEvent extends BaseMessageEvent {
    readonly platform: "whatsapp";
    readonly whatsapp: {
      readonly wamid: string;           // WhatsApp message id (cloud) or msg.id (web)
      readonly phoneNumberId?: string;  // cloud only
      readonly contactName?: string;
      readonly backend: "cloud" | "web";
      readonly raw: unknown;            // backend-specific raw envelope
    };
  }
  ```
- Channel `type` mapping:
  - 1:1 conversation → `"dm"`
  - Group → `"group"` (no threads in WhatsApp — `topicId` undefined)

#### Tasks
1. Add `"whatsapp"` to `PlatformName` union.
2. Add `WhatsAppMessageEvent` interface.
3. Add to the `MessageEvent` union export.
4. Update `@theokit/gateway/package.json` to `0.2.0`.
5. Add CHANGELOG entry under `[Unreleased]`.

#### TDD
```
RED:     test_platform_name_includes_whatsapp — `const _p: PlatformName = "whatsapp"` typechecks
RED:     test_whatsapp_event_narrows — switch on `event.platform === "whatsapp"` narrows access to `event.whatsapp`
GREEN:   Types compile + tests pass
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway typecheck && pnpm --filter @theokit/gateway test
```

#### Acceptance Criteria
- [ ] `PlatformName` includes `"whatsapp"`
- [ ] `WhatsAppMessageEvent` exported from `@theokit/gateway`
- [ ] Sibling adapters (slack, telegram, discord) still typecheck
- [ ] CHANGELOG entry added

#### DoD
- [ ] Type opens cleanly
- [ ] Zero regression in sibling packages

---

### T1.3 — `WhatsAppBackend` interface (backend abstraction)

#### Objective
Define the contract every backend (cloud, web, future) must implement. This is the seam D303 mandates.

#### Evidence
Hermes `whatsapp.py` interleaves cloud + web logic in one 1250-line class. We avoid that by splitting backends behind a small interface. Backend choice becomes "pick a class".

#### Files to edit
```
packages/gateway-whatsapp/src/backend/types.ts (NEW)
```

#### Deep file dependency analysis
- `backend/types.ts` defines `WhatsAppBackend` + supporting types (`WhatsAppOutboundMessage`, `WhatsAppInboundEvent`).
- `WhatsAppAdapter` (T1.4) delegates lifecycle + send to the backend instance.
- Cloud + web backends (Phases 2 + 3) each implement this interface.

#### Deep Dives
- Backend contract:
  ```typescript
  export interface WhatsAppBackend {
    readonly kind: "cloud" | "web";
    connect(): Promise<boolean>;
    disconnect(): Promise<void>;
    send(message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult>;
    /** Subscribe to normalized inbound events. Returns unsubscribe. */
    onInbound(handler: (event: WhatsAppInboundEvent) => Promise<void>): () => void;
    /** Status receipts (sent/delivered/read). Returns unsubscribe. */
    onStatusReceipt(handler: (receipt: WhatsAppStatusReceipt) => Promise<void>): () => void;
  }
  ```
- `WhatsAppInboundEvent` is NORMALIZED (cloud + web emit the same shape). The adapter is backend-agnostic from this point on.

#### Tasks
1. Create `backend/types.ts`.
2. Define `WhatsAppBackend` interface.
3. Define `WhatsAppOutboundMessage`, `WhatsAppInboundEvent`, `WhatsAppStatusReceipt`, `WhatsAppSendResult`.

#### TDD
```
RED:     test_backend_interface_kind_is_closed — `kind: "cloud" | "web"` is exhaustive
RED:     test_inbound_event_has_required_fields — narrow types compile against expected shape
GREEN:   Interface compiles
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-whatsapp typecheck
```

#### Acceptance Criteria
- [ ] `WhatsAppBackend` interface exported
- [ ] Types are exhaustive (cloud + web only)
- [ ] No file > 200 lines

#### DoD
- [ ] Interface stable; backends in Phases 2-3 implement it without divergence

---

### T1.4 — `WhatsAppAdapter` class extends `BasePlatformAdapter`

#### Objective
The user-facing adapter. Delegates to whichever backend the user configured.

#### Evidence
This is the public surface — all docs, examples, types flow through here.

#### Files to edit
```
packages/gateway-whatsapp/src/adapter.ts (NEW)
packages/gateway-whatsapp/src/index.ts (extend barrel)
```

#### Deep file dependency analysis
- `adapter.ts` imports backend from `backend/types.ts` + Cloud/Web factories (Phases 2/3).
- `index.ts` exports: `WhatsAppAdapter`, `WhatsAppAdapterOptions`, `WhatsAppMessageEvent` (re-export from gateway), error classes (Phase 4).

#### Deep Dives
- Adapter options:
  ```typescript
  export type WhatsAppAdapterOptions =
    | {
        backend: "cloud";
        cloud: WhatsAppCloudConfig;
        requireMention?: boolean;  // default true for groups
      }
    | {
        backend: "web";
        web: WhatsAppWebConfig;
        requireMention?: boolean;
      };
  ```
- Constructor: instantiates the right backend factory.
- `connect()`, `disconnect()`, `sendMessage()`, `onInbound()` delegate.
- `onStatusReceipt(handler)` is adapter-specific (not in base).
- EC-H: `onInbound` REPLACES previous handler.
- Group filter (D309): wrap user's `onInbound` handler with a mention-required filter unless `requireMention: false`.

#### Tasks
1. Create `adapter.ts` extending `BasePlatformAdapter`.
2. Implement constructor + backend instantiation.
3. Implement `connect`, `disconnect`, `sendMessage`, `onInbound` (delegate to backend + filter).
   **(EC-7 absorbed)** Group mention filter MUST normalize both sides via `digitsOnly(s) = s.replace(/[^\d]/g, "")` before comparison: `if (digitsOnly(event.text).includes(digitsOnly(botPhoneId))) pass;`. Without this, `@5511999`, `@+5511999`, `@99999-9999` all miss the same `botPhoneId`. Test cases cover all 3 formats.
4. Implement `onStatusReceipt`.
5. Add `getBackend(): WhatsAppBackend` escape hatch (mirrors `SlackAdapter.getApp`).
6. Update `index.ts` barrel.

#### TDD
```
RED:     test_adapter_is_base_platform_adapter — `new WhatsAppAdapter() instanceof BasePlatformAdapter`
RED:     test_adapter_platform_is_whatsapp — `adapter.platform === "whatsapp"`
RED:     test_adapter_oninbound_replaces (EC-H) — second call replaces first
RED:     test_adapter_group_mention_default_filters — group msg without mention is filtered
RED:     test_adapter_group_mention_normalizes_formats (EC-7) — `@5511999`, `@+5511999`, `@99999-9999` all match botPhoneId=`5511999999999`
RED:     test_adapter_send_with_empty_text_returns_error — `SendResult { ok: false, code: "empty_text" }`
RED:     test_adapter_connect_idempotent — second call returns true with same backend instance
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-whatsapp test
```

#### Acceptance Criteria
- [ ] `WhatsAppAdapter` extends `BasePlatformAdapter`
- [ ] Constructor accepts both `backend: "cloud"` and `backend: "web"` configs (discriminated)
- [ ] Group filter active by default
- [ ] All 6 tests above pass
- [ ] File ≤ 250 lines

#### DoD
- [ ] Adapter implements full contract
- [ ] No backend code leaks into adapter.ts (separation of concerns)

---

## Phase 2: Cloud backend (Meta WhatsApp Business Cloud API)

### T2.1 — `WhatsAppCloudClient` typed fetch wrapper

#### Objective
Typed `fetch` calls against `graph.facebook.com/v18.0/<phoneNumberId>/messages`.

#### Evidence
D304 mandates no Meta SDK. We own the wire format.

#### Files to edit
```
packages/gateway-whatsapp/src/backend/cloud/client.ts (NEW)
packages/gateway-whatsapp/src/backend/cloud/types.ts (NEW)
```

#### Deep file dependency analysis
- `client.ts` exports `WhatsAppCloudClient` — `sendText`, `sendImage`, `markAsRead` (status receipt back to user).
- `types.ts` defines Meta request/response shapes (`SendTextRequest`, `SendResponse`, `WebhookPayload`).

#### Deep Dives
- Send text request shape:
  ```typescript
  {
    messaging_product: "whatsapp",
    recipient_type: "individual",  // or omitted for groups
    to: "<E.164 phone>",
    type: "text",
    text: { body: string, preview_url: boolean }
  }
  ```
- POST URL: `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`
- Auth: `Authorization: Bearer ${accessToken}`
- Response: `{ messages: [{ id: "wamid.xxx" }] }`
- Error response: `{ error: { message, type, code, fbtrace_id } }`

#### Tasks
1. Create `types.ts` with Meta request/response interfaces.
2. Create `client.ts` with `WhatsAppCloudClient` class.
3. Methods: `sendText`, `markAsRead` (v1 scope — no media yet).
4. Use `safe()`-style error capture; throw on programmer errors, return error shape on platform errors.

#### TDD
```
RED:     test_cloud_client_send_text_url — correct graph.facebook.com URL with phoneNumberId
RED:     test_cloud_client_send_text_auth_header — Bearer token in Authorization
RED:     test_cloud_client_send_text_body_shape — messaging_product + type + text.body
RED:     test_cloud_client_handles_4xx — returns { ok: false, error } on 400/401/403
RED:     test_cloud_client_handles_429 — rate_limit code surfaced
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-whatsapp test backend/cloud/client.test.ts
```

#### Acceptance Criteria
- [ ] Client uses native `fetch` only (no peer dep)
- [ ] 4xx/429/5xx all return structured `WhatsAppSendResult`
- [ ] Tests use mocked `fetch` (no live calls)

#### DoD
- [ ] Client typechecks; all tests pass

---

### T2.2 — Webhook receiver helpers (verify + handle)

#### Objective
Two helpers the user calls inside THEIR webhook route: `verifyWebhookSignature` (D312) + `handleWebhookPayload`.

#### Evidence
D306: we don't ship a server. We ship the verification + parsing helpers.

#### Files to edit
```
packages/gateway-whatsapp/src/backend/cloud/webhook.ts (NEW)
```

#### Deep file dependency analysis
- `webhook.ts` exports `verifyWebhookSignature(rawBody, signatureHeader, appSecret): boolean` + `parseWebhookPayload(json): WhatsAppWebhookEnvelope`.
- The `WhatsAppCloudBackend` registers an inbound handler the user wires into `handleWebhookPayload`'s callback.

#### Deep Dives
- `X-Hub-Signature-256` header format: `sha256=<hex>`
- HMAC: `crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")`
- Compare with `crypto.timingSafeEqual` to defeat timing attacks.
- Webhook payload shape (Meta v18.0):
  ```typescript
  {
    object: "whatsapp_business_account",
    entry: [{
      id: string,
      changes: [{
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number, phone_number_id },
          contacts?: [{ profile, wa_id }],
          messages?: [{ from, id, timestamp, type, text?: { body }, ... }],
          statuses?: [{ id, status: "sent"|"delivered"|"read", timestamp, ... }]
        },
        field: "messages"
      }]
    }]
  }
  ```

#### Tasks
1. Create `webhook.ts`.
2. Implement `verifyWebhookSignature` using `node:crypto`.
   **(EC-3 absorbed)** Length guard BEFORE `timingSafeEqual`:
   ```ts
   if (!signatureHeader?.startsWith("sha256=")) return false;
   const received = Buffer.from(signatureHeader.slice(7), "hex");
   const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest();
   if (received.length !== expected.length) return false; // EC-3
   return crypto.timingSafeEqual(received, expected);
   ```
   Without the length guard, `timingSafeEqual` throws `RangeError` on a malformed header (`sha256=ab`) → DoS via crashed route.
3. **(EC-1 absorbed)** Implement `verifyWebhookSubscription(query: Record<string, string | undefined>, expectedVerifyToken: string): string | null` — the Meta GET handshake. Returns `query["hub.challenge"]` when `query["hub.mode"] === "subscribe"` AND `query["hub.verify_token"] === expectedVerifyToken`, otherwise `null`. Without this helper, the user's GET /webhook route never echoes the challenge → Meta never registers the URL → adapter never receives inbound events.
4. Implement `parseWebhookPayload` returning typed envelope.
5. Implement `normalizeInboundMessages(envelope)` returning `WhatsAppInboundEvent[]`.
   **(EC-4 absorbed)** Filter `message.type !== "text"` before emitting. Meta delivers ALL types (image, audio, video, document, location, contacts, interactive, reaction, sticker, button) on the same `messages[]` array. For non-text, log a one-shot stderr warn per type (`[whatsapp] ignoring <type> message — v1 text-only`) and skip. Without this, `message.text.body` is undefined for non-text and downstream `event.text.toLowerCase()` crashes.
6. Implement `normalizeStatusReceipts(envelope)` returning `WhatsAppStatusReceipt[]`.

#### TDD
```
RED:     test_verify_signature_valid — known body + valid sha256 returns true
RED:     test_verify_signature_invalid — tampered body returns false
RED:     test_verify_signature_missing_prefix — header without "sha256=" returns false
RED:     test_verify_signature_length_mismatch_no_crash (EC-3) — header `sha256=ab` returns false (does NOT throw)
RED:     test_verify_subscription_returns_challenge (EC-1) — query with subscribe + correct verify_token returns challenge
RED:     test_verify_subscription_rejects_wrong_token (EC-1) — wrong verify_token returns null
RED:     test_verify_subscription_rejects_non_subscribe_mode (EC-1) — hub.mode != "subscribe" returns null
RED:     test_normalize_extracts_text_messages — sample envelope yields 1 inbound event
RED:     test_normalize_skips_non_text_types (EC-4) — image/audio/video/document/location envelope yields []
RED:     test_normalize_extracts_status_receipts — sample envelope yields N status receipts
RED:     test_normalize_handles_empty_changes — no messages array yields empty []
RED:     test_normalize_handles_empty_entries_array (EC-9) — { entry: [] } health-ping returns []
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-whatsapp test backend/cloud/webhook.test.ts
```

#### Acceptance Criteria
- [ ] Signature verification uses `timingSafeEqual`
- [ ] Normalizer handles missing fields without throwing
- [ ] No external HTTP in tests (sample envelopes are static fixtures)

#### DoD
- [ ] Webhook helpers stable
- [ ] Used by `WhatsAppCloudBackend` in T2.3

---

### T2.3 — `WhatsAppCloudBackend` implements `WhatsAppBackend`

#### Objective
Wire client (T2.1) + webhook helpers (T2.2) behind the `WhatsAppBackend` interface.

#### Evidence
T1.3 contract — every backend implements the same shape.

#### Files to edit
```
packages/gateway-whatsapp/src/backend/cloud/index.ts (NEW)
packages/gateway-whatsapp/src/index.ts — export Cloud config type + factory helper
```

#### Deep file dependency analysis
- `cloud/index.ts` exports `WhatsAppCloudBackend` class.
- Constructor: `WhatsAppCloudConfig { accessToken, phoneNumberId, appSecret }`.
- `connect()` is a no-op for cloud (no persistent connection — webhook is push, send is HTTP).
- `onInbound` / `onStatusReceipt` register callbacks the user invokes via `handleWebhookPayload` in their HTTP route.
- Backend exposes `handleWebhookPayload(rawBody, signatureHeader)` that calls verify → parse → dispatch.

#### Deep Dives
- Connect is no-op + returns `true` immediately.
- Disconnect is no-op.
- Send delegates to `WhatsAppCloudClient.sendText`.
- Webhook handler: receives `rawBody` + signature → verifies → parses → normalizes → dispatches to user handlers.

#### Tasks
1. Create `cloud/index.ts`.
2. Implement `WhatsAppCloudBackend` class.
3. Wire client + webhook helpers.
4. Expose `handleWebhookPayload(rawBody, signature)` for user's HTTP route to call.
5. Export from main `index.ts` barrel.

#### TDD
```
RED:     test_cloud_backend_connect_noop_returns_true
RED:     test_cloud_backend_send_delegates_to_client
RED:     test_cloud_backend_handle_webhook_invalid_signature_no_dispatch
RED:     test_cloud_backend_handle_webhook_valid_dispatches_to_inbound_handler
RED:     test_cloud_backend_handle_webhook_dispatches_status_receipts
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-whatsapp test backend/cloud/
```

#### Acceptance Criteria
- [ ] Cloud backend implements full `WhatsAppBackend` interface
- [ ] Tampered webhooks rejected (zero dispatch)
- [ ] Status receipts surface via `onStatusReceipt`

#### DoD
- [ ] Cloud backend usable end-to-end (modulo user's HTTP server)

---

## Phase 3: Web bridge backend (subprocess to `whatsapp-web.js`)

### T3.1 — Bridge spawn lifecycle (PID file + port kill — D313)

#### Objective
Subprocess management: spawn, PID file, stale process detection, graceful kill.

#### Evidence
Hermes `_kill_stale_bridge_by_pidfile`, `_kill_port_process`, `_write_bridge_pidfile`, `_terminate_bridge_process` (1250-line file). We port the essential subset.

#### Files to edit
```
packages/gateway-whatsapp/src/backend/web/lifecycle.ts (NEW)
packages/gateway-whatsapp/src/backend/web/bridge.mjs (NEW — the script the subprocess runs)
```

#### Deep file dependency analysis
- `lifecycle.ts` exports `spawnBridge(config)`, `terminateBridge(handle, opts)`, `acquirePidLock(sessionId)`.
- `bridge.mjs` is a small Node ESM script the user has on disk (we ship it) — uses `whatsapp-web.js` (peer dep on user side) + writes JSON-lines to stdout for IPC.

#### Deep Dives
- PID file path: `${THEOKIT_HOME}/whatsapp-bridge-${sessionId}.pid`
- On `spawnBridge`:
  1. Check PID file. If exists + process alive → kill (Hermes pattern).
  2. Spawn `node bridge.mjs --session ${sessionId}` with detached: false, stdio: ["pipe", "pipe", "pipe"].
  3. Write child PID to PID file.
- On `terminateBridge`:
  1. Send SIGTERM.
  2. Wait 3s.
  3. If still alive → SIGKILL.
  4. Remove PID file.

#### Tasks
1. Create `lifecycle.ts` with `spawnBridge` / `terminateBridge` / `acquirePidLock`.
   **(EC-5 absorbed)** `acquirePidLock` MUST verify the PID's cmdline before killing. Implementation:
   ```ts
   function pidBelongsToOurBridge(pid: number): boolean {
     try {
       // Linux:
       const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
       if (cmdline.includes("whatsapp-web-bridge")) return true;
       return false;
     } catch {
       // macOS fallback: ps -p ${pid} -o args=
       try {
         const out = execSync(`ps -p ${pid} -o args=`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
         return out.includes("whatsapp-web-bridge");
       } catch { return false; }
     }
   }
   ```
   Only kill if `pidBelongsToOurBridge(stalePid)`. Without this, OS may have recycled the PID — we'd kill the user's `vim`, `tmux`, or anything else.
2. Create `bridge.mjs` — minimal `whatsapp-web.js` Client wrapper that:
   - Reads commands from stdin (JSON-lines: `{ cmd: "send", to, text }`).
   - Emits events to stdout (JSON-lines: `{ event: "message", ... }`).
   - **Spawn argv MUST contain literal string `whatsapp-web-bridge`** (e.g., `node bridge.mjs --tag whatsapp-web-bridge --session ${sessionId}`) so EC-5 cmdline check works.
3. Cross-platform PID handling (Linux + macOS; skip Windows-specific paths for v1).
4. **(EC-12 absorbed)** Pipe bridge's stderr to `process.stderr` (1-liner: `child.stderr.pipe(process.stderr)`) so the buffer never fills + the user sees crash output during dev.

#### TDD
```
RED:     test_acquire_pid_lock_creates_file
RED:     test_acquire_pid_lock_kills_stale_process — pre-existing PID file (cmdline matches) → process killed before spawn
RED:     test_acquire_pid_lock_preserves_unrelated_pid (EC-5) — pre-existing PID file whose cmdline DOES NOT contain "whatsapp-web-bridge" → NOT killed (the file is silently overwritten)
RED:     test_terminate_bridge_sigterm_then_sigkill — second-stage kill if SIGTERM ignored
RED:     test_terminate_bridge_removes_pid_file
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-whatsapp test backend/web/lifecycle.test.ts
```

#### Acceptance Criteria
- [ ] PID lock is filesystem-based (no DB)
- [ ] Lifecycle tests don't require real WhatsApp (use a dummy subprocess that sleeps)
- [ ] Cross-platform note in docs (Linux + macOS supported; Windows v1.x)

#### DoD
- [ ] Subprocess lifecycle is deterministic across runs

---

### T3.2 — Bridge IPC protocol (stdio JSON-lines)

#### Objective
Define the small protocol between adapter and bridge.

#### Evidence
Hermes uses similar shape (their bridge speaks JSON via stdout). We borrow the schema.

#### Files to edit
```
packages/gateway-whatsapp/src/backend/web/ipc.ts (NEW)
```

#### Deep file dependency analysis
- `ipc.ts` exports types + parsers.
- Both `lifecycle.ts` (T3.1) and `web/index.ts` (T3.3) depend on these types.

#### Deep Dives
- Commands (adapter → bridge):
  ```
  { cmd: "send", to: string, text: string, msgId: string }
  { cmd: "shutdown" }
  ```
- Events (bridge → adapter):
  ```
  { event: "ready", botPhone: string }
  { event: "message", from: string, body: string, msgId: string, isGroup: boolean, ... }
  { event: "send_ack", msgId: string, success: boolean, error?: string }
  { event: "status", msgId: string, status: "sent"|"delivered"|"read" }
  ```
- Line-delimited JSON; buffer fragments until `\n`.

#### Tasks
1. Define types in `ipc.ts`.
2. Implement `parseEvent(line: string): IpcEvent | null` (returns null on malformed).
3. Implement `formatCommand(cmd: IpcCommand): string` (JSON.stringify + `\n`).

#### TDD
```
RED:     test_parse_event_message — sample JSON line parses to IpcEvent
RED:     test_parse_event_malformed_returns_null
RED:     test_format_command_adds_newline
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-whatsapp test backend/web/ipc.test.ts
```

#### Acceptance Criteria
- [ ] Pure functions (no I/O)
- [ ] Malformed input doesn't crash parser

#### DoD
- [ ] Protocol stable; ready for backend integration

---

### T3.3 — `WhatsAppWebBackend` implements `WhatsAppBackend`

#### Objective
Wire lifecycle (T3.1) + IPC (T3.2) behind the backend interface.

#### Evidence
T1.3 contract.

#### Files to edit
```
packages/gateway-whatsapp/src/backend/web/index.ts (NEW)
packages/gateway-whatsapp/src/index.ts — export Web config type
```

#### Deep file dependency analysis
- `web/index.ts` exports `WhatsAppWebBackend` class.
- Constructor: `WhatsAppWebConfig { sessionId, bridgeScriptPath? }`.
- `connect()` spawns bridge, awaits `event: "ready"`, returns true.
- `disconnect()` sends `{ cmd: "shutdown" }`, awaits exit, removes PID.
- `send()` writes command, awaits matching `event: "send_ack"`.
- `onInbound` registers callback dispatched on `event: "message"`.
- `onStatusReceipt` registers callback dispatched on `event: "status"`.

#### Deep Dives
- Pending-send tracking: `Map<msgId, { resolve, reject }>` for matching `send_ack`.
- Timeout: 30s on send_ack; reject with `WhatsAppSendResult { ok: false, error: { code: "timeout" } }`.

#### Tasks
1. Create `web/index.ts`.
2. Implement class wiring lifecycle + IPC.
3. **(EC-6 absorbed)** `connect()` MUST race the `event: "ready"` promise against a 120s timeout. After 120s, reject with `WhatsAppConnectTimeoutError` (new error class). Without this, an unattended QR-code pairing hangs `connect()` forever — the app never starts. The 120s ceiling is generous enough for a human to scan the QR but short enough to fail fast in CI.
   ```ts
   const ready = new Promise<void>((resolve) => readyResolvers.push(resolve));
   const timeout = new Promise<never>((_, reject) =>
     setTimeout(() => reject(new WhatsAppConnectTimeoutError(120_000)), 120_000),
   );
   await Promise.race([ready, timeout]);
   ```
4. Add pending-send tracker with 30s timeout (already in plan).
5. Wire stdout line-reader to dispatch events.

#### TDD
```
RED:     test_web_backend_connect_spawns_and_awaits_ready
RED:     test_web_backend_connect_times_out_after_120s (EC-6) — bridge never emits "ready" → connect rejects with WhatsAppConnectTimeoutError
RED:     test_web_backend_send_matches_ack_by_msgid
RED:     test_web_backend_send_times_out_after_30s
RED:     test_web_backend_dispatches_inbound_message
RED:     test_web_backend_dispatches_status_receipt
RED:     test_web_backend_ipc_buffers_fragmented_line (EC-11) — stdout chunked '{"event":"mes' then 'sage"}\n' parses correctly
GREEN:   Implement (use mock subprocess in tests)
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-whatsapp test backend/web/
```

#### Acceptance Criteria
- [ ] Web backend implements full `WhatsAppBackend` interface
- [ ] Pending sends time out cleanly
- [ ] No leak of subprocess handles

#### DoD
- [ ] Web backend usable end-to-end (modulo user installing `whatsapp-web.js`)

---

## Phase 4: Errors + split + sendMessage wire

### T4.1 — Error mapper (`mapWhatsAppError`)

#### Objective
Per-backend HTTP/IPC errors → canonical `SendResult.error` shape.

#### Evidence
Mirrors `mapSlackError` (D273). Per-dialect mapper pattern (D67/D300).

#### Files to edit
```
packages/gateway-whatsapp/src/errors.ts (NEW)
```

#### Deep file dependency analysis
- `errors.ts` exports `mapWhatsAppCloudError(status, body)` + `mapWhatsAppWebError(ipcEvent)`.
- Used by `cloud/client.ts` (T2.1) + `web/index.ts` (T3.3).

#### Deep Dives
- Cloud error codes (Meta):
  - 100 → invalid_request
  - 131 → user-side error (number not on WhatsApp)
  - 130 → rate_limit
  - 190 → auth_failed (token expired)
- Web error strings (whatsapp-web.js):
  - "PROTOCOL_ERROR" → server_error
  - "AUTHENTICATION_FAILURE" → auth_failed
  - Default → unknown

#### Tasks
1. Create `errors.ts`.
2. Implement both mappers.
3. Each returns `{ code, message }` matching `SendResult.error` shape.

#### TDD
```
RED:     test_map_cloud_error_190_to_auth_failed
RED:     test_map_cloud_error_130_to_rate_limit
RED:     test_map_cloud_error_4xx_to_invalid_request
RED:     test_map_web_error_protocol_to_server_error
RED:     test_map_web_error_auth_to_auth_failed
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-whatsapp test errors.test.ts
```

#### Acceptance Criteria
- [ ] 5 canonical codes covered (auth_failed, rate_limit, invalid_request, server_error, unknown)
- [ ] No 6th code introduced — match `SendResult.error.code` enum
- [ ] Pure functions (no I/O)

#### DoD
- [ ] Mapper used uniformly by both backends

---

### T4.2 — `splitForWhatsApp` 4096-char splitter (D310)

#### Objective
Split long messages at 4096 UTF-8 chars, preserving markdown.

#### Evidence
Mirrors `splitForSlack` / `splitForTelegram`. Same algorithm; only the limit differs.

#### Files to edit
```
packages/gateway-whatsapp/src/split.ts (NEW)
packages/gateway-whatsapp/tests/split.test.ts (NEW)
```

#### Deep file dependency analysis
- `split.ts` exports `splitForWhatsApp(text: string): string[]`.
- Used by `WhatsAppAdapter.sendMessage` (T1.4 was wired but uses single message; T4.2 wires split).

#### Deep Dives
- Algorithm: try `\n\n` boundaries first → `\n` → `. ` → hard cut at 4096.
- UTF-16 surrogate pair safety: don't split mid-pair.

#### Tasks
1. Create `split.ts` adapting Slack's version.
2. Adjust limit to 4096.
3. Add UTF-16 surrogate guard.
4. **(EC-8 absorbed)** Final step in `splitForWhatsApp`: `return parts.map((p) => p.trim()).filter((p) => p.length > 0);`. Without this, input like `"a\n\n\n\n\nb"` produces `["a", "", "", "b"]` → send loop sends `text: ""` → Meta rejects → entire send fails on the empty middle part.

#### TDD
```
RED:     test_split_under_limit_returns_single_part
RED:     test_split_breaks_at_double_newline_preferentially
RED:     test_split_breaks_at_single_newline_when_no_double
RED:     test_split_hard_cut_at_4096_when_no_boundary
RED:     test_split_preserves_surrogate_pairs
RED:     test_split_filters_empty_parts (EC-8) — `"a\n\n\n\n\nb"` returns `["a", "b"]`, NOT `["a", "", "", "b"]`
GREEN:   Implement
REFACTOR: Extract shared splitter into gateway base if all 3 implementations diverge only by limit (DEFERRED — wait for the 4th adapter)
VERIFY:  pnpm --filter @theokit/gateway-whatsapp test split.test.ts
```

#### Acceptance Criteria
- [ ] 5 splitter tests pass
- [ ] UTF-16 surrogate safety verified

#### DoD
- [ ] Splitter integrated into `sendMessage`

---

### T4.3 — `WhatsAppAdapter.sendMessage` wires split + retry

#### Objective
Bring all the pieces together — adapter's public send.

#### Evidence
Without this, sending > 4096 chars silently truncates.

#### Files to edit
```
packages/gateway-whatsapp/src/adapter.ts — extend sendMessage
```

#### Deep file dependency analysis
- `adapter.ts` already exists from T1.4.
- This task adds: split → send-N-parts → return first error OR last success.

#### Deep Dives
- Send loop:
  ```typescript
  const parts = splitForWhatsApp(out.text);
  let lastMessageId: string | undefined;
  for (const part of parts) {
    const r = await backend.send({ ...out, text: part });
    if (!r.ok) return r;
    lastMessageId = r.messageId;
  }
  return { ok: true, messageId: lastMessageId };
  ```
- No retry in v1 (rate-limit is caller's concern; agent loop handles).

#### Tasks
1. Update `adapter.ts` `sendMessage` to wire `splitForWhatsApp`.
2. Return first failure if any part fails (don't send remaining parts).

#### TDD
```
RED:     test_send_short_message_one_call_to_backend
RED:     test_send_long_message_splits_into_n_parts
RED:     test_send_partial_failure_stops_remaining
RED:     test_send_returns_last_message_id_on_full_success
GREEN:   Implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/gateway-whatsapp test adapter.test.ts
```

#### Acceptance Criteria
- [ ] All adapter tests pass
- [ ] No truncation of > 4096 messages

#### DoD
- [ ] Public surface complete; ready for example

---

## Phase 5: Example + live smoke

### T5.1 — `examples/whatsapp-bot/` scaffold

#### Objective
Reference Express server using Cloud backend; env-gated.

#### Evidence
D284 (Slack) — example + env-gated live dogfood. Same pattern.

#### Files to edit
```
examples/whatsapp-bot/package.json (NEW)
examples/whatsapp-bot/.env.example (NEW)
examples/whatsapp-bot/README.md (NEW)
examples/whatsapp-bot/run.ts (NEW — Express server + adapter wire)
examples/whatsapp-bot/tsconfig.json (NEW)
```

#### Deep file dependency analysis
- Standalone example package — independent install.
- Depends on `@theokit/sdk` + `@theokit/gateway-whatsapp` (workspace) + `express` (or `hono`).
- `.env.example`: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `OPENROUTER_API_KEY`, `PORT`.

#### Deep Dives
- README explains:
  - Meta Business setup (link to Meta docs)
  - Webhook URL (must be HTTPS — ngrok or Cloudflare Tunnel locally)
  - GET verification (Meta requires GET `?hub.challenge=...` echo)
  - POST handling
  - Local testing with ngrok

#### Tasks
1. Create package.json with deps: `@theokit/sdk`, `@theokit/gateway-whatsapp`, `express`, `tsx`.
2. Create `run.ts`:
   - **(EC-2 absorbed)** Express MUST use `app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }))` BEFORE the route handlers. Without `verify`, Express consumes the stream and discards bytes → `verifyWebhookSignature` always fails. README documents this requirement prominently.
   - **(EC-1 absorbed)** GET `/webhook` handler:
     ```ts
     app.get("/webhook", (req, res) => {
       const challenge = verifyWebhookSubscription(req.query, process.env.WHATSAPP_VERIFY_TOKEN!);
       if (challenge === null) return res.sendStatus(403);
       res.type("text/plain").send(challenge);
     });
     ```
   - POST `/webhook` handler:
     ```ts
     app.post("/webhook", async (req, res) => {
       const ok = verifyWebhookSignature(
         (req as any).rawBody,
         req.header("x-hub-signature-256") ?? "",
         process.env.WHATSAPP_APP_SECRET!,
       );
       if (!ok) return res.sendStatus(401);
       await adapter.getBackend().handleWebhookPayload((req as any).rawBody, req.header("x-hub-signature-256")!);
       res.sendStatus(200);
     });
     ```
   - On inbound: `Agent.getOrCreate` per chat, send response.
3. Create `.env.example` with all required vars including `WHATSAPP_VERIFY_TOKEN` (any random string the user also configures in Meta Developer Console).
4. Create README with Meta-setup walkthrough including:
   - **(EC-13 absorbed)** explicit step about pre-registering test recipient phone numbers in Meta Console (sandbox limit 5).
   - **(EC-2 reminder)** the `express.json({ verify })` requirement explained.
   - GET vs POST distinction (`hub.challenge` echo).

#### TDD
```
RED:     N/A (this is example code; typecheck only)
GREEN:   pnpm typecheck on the example dir
REFACTOR: None expected
VERIFY:  cd examples/whatsapp-bot && pnpm install && pnpm tsx --no-warnings run.ts --dry-run  # exits cleanly if env unset
```

#### Acceptance Criteria
- [ ] Example typechecks
- [ ] README has 8-step Meta setup walkthrough
- [ ] `.env.example` lists every required var

#### DoD
- [ ] Example runnable (modulo Meta-side setup which is user-side)

---

### T5.2 — Env-gated live smoke

#### Objective
Run example against real Meta Cloud API (env-gated; skip silently if no creds).

#### Evidence
`.claude/rules/real-llm-validation.md` — anything claiming "validated" needs real backend hit.

#### Files to edit
```
examples/whatsapp-bot/smoke.ts (NEW)
```

#### Deep file dependency analysis
- `smoke.ts` is a standalone validation script.
- Sends one message to a configured test phone, awaits delivery receipt, asserts roundtrip.

#### Deep Dives
- Script:
  1. Read env. If any required var missing → log "skipped" + exit 0.
  2. Construct `WhatsAppCloudClient` directly (skip adapter).
  3. POST a test message to `WHATSAPP_TEST_PHONE`.
  4. Assert response has `messages[0].id` starting with `wamid.`.
  5. Log result.

#### Tasks
1. Create `smoke.ts`.
2. Implement env check + skip gate.
3. Implement one-shot send + assertion.
4. Document in README how to run.

#### TDD
```
RED:     N/A (smoke is itself the test)
GREEN:   With env unset: exits 0 with "skipped" message
GREEN:   With env set + valid creds: returns wamid
REFACTOR: None expected
VERIFY:  cd examples/whatsapp-bot && pnpm tsx smoke.ts
```

#### Acceptance Criteria
- [ ] Skips cleanly without creds
- [ ] Hits real Meta API when creds present
- [ ] Captures wamid in output

#### DoD
- [ ] Live validation evidence captured (or "skipped — pending Meta-side setup")

---

## Phase 6: Docs site update

### T6.1 — Update `concepts/gateways.mdx` to mention WhatsApp

#### Objective
WhatsApp shows up in the Gateways concept page.

#### Evidence
T1.4 ships `WhatsAppAdapter`; concepts table must list it.

#### Files to edit
```
../theo-opendocs/content/theokit-sdk/concepts/gateways.mdx — add row to "Shipped adapters" table
```

#### Tasks
1. Add `@theokit/gateway-whatsapp` row to the table.
2. Update the roadmap blurb (no longer "v1.4 adds WhatsApp" — now "shipped").

#### TDD
```
RED:     test_gateways_mdx_lists_whatsapp — grep for whatsapp in concepts/gateways.mdx
GREEN:   Edit
VERIFY:  grep -i whatsapp ../theo-opendocs/content/theokit-sdk/concepts/gateways.mdx
```

#### Acceptance Criteria
- [ ] Page lists WhatsApp alongside Slack/Telegram/Discord

#### DoD
- [ ] Build verde

---

### T6.2 — Cookbook recipe auto-generated from `examples/whatsapp-bot/`

#### Objective
The cookbook generator (Phase 5 of docs-site plan) picks up the new example automatically. Just regenerate.

#### Evidence
`theo-opendocs/scripts/generate-sdk-cookbook.ts` auto-discovers examples.

#### Files to edit
```
../theo-opendocs/content/theokit-sdk/cookbook/whatsapp-bot.mdx (regenerated, not hand-written)
```

#### Tasks
1. Run `pnpm generate:sdk-cookbook` in theo-opendocs.
2. Verify `cookbook/whatsapp-bot.mdx` emitted.
3. Build site and confirm it renders.

#### TDD
```
RED:     test_cookbook_includes_whatsapp_bot — after regen, file exists
GREEN:   Regen
VERIFY:  test -f ../theo-opendocs/content/theokit-sdk/cookbook/whatsapp-bot.mdx
```

#### Acceptance Criteria
- [ ] Recipe rendered in `out/`

#### DoD
- [ ] Build verde

---

### T6.3 — Drift checker re-run

#### Objective
Confirm drift checker is still clean after additions.

#### Files to edit
```
(none — verification only)
```

#### Tasks
1. `pnpm --filter @theokit/sdk run docs:drift` from theokit-sdk root.
2. Confirm exit 0.

#### TDD
```
GREEN:   Exit 0
VERIFY:  pnpm --filter @theokit/sdk run docs:drift; echo $?
```

#### Acceptance Criteria
- [ ] Drift checker exits 0

#### DoD
- [ ] Zero drift

---

## Phase 7: Dogfood + commit

### T7.1 — SDK dogfood (sanity)

#### Objective
Plan doesn't touch SDK runtime, but confirm zero regression.

#### Files to edit
```
(none — verification)
```

#### Tasks
1. Boot telegram-pro bot.
2. Run `/dogfood full`.
3. Confirm 44/44 PASS.

#### TDD
```
GREEN:   44/44 PASS
VERIFY:  Read snapshot file
```

#### Acceptance Criteria
- [ ] Telegram-pro dogfood 44/44 PASS, zero regression

#### DoD
- [ ] Sanity confirmed

---

### T7.2 — Package validation (publint + attw)

#### Objective
Confirm the new package is npm-publishable.

#### Files to edit
```
(none — verification)
```

#### Tasks
1. Build the package.
2. Run `publint dist/` and `attw --pack`.
3. Resolve any errors.

#### TDD
```
GREEN:   publint zero errors, attw zero failures
VERIFY:  pnpm --filter @theokit/gateway-whatsapp publint && pnpm --filter @theokit/gateway-whatsapp attw
```

#### Acceptance Criteria
- [ ] publint clean
- [ ] attw clean

#### DoD
- [ ] Package ready to publish (not actually published in v1 — local validation only)

---

### T7.3 — Commit + push (both repos)

#### Objective
Land the work.

#### Tasks
1. theokit-sdk: stage new package + CHANGELOG + roadmap update.
2. theokit-sdk: commit "feat(gateway): @theokit/gateway-whatsapp v0.1.0 (Roadmap v1.4 #2)".
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
| 1 | Multi-backend support (D303) | T1.3, T2.1-T2.3, T3.1-T3.3 | Backend interface + Cloud + Web implementations |
| 2 | Native fetch only for Cloud (D304) | T2.1 | `WhatsAppCloudClient` uses `fetch` |
| 3 | Subprocess pattern for Web (D305) | T3.1, T3.2, T3.3 | Spawn + PID lock + IPC |
| 4 | Webhook out of scope (D306) | T2.2 | Helpers, not server |
| 5 | Status receipts dedicated hook (D307) | T1.4, T2.3, T3.3 | `onStatusReceipt` separate from `onInbound` |
| 6 | `PlatformName` opens to whatsapp (D308) | T1.2 | Union extended |
| 7 | Group mention default (D309) | T1.4 | Filter in adapter |
| 8 | 4096-char split (D310) | T4.2, T4.3 | `splitForWhatsApp` + send loop |
| 9 | Phone number ID in Cloud (D311) | T1.2, T2.1, T2.3 | Type discriminated by backend |
| 10 | HMAC-SHA256 signature (D312) | T2.2 | `verifyWebhookSignature` |
| 11 | PID file lock (D313) | T3.1 | `acquirePidLock` |
| 12 | v0.1.0 version (D314) | T1.1 | package.json |
| 13 | Example + env-gated live (D284 pattern) | T5.1, T5.2 | `examples/whatsapp-bot/` + smoke |
| 14 | Docs site update | T6.1, T6.2, T6.3 | Concepts + cookbook + drift |
| 15 | Zero regression | T7.1 | telegram-pro dogfood |
| 16 | npm publishable | T7.2 | publint + attw |

**Coverage: 16/16 (100%)**

## Global Definition of Done

- [ ] Phases 0-7 complete
- [ ] All tests passing in `@theokit/gateway-whatsapp`
- [ ] `@theokit/gateway` bumped to 0.2.0 (union opened)
- [ ] `examples/whatsapp-bot/` scaffold + README + smoke
- [ ] theo-opendocs `concepts/gateways.mdx` updated + cookbook regenerated
- [ ] Drift checker clean
- [ ] publint + attw clean on the new package
- [ ] CHANGELOG entries in both `gateway` and `gateway-whatsapp` packages
- [ ] CLAUDE.md Roadmap v1.4 #2 marked ✅ DONE
- [ ] **SDK dogfood telegram-pro: 44/44 PASS** (zero regression — plan only adds new package, doesn't touch SDK runtime)
- [ ] Live smoke either PASS (with Meta-side setup) or skipped honestly per `.claude/rules/real-llm-validation.md`

## Final Phase: Dogfood QA (MANDATORY)

> Plan does not touch SDK runtime. Dogfood is **sanity** + WhatsApp-specific **smoke**.

### Execution

1. SDK sanity: `/dogfood full` — telegram-pro must remain 44/44 PASS.
2. WhatsApp smoke: `cd examples/whatsapp-bot && pnpm tsx smoke.ts`.

### Acceptance Criteria

- [ ] SDK dogfood: 44/44 PASS (zero regression)
- [ ] WhatsApp smoke: PASS (with creds) OR skip honestly (without creds)
- [ ] Zero CRITICAL or HIGH issues introduced

### If Dogfood Fails

1. SDK regression → unexpected (no SDK changes). Investigate.
2. Smoke fail → check Meta-side setup (token, phone number, app secret).
3. Pre-existing issues documented, do not block.
