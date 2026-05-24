# Plan: `@usetheo/gateway-email` v0.1.0 (Roadmap v1.4 #4)

> **Version 1.1** (2026-05-24) — Ship the Email adapter for `@usetheo/gateway` using the **Node community standard 2026 stack**: `nodemailer` (SMTP outbound), `imapflow` (IMAP IDLE/poll inbound), `mailparser` (RFC 5322 parsing). v1 scope: 1:1 DMs (sender ↔ bot), text body, threading via `Message-ID`/`In-Reply-To`/`References` chain (RFC 5322). Inspired by `referencia/hermes-agent/gateway/platforms/email.py` (773 lines) but adapted to Node async/await idioms and the modern `imapflow` IDLE-first approach. Env-gated example using Gmail App Passwords + IMAP/SMTP. Expected outcome: builders can drop `@usetheo/gateway-email` into their stack and reach the **most universal communication channel ever invented** — zero client onboarding required from the user side. Completes the v1.4 enterprise triangle (Slack ✅ + Teams ✅ + WhatsApp ✅ + Email).

> **Edge-case review 2026-05-24 absorbed (v1.1):** 5 MUST FIX identified by `/edge-case-plan`:
> - **EC-1** (T5.3, CRITICAL) — drop own-address loopback FIRST in `_dispatchInbound`. Without this, mailing-lists / BCC-self / Gmail "All Mail" cause infinite send/receive loop = $$ in LLM tokens.
> - **EC-2** (T2.2 + types) — `maxBodyChars` option (default 50000) truncates body to prevent LLM context blast on HTML-heavy newsletters.
> - **EC-3** (T4.2) — `isAllowedSender` normalizes BOTH sides via address-extract regex so `"Alice <alice@e.com>"` in allowlist matches inbound `alice@e.com`.
> - **EC-4** (T5.3) — Promise queue serializes `_dispatchInbound` to defeat IDLE race condition (duplicate replies on rapid `exists` events).
> - **EC-5** (T2.2) — `subject` fallback to `"(no subject)"` when mailparser returns undefined (typed string non-optional was lying).
>
> SHOULD TEST (EC-6/7/8) folded into TDD lists; DOCUMENT (EC-9/10/11) added as README troubleshooting notes.

## Context

### What exists today

- 5 gateways shipped: `@usetheo/gateway-telegram`, `@usetheo/gateway-discord`, `@usetheo/gateway-slack`, `@usetheo/gateway-whatsapp`, `@usetheo/gateway-teams` (D170-D326).
- `@usetheo/gateway@0.3.0` — `BasePlatformAdapter` + closed `PlatformName = "telegram" | "discord" | "slack" | "whatsapp" | "teams"`. Opens to `"email"` per the D308/D325 additive-bump pattern.
- `examples/whatsapp-bot/` and `examples/teams-bot/` demonstrate the pattern: env-gated standalone example, README walkthrough, smoke that validates credentials.

### What's missing

- No Email adapter. Email is the **most universal messaging channel** — every business email user can talk to the bot with zero install. Particularly powerful for:
  - Corporate B2B where Slack/Teams isn't yet provisioned
  - Long-form async conversations (research, support tickets)
  - One-off automations (CC the bot into a thread; it replies)
  - Markets where chat-app penetration is low (some regions still email-first)
- Roadmap v1.4 #4 in `CLAUDE.md`. Hermes has it (`gateway/platforms/email.py`); OpenClaw does NOT — Email is uniquely a Hermes-only reference.

### Evidence motivating the work

- `referencia/hermes-agent/gateway/platforms/email.py` (773 lines) — battle-tested adapter with:
  - IMAP polling at 15s default
  - Seen-UID set with bounded growth + periodic trim
  - Automated-sender filter (`noreply`, `postmaster`, `mailer-daemon`, etc.)
  - Allowed-users env-var whitelist
  - Threading via `Message-ID` / `In-Reply-To` / `References` headers (RFC 5322)
  - SMTP outbound with proper threading reciprocity
  - Attachment skip option (memory pressure guard)
- Community-standard 2026 Node stack (`pnpm view`):
  - `nodemailer@8.0.8` — 14-year-old battle-tested SMTP sender, literally everyone uses
  - `imapflow@1.3.3` — modern async/await IMAP with native IDLE support
  - `mailparser@3.9.8` — same-author MIME parser; pairs with nodemailer
- Roadmap entry: "IMAP/SMTP é território conhecido; risco baixo, valor alto e estável" — confirmed by the trivial peer-dep choices.

### Reference patterns we'll borrow

| Pattern | Source | Lesson |
|---|---|---|
| `imapflow` IMAP IDLE preferred, poll fallback | Modern Node idiom | IDLE is push-style; SDK opens long-lived connection; broker pushes UID notification on new messages. Polling only if server doesn't advertise IDLE. |
| Seen-UID Set capped + FIFO trim | Hermes lines 276-290 | Memory leak guard in long-running bots. |
| Threading via Message-ID chain | Hermes lines 401-548 + RFC 5322 §3.6.4 | Reply preserves `In-Reply-To` (immediate parent) + `References` (full chain). |
| Automated sender filter (regex + headers) | Hermes lines ~50 + `Auto-Submitted` header | Block bounce / mailer-daemon / noreply loops at the gate. |
| Allowed-sender allowlist | Hermes env `EMAIL_ALLOWED_USERS` | Security default — open unless explicitly restricted. |
| Plain-text body via `mailparser.text` | Modern Node idiom | Built-in HTML→text conversion; no custom HTML stripper. |
| Attachment skip in v0.1 | Hermes `_skip_attachments` flag | Memory + agent-context cost; deferred to v0.2 with proper Memory integration. |

## Objective

**Done = a user can `pnpm add @usetheo/gateway-email`, set 4 env vars (`EMAIL_ADDRESS`/`EMAIL_PASSWORD`/`EMAIL_IMAP_HOST`/`EMAIL_SMTP_HOST`), and their `@usetheo/sdk` agent receives Gmail messages + replies in the same thread.**

Measurable goals:

1. Package `@usetheo/gateway-email` v0.1.0 shippable via npm (publint + attw clean).
2. `EmailAdapter` extends `BasePlatformAdapter`; passes `instanceof` checks; never throws on platform errors per D172 contract.
3. Inbound: IMAP IDLE preferred, polling fallback. Normalized to `EmailMessageEvent` with portable fields + `event.email.raw` escape hatch.
4. Outbound: SMTP via `nodemailer`. Threading reciprocity (preserves `In-Reply-To` + `References`).
5. Automated-sender filter active by default (configurable disable).
6. Allowed-sender allowlist via `EMAIL_ALLOWED_USERS` env var.
7. `PlatformName` union extended to include `"email"`.
8. `examples/email-bot/` scaffold + README with Gmail App Password walkthrough; env-gated live smoke.
9. `theo-opendocs` cookbook recipe auto-generated.
10. Drift checker clean.
11. SDK telegram-pro dogfood: 44/44 PASS (zero regression — plan only adds new package).

## ADRs

### D327 — Lib choice: `nodemailer` + `imapflow` + `mailparser`
- **Decision:** SMTP via `nodemailer@^8`, IMAP via `imapflow@^1`, MIME parsing via `mailparser@^3`. All three are community-standard 2026 picks.
- **Rationale:**
  - `nodemailer` — 14 years of production use across Node ecosystem; the de facto SMTP library. Maintained by Andris Reinman who also maintains `imapflow` and `mailparser`. Single author → consistent API + low integration friction.
  - `imapflow` — modern async/await IMAP client with first-class IDLE support. Alternatives: `node-imap` (callback-based, in maintenance-only), `imap-simple` (wraps the same outdated `node-imap`). `imapflow` is unambiguously the right choice for 2026 Node async code.
  - `mailparser` — RFC 5322 parser with HTML-to-text conversion built-in (`mail.text` field). Avoids us writing a MIME parser or HTML stripper.
- **Consequences:** Three peer deps. Aggregate install footprint ~5 MB (small). All three are stable + actively maintained — low maintenance risk.

### D328 — IMAP IDLE preferred, 15s polling fallback
- **Decision:** Default to `imapflow.idle()` (long-lived connection; server pushes UID change events). If the server doesn't advertise IDLE capability, fall back to 15s polling via `client.fetch()` + UID search.
- **Rationale:** IDLE is significantly more efficient than polling — zero wasted requests when no new mail. Modern IMAP servers (Gmail, Outlook, Fastmail, etc.) all support IDLE. Polling fallback covers edge-case providers (some self-hosted servers) without breaking. Hermes Python uses polling-only because `imaplib` lacks robust IDLE; we have `imapflow.idle()` natively.
- **Consequences:** Default behavior is push-style. Long-lived connection requires reconnect-on-disconnect logic (handled by `imapflow.events.on("close", ...)`).

### D329 — Threading via `Message-ID` + `In-Reply-To` + `References` (RFC 5322 §3.6.4)
- **Decision:** Inbound `event.email.messageId` = the raw `Message-ID` header (with `<>` stripped). Outbound `sendMessage` reads `out.channel.topicId` as the message id we're replying to; sets `In-Reply-To` = that id and `References` = the full chain (received `References` + appended received `Message-ID`).
- **Rationale:** This is the RFC-correct way to thread email. Hermes does it. Every email client (Gmail, Outlook, Apple Mail) groups by `References` chain. Without it, replies appear as new threads → terrible UX.
- **Consequences:** `EmailMessageEvent.email.{messageId, inReplyTo, references}` carry the chain. The agent's reply is grouped in the same thread for the user.

### D330 — `topicId = raw Message-ID` (with angle brackets stripped)
- **Decision:** `channel.topicId` = the inbound `Message-ID` (e.g., `<abc@gmail.com>` → `abc@gmail.com`). When replying, the adapter reconstructs `<topicId>` and sends as `In-Reply-To`.
- **Rationale:** `topicId` is opaque — it's a routing primitive consumers may store as session-key. Stripping `<>` keeps it printable. Reconstructing on send keeps RFC compliance.
- **Consequences:** Caller never has to know about `<>` braces. Adapter handles the format.

### D331 — Seen-UID Set capped at 5000 (FIFO eviction)
- **Decision:** `Set<number>` of UIDs we've already dispatched. When `size >= 5000`, drop the oldest 1000 entries (FIFO via insertion order, same trick as WhatsApp ConversationReferenceStore).
- **Rationale:** Without cap, a long-running bot accumulates UIDs forever → unbounded memory. Hermes does the same with `_seen_uids_max` (default 5000) and `_trim_seen_uids()`. We match their cap.
- **Consequences:** Memory bounded. Trade-off: if 1001+ UNSEEN messages arrive in a single poll, the oldest 1000 could be re-dispatched after eviction. Mitigated by IMAP's UID is monotonic — the IMAP `UNSEEN` search already returns only new messages, so this is theoretical.

### D332 — Automated-sender filter ON by default (header + regex)
- **Decision:** Drop inbound messages where:
  - Sender address matches `/^(noreply|no-reply|no_reply|donotreply|do-not-reply|mailer-daemon|postmaster|bounce)/i`, OR
  - Header `Auto-Submitted: auto-generated` (or `auto-replied`) is present (RFC 3834), OR
  - Header `Precedence: bulk` or `Precedence: list` is present (legacy convention)
- **Rationale:** Without this, a single noreply newsletter triggers an agent reply → infinite loop OR wasted LLM call. Hermes has the same regex list. RFC 3834 is the standard auto-reply marker.
- **Consequences:** Configurable via `EmailAdapterOptions.allowAutomated: true` for power users who specifically want to handle bounces. Default is safe.

### D333 — Allowed-sender allowlist (open default)
- **Decision:** `EmailAdapterOptions.allowedSenders?: string[]` — when set, drop messages from senders NOT in the list (exact email match, case-insensitive). When unset, allow all.
- **Rationale:** Security primitive — email is the most spammable channel; without an allowlist, anyone can talk to your bot. But forcing an allowlist hurts dev UX. Hermes has `EMAIL_ALLOWED_USERS` as opt-in env. We match.
- **Consequences:** Production users MUST configure; dev users can skip. README documents prominently.

### D334 — HTML-to-text via `mailparser.text` (no custom stripper)
- **Decision:** Inbound `event.text` = `parsed.text` field from `mailparser`. The library converts HTML body → plain text via its built-in converter (handles tags, links, quoted-replies).
- **Rationale:** Re-implementing HTML→text is a rabbit hole (`<br>`, `<p>`, quoted replies, signatures, MIME multipart/alternative, etc.). `mailparser` handles all of it.
- **Consequences:** Zero dependency on `html-to-text` or similar. The raw HTML stays in `event.email.raw.html` for advanced users.

### D335 — Attachments: skip + warn in v0.1
- **Decision:** Inbound messages with attachments → adapter logs warning, drops the attachment, dispatches the text body anyway.
- **Rationale:** Attachments require Memory integration (where to store binaries?), MIME re-encoding on outbound, and policy choices (max size? allowed types?) that explode scope. v0.2 adds proper handling via `Memory` adapters.
- **Consequences:** `event.email.attachmentCount` populated for caller awareness. Documented as v0.1 limit in README.

### D336 — Channel mapping: `dm` only in v0.1 (no group threads)
- **Decision:** `channel.type = "dm"` always. `channel.id = sender_email`. Group/CC threads are dropped (when To/Cc has >1 recipient besides bot). v0.2 may add group thread support.
- **Rationale:** Email "groups" (CC-style threads) have no native concept of membership. Treating them as `"group"` would require us to track who's in the thread (CCs change per message). Out of scope v1.
- **Consequences:** Sender talks to bot 1:1 in v0.1. README documents.

### D337 — Outbound threading reciprocity
- **Decision:** When `out.channel.topicId` is set (the agent is replying to a previously-received message), the SMTP envelope MUST include:
  - `In-Reply-To: <topicId>`
  - `References: <chain> <topicId>` (concatenation of any inbound References + the message we're replying to)
  - `Subject: Re: <original-subject>` (prepended unless already starts with `Re:`)
- **Rationale:** RFC 5322 compliance. Without these headers, reply appears as a new thread in the user's client.
- **Consequences:** Adapter stores `subject + references` per `topicId` in an in-memory `Map` (bounded — D331-style). The agent's reply pulls subject + chain from the store on send.

### D338 — Initial version `0.1.0`
- **Decision:** Same as siblings (D171, D314, D324). Pre-1.0 contract; breaking changes within 0.x.
- **Rationale:** IMAP/SMTP themselves are stable, but our threading model + filter semantics may evolve.
- **Consequences:** Standard 0.x semver.

### D339 — `PlatformName` extends to `"email"`
- **Decision:** Open `@usetheo/gateway` `PlatformName` union to include `"email"`. Bump gateway to 0.4.0. Add `EmailMessageEvent` variant.
- **Rationale:** Same additive bump pattern (D308, D325). Existing consumers unaffected.
- **Consequences:** `@usetheo/gateway` 0.3.0 → 0.4.0.

## Dependency Graph

```
Phase 0 (audit — minimal; libs are well-known)
   │
   ▼
Phase 1 (package skeleton + types + adapter)
   │
   ├──▶ Phase 2 (IMAP inbound: IDLE + poll fallback)  ───┐
   │                                                       │
   ├──▶ Phase 3 (SMTP outbound + threading)             ───┤ parallel after Phase 1
   │                                                       │
   └──▶ Phase 4 (Filters: automated-sender + allowlist) ──┘
              │
              ▼
       Phase 5 (Errors + lifecycle + tests)
              │
              ▼
       Phase 6 (Example + env-gated smoke)
              │
              ▼
       Phase 7 (Docs site update)
              │
              ▼
       Phase 8 (Dogfood + commit)
```

- **Phase 1** gates everything.
- **Phases 2/3/4** parallel after types land.
- **Phase 5** depends on 2 + 3 (need integration to test).
- **Phase 6** depends on 5.
- **Phases 7-8** final.

---

## Phase 0: Audit

### T0.1 — Confirm peer dep versions + types

#### Objective
Validate `nodemailer`, `imapflow`, `mailparser` exist on npm + ship types via `@types/*` or built-in.

#### Evidence
The to-plan reconnaissance already confirmed:
- `nodemailer@8.0.8` (types via `@types/nodemailer`)
- `imapflow@1.3.3` (built-in TS types)
- `mailparser@3.9.8` (types via `@types/mailparser`)

This task is a sanity check — no `.d.ts` inspection like Teams (the libs are well-typed and well-documented).

#### Files to edit
```
(read-only sanity check)
```

#### Tasks
1. `pnpm view nodemailer dist.types` — confirm or note absence
2. `pnpm view imapflow dist.types` — confirm built-in TS
3. `pnpm view mailparser dist.types` — confirm or note absence
4. Document any `@types/*` packages needed in T1.1 devDependencies.

#### TDD
N/A (read-only).

#### Acceptance Criteria
- [ ] Lib versions pinned + type strategies documented
- [ ] T1.1 has the right peer + dev dep list

#### DoD
- [ ] Inventory ready

---

## Phase 1: Package skeleton + types + adapter shell

### T1.1 — Workspace package scaffold

#### Objective
Create `packages/gateway-email/` mirroring `gateway-teams/` skeleton.

#### Evidence
Sibling adapters all use the same skeleton (D171, D314, D324, D338).

#### Files to edit
```
packages/gateway-email/package.json (NEW)
packages/gateway-email/tsup.config.ts (NEW)
packages/gateway-email/tsconfig.json (NEW)
packages/gateway-email/vitest.config.ts (NEW)
packages/gateway-email/CHANGELOG.md (NEW)
packages/gateway-email/README.md (NEW)
packages/gateway-email/src/index.ts (NEW — empty barrel)
```

#### Deep file dependency analysis
- Template from `packages/gateway-teams/package.json`. Adjust name, peers.
- `peerDependencies`: `@usetheo/gateway`, `@usetheo/sdk`, `nodemailer@^8`, `imapflow@^1`, `mailparser@^3`.
- `devDependencies`: same peers + `@types/nodemailer`, `@types/mailparser`, tsup, typescript, vitest.

#### Deep Dives
- `sideEffects: false` from the start (publint suggestion absorbed early).
- `exports` field matches gateway-teams shape (ESM + CJS + d.ts/d.cts).

#### Tasks
1. Copy `gateway-teams/package.json` → `gateway-email/package.json`. Edit name, description, peers.
2. Copy tsup/tsconfig/vitest configs unchanged.
3. Create placeholder README + CHANGELOG.
4. Create empty `src/index.ts`.
5. Run `pnpm install` at workspace root.

#### TDD
```
RED:     test_package_resolves — `pnpm list @usetheo/gateway-email` shows it
GREEN:   Package skeleton in workspace
VERIFY:  pnpm install && pnpm list @usetheo/gateway-email
```

#### Acceptance Criteria
- [ ] `packages/gateway-email/` directory exists with 7 files
- [ ] `pnpm install` succeeds at root

#### DoD
- [ ] Skeleton commitable

---

### T1.2 — Extend `PlatformName` union + add `EmailMessageEvent`

#### Objective
Open the `MessageEvent` discriminated union to include `"email"`.

#### Files to edit
```
packages/gateway/src/types/message-event.ts — extend PlatformName + add EmailMessageEvent
packages/gateway/src/index.ts — export EmailMessageEvent
packages/gateway/package.json — 0.3.0 → 0.4.0
packages/gateway/CHANGELOG.md — record bump
packages/gateway/tests/types/message-event.test.ts — add email variant test + extend exhaustive switch
```

#### Deep Dives
- `EmailMessageEvent` shape:
  ```typescript
  export interface EmailMessageEvent extends BaseMessageEvent {
    readonly platform: "email";
    readonly email: {
      /** Raw Message-ID (without `<>` braces). Use as `topicId` for threading. */
      readonly messageId: string;
      /** Previous Message-ID this message replies to (if any). */
      readonly inReplyTo?: string;
      /** Full References chain (oldest → newest, space-separated, no braces). */
      readonly references?: readonly string[];
      /** Subject line (decoded). */
      readonly subject: string;
      /** Sender address (lowercased, normalized). */
      readonly fromAddress: string;
      /** Sender display name when present. */
      readonly fromName?: string;
      /** All To/Cc recipients (lowercased). Bot's own address EXCLUDED. */
      readonly recipients: readonly string[];
      /** Count of attachments (v0.1 doesn't include them — see D335). */
      readonly attachmentCount: number;
      /** Raw parsed mail object (mailparser ParsedMail) — escape hatch. */
      readonly raw: unknown;
    };
  }
  ```

#### Tasks
1. Add `"email"` to `PlatformName` union.
2. Add `EmailMessageEvent` interface.
3. Add to `MessageEvent` union export.
4. Update `@usetheo/gateway/package.json` to `0.4.0`.
5. Add CHANGELOG entry.
6. Update `tests/types/message-event.test.ts` exhaustive switch.

#### TDD
```
RED:     test_platform_name_includes_email — `const _p: PlatformName = "email"` typechecks
RED:     test_email_event_narrows — switch case "email" narrows to `event.email.messageId`
RED:     test_exhaustive_switch_covers_email — full union exhaustive
GREEN:   Types compile + tests pass
VERIFY:  pnpm --filter @usetheo/gateway typecheck && pnpm --filter @usetheo/gateway test
```

#### Acceptance Criteria
- [ ] `PlatformName` includes `"email"`
- [ ] `EmailMessageEvent` exported from `@usetheo/gateway`
- [ ] Sibling adapters typecheck
- [ ] CHANGELOG entry (0.4.0)

#### DoD
- [ ] Type opens cleanly
- [ ] Zero regression in sibling packages

---

### T1.3 — `EmailAdapter` class skeleton

#### Objective
Public-facing adapter. Holds `nodemailer.Transporter` + `imapflow.ImapFlow` clients + lifecycle methods. Real wiring lands in Phases 2-4.

#### Files to edit
```
packages/gateway-email/src/adapter.ts (NEW)
packages/gateway-email/src/types.ts (NEW)
packages/gateway-email/src/index.ts (extend barrel)
```

#### Deep Dives
- `EmailAdapterOptions`:
  ```typescript
  export interface EmailAdapterOptions {
    /** Email address the bot listens on (also the From: of outbound). */
    readonly address: string;
    /** Password — for Gmail use an App Password (NOT the account password). */
    readonly password: string;
    /** IMAP server (e.g., "imap.gmail.com"). */
    readonly imapHost: string;
    /** IMAP port. Default 993 (SSL). */
    readonly imapPort?: number;
    /** SMTP server (e.g., "smtp.gmail.com"). */
    readonly smtpHost: string;
    /** SMTP port. Default 587 (STARTTLS). */
    readonly smtpPort?: number;
    /** Display name for outbound From: (defaults to address local-part). */
    readonly fromName?: string;
    /** Allowlist of sender addresses (case-insensitive exact match). Default: open (D333). */
    readonly allowedSenders?: readonly string[];
    /** Allow automated senders (noreply, postmaster, bounce). Default: false (D332). */
    readonly allowAutomated?: boolean;
    /** Polling interval in ms when IMAP IDLE is unavailable. Default 15000. */
    readonly pollIntervalMs?: number;
    /** Max body chars before truncation (EC-2). Default 50000 (~12k tokens). */
    readonly maxBodyChars?: number;
    /** Test seam — inject fake clients. @internal */
    readonly __imapFactory?: (cfg: unknown) => unknown;
    readonly __smtpFactory?: (cfg: unknown) => unknown;
  }
  ```
- Constructor:
  1. Validate non-empty `address`, `password`, `imapHost`, `smtpHost` (similar to EC-1 pattern).
  2. Initialize empty `seenUids: Set<number>` (Phase 2 fills).
  3. Initialize empty `threadStore: Map<string, ThreadContext>` (Phase 3 fills).
- `connect()` (Phase 5 finalizes): test SMTP transport; open IMAP IDLE.
- `disconnect()`: close IMAP + SMTP.
- `sendMessage()` (Phase 3): SMTP + threading.
- `onInbound()`: register handler (EC-H replace semantics).

#### Tasks
1. Create `types.ts` with `EmailAdapterOptions`.
2. Create `adapter.ts` extending `BasePlatformAdapter` — stubs for connect/disconnect/sendMessage/onInbound.
3. Implement constructor with non-empty validation (EC-1 pattern).
4. Update `index.ts` barrel.

#### TDD
```
RED:     test_adapter_is_base_platform_adapter
RED:     test_adapter_platform_is_email
RED:     test_adapter_constructor_validates_non_empty_address
RED:     test_adapter_constructor_validates_non_empty_password
RED:     test_adapter_constructor_validates_non_empty_imap_host
RED:     test_adapter_constructor_validates_non_empty_smtp_host
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test adapter.test.ts
```

#### Acceptance Criteria
- [ ] `EmailAdapter` extends `BasePlatformAdapter`
- [ ] Constructor validates 4 required options
- [ ] All 6 tests pass
- [ ] File ≤ 350 lines

#### DoD
- [ ] Adapter shell ready for Phases 2-4 to fill

---

## Phase 2: IMAP inbound

### T2.1 — `imapflow` IMAP client wrapper

#### Objective
Wrap `imapflow.ImapFlow` with our test seams + reconnect logic.

#### Files to edit
```
packages/gateway-email/src/imap-client.ts (NEW)
```

#### Deep Dives
- `imapflow` API:
  ```typescript
  import { ImapFlow } from "imapflow";
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user, pass } });
  await client.connect();
  await client.getMailboxLock("INBOX");
  for await (const msg of client.fetch({ seen: false }, { uid: true, source: true, envelope: true })) {
    // msg.uid, msg.source (Buffer), msg.envelope
  }
  // IDLE:
  for await (const evt of client.idle()) {
    // evt: { type: "exists" | "expunge", count?: number }
  }
  ```
- Reconnect strategy: on `client.on("error")` or `client.on("close")` → wait 5s → reconnect. Bounded retry (10 attempts) — fail loudly after.
- IDLE detection: `client.capabilities.has("IDLE")` after connect.

#### Tasks
1. Create `imap-client.ts` exporting `ImapClient` class wrapping `ImapFlow`.
2. Implement `connect()`, `disconnect()`, `pollOnce()`, `idle(onEvent)`.
3. Implement reconnect loop with exponential backoff.

#### TDD
```
RED:     test_imap_client_connect_calls_imapflow_connect
RED:     test_imap_client_idle_invokes_callback_on_exists
RED:     test_imap_client_poll_returns_unseen_messages
RED:     test_imap_client_reconnect_after_close — auto-reconnect on connection drop
RED:     test_imap_client_disconnect_idempotent
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test imap-client.test.ts
```

#### Acceptance Criteria
- [ ] Pure delegation to `imapflow` — minimal wrapping logic
- [ ] Reconnect bounded (10 attempts max)
- [ ] Tests use a fake `ImapFlow` instance

#### DoD
- [ ] Stable IMAP client wrapper

---

### T2.2 — Inbound normalization (raw email → `EmailMessageEvent`)

#### Objective
Parse raw RFC 5322 bytes via `mailparser` → normalize to `EmailMessageEvent`.

#### Files to edit
```
packages/gateway-email/src/normalize.ts (NEW)
```

#### Deep Dives
- `mailparser` API:
  ```typescript
  import { simpleParser, ParsedMail } from "mailparser";
  const parsed: ParsedMail = await simpleParser(rawBuffer);
  // parsed.text (HTML→text), parsed.from, parsed.subject, parsed.messageId, parsed.inReplyTo, parsed.references, parsed.attachments
  ```
- Normalize:
  - `messageId`: strip `<>` from `parsed.messageId`
  - `inReplyTo`: strip `<>` from `parsed.inReplyTo` if present
  - `references`: `parsed.references` is either string or string[] — normalize to `readonly string[]` of stripped ids
  - `fromAddress`: lowercase `parsed.from?.value[0]?.address`
  - `recipients`: union of `parsed.to.value + parsed.cc.value` — exclude bot's own address
  - **(EC-5 absorbed)** `subject`: `parsed.subject ?? "(no subject)"`. mailparser may return undefined; non-optional type was lying. Sentinel matches industry convention.
  - **(EC-2 absorbed)** `text`: capped body to defeat LLM context blast on HTML-heavy newsletters:
    ```typescript
    const raw = parsed.text ?? "";
    const maxChars = opts.maxBodyChars ?? 50_000;
    const text = raw.length > maxChars
      ? raw.slice(0, maxChars) + "\n\n[truncated — full body in event.email.raw]"
      : raw;
    ```
    Default 50,000 chars ≈ 12k tokens. Caller can override via `EmailAdapterOptions.maxBodyChars`.
- Channel mapping (D336): `channel = { id: fromAddress, type: "dm", topicId: messageId }`.

#### Tasks
1. Create `normalize.ts` exporting `normalizeEmail(rawBuffer, opts: { botAddress: string; maxBodyChars?: number })`.
2. Implement parsing + field extraction.
3. Strip `<>` from message ids.
4. **(EC-5)** Subject fallback `"(no subject)"`.
5. **(EC-2)** Body truncation at `maxBodyChars` (default 50_000) with suffix marker.
6. Build `EmailMessageEvent` per D336.

#### TDD
```
RED:     test_normalize_extracts_message_id_without_braces
RED:     test_normalize_extracts_subject
RED:     test_normalize_missing_subject_fallback (EC-5) — parsed.subject undefined → "(no subject)"
RED:     test_normalize_extracts_plain_text_body
RED:     test_normalize_extracts_text_from_html_only (uses mailparser HTML→text)
RED:     test_normalize_html_only_empty_text_does_not_crash (EC-7 SHOULD TEST) — HTML email with no extractable text → text=""
RED:     test_normalize_body_truncated_at_max_chars (EC-2) — 60k chars input → text length ≤ maxChars + suffix; suffix present
RED:     test_normalize_body_custom_max_chars (EC-2) — maxBodyChars=100 → text capped at 100+suffix
RED:     test_normalize_body_under_limit_not_modified (EC-2)
RED:     test_normalize_references_chain_normalized_to_array
RED:     test_normalize_channel_id_is_lowercased_from_address
RED:     test_normalize_excludes_bot_from_recipients
RED:     test_normalize_topic_id_equals_message_id
RED:     test_normalize_reports_attachment_count
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test normalize.test.ts
```

#### Acceptance Criteria
- [ ] All 9 tests pass
- [ ] Sample MIME envelopes covered (text-only, HTML-only, multipart, with attachments)

#### DoD
- [ ] Normalizer pure (no I/O)

---

### T2.3 — Seen-UID Set with FIFO cap (D331)

#### Objective
Bounded `Set<number>` of dispatched UIDs.

#### Files to edit
```
packages/gateway-email/src/seen-uids.ts (NEW)
```

#### Deep Dives
- API:
  ```typescript
  export class SeenUidSet {
    private readonly set = new Set<number>();
    private static readonly MAX_SIZE = 5000;
    private static readonly TRIM_TO = 4000;

    has(uid: number): boolean { return this.set.has(uid); }
    add(uid: number): void {
      if (this.set.size >= SeenUidSet.MAX_SIZE) this.trim();
      this.set.add(uid);
    }
    private trim(): void {
      // Drop oldest entries (insertion order via Set iteration).
      const keys = Array.from(this.set);
      for (let i = 0; i < keys.length - SeenUidSet.TRIM_TO; i++) this.set.delete(keys[i]!);
    }
    get size(): number { return this.set.size; }
    clear(): void { this.set.clear(); }
  }
  ```

#### Tasks
1. Create `seen-uids.ts`.
2. Implement bounded Set with FIFO trim.
3. Test cap + trim behavior.

#### TDD
```
RED:     test_seen_uid_set_has_returns_false_for_unknown
RED:     test_seen_uid_set_add_then_has
RED:     test_seen_uid_set_caps_at_5000_with_fifo_trim — inserting 6000 UIDs drops oldest
RED:     test_seen_uid_set_clear_empties
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test seen-uids.test.ts
```

#### Acceptance Criteria
- [ ] Set never exceeds 5000 entries
- [ ] Trim deterministic (oldest dropped)

#### DoD
- [ ] Storage primitive ready

---

## Phase 3: SMTP outbound + threading

### T3.1 — `nodemailer` SMTP transport wrapper

#### Objective
Wrap `nodemailer.createTransport` with test seams.

#### Files to edit
```
packages/gateway-email/src/smtp-client.ts (NEW)
```

#### Deep Dives
- `nodemailer` API:
  ```typescript
  import { createTransport, Transporter } from "nodemailer";
  const transporter = createTransport({ host, port: 587, secure: false, auth: { user, pass } });
  await transporter.verify(); // connection test
  const info = await transporter.sendMail({
    from, to, subject, text,
    inReplyTo: `<msgid>`,
    references: ["<msgid1>", "<msgid2>"],
  });
  // info.messageId is the new <Message-ID>
  ```

#### Tasks
1. Create `smtp-client.ts` exporting `SmtpClient` class wrapping `Transporter`.
2. Implement `verify()`, `send(opts)`, `close()`.
3. Threading: serialize references array back to `< >`-bracketed string list.

#### TDD
```
RED:     test_smtp_client_verify_calls_transporter_verify
RED:     test_smtp_client_send_builds_envelope — verify from/to/subject/text/inReplyTo
RED:     test_smtp_client_send_serializes_references_with_braces
RED:     test_smtp_client_send_returns_new_message_id (without `<>`)
RED:     test_smtp_client_send_utf8_subject (EC-8) — subject "Olá, café ☕" → nodemailer encodes per RFC 2047
RED:     test_smtp_client_close_idempotent
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test smtp-client.test.ts
```

#### Acceptance Criteria
- [ ] References + inReplyTo formatted with `<>` braces (RFC 5322)
- [ ] Returned message id stripped of braces (consistency with inbound)

#### DoD
- [ ] SMTP client ready

---

### T3.2 — Thread context store (D337)

#### Objective
`Map<messageId, ThreadContext>` storing `{ subject, references, lastMessageId }` per inbound. Consumed on outbound to reconstruct headers.

#### Files to edit
```
packages/gateway-email/src/thread-store.ts (NEW)
```

#### Deep Dives
- API:
  ```typescript
  export interface ThreadContext {
    readonly subject: string;
    readonly references: readonly string[];
    readonly lastMessageId: string; // most recent message in the chain
  }
  export class ThreadStore {
    private readonly map = new Map<string, ThreadContext>();
    private static readonly MAX_SIZE = 1000;
    recordFromInbound(event: EmailMessageEvent): void;
    lookup(topicId: string): ThreadContext | undefined;
    get size(): number;
    clear(): void;
  }
  ```
- Memory cap 1000 (FIFO eviction — same pattern as Teams T2.4 / WhatsApp T2.4).

#### Tasks
1. Create `thread-store.ts`.
2. Implement bounded Map with FIFO trim.
3. `recordFromInbound` extracts subject + references + messageId.

#### TDD
```
RED:     test_thread_store_records_from_inbound
RED:     test_thread_store_lookup_returns_undefined_for_unknown
RED:     test_thread_store_caps_at_1000
RED:     test_thread_store_subject_decoded_from_event
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test thread-store.test.ts
```

#### Acceptance Criteria
- [ ] Map never exceeds 1000 entries

#### DoD
- [ ] Store used by `sendMessage` in T3.3

---

### T3.3 — `EmailAdapter.sendMessage` end-to-end (threading reciprocity)

#### Objective
Wire SMTP + thread store + threading headers.

#### Files to edit
```
packages/gateway-email/src/adapter.ts — extend sendMessage
```

#### Deep Dives
- Pseudocode:
  ```typescript
  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) return { ok: false, error: { code: "empty_text", message: "..." } };
    if (!this.connected || this.smtp === undefined) return { ok: false, error: { code: "not_connected", ... } };

    const to = out.channel.id; // sender_email (D336)
    const topicId = out.channel.topicId;
    const context = topicId !== undefined ? this.threadStore.lookup(topicId) : undefined;

    const subject = context !== undefined
      ? (context.subject.startsWith("Re:") ? context.subject : `Re: ${context.subject}`)
      : "Message from agent";
    // EC-6: dedup the chain — if server's References header already contained lastMessageId,
    // the simple concat would duplicate it (bad for some clients' threading).
    const references = context !== undefined
      ? Array.from(new Set([...context.references, context.lastMessageId]))
      : undefined;
    const inReplyTo = context !== undefined ? context.lastMessageId : undefined;

    try {
      const messageId = await this.smtp.send({
        from: this.options.fromName !== undefined
          ? { name: this.options.fromName, address: this.options.address }
          : this.options.address,
        to,
        subject,
        text: out.text,
        inReplyTo,
        references,
      });
      return { ok: true, messageId };
    } catch (err) {
      return { ok: false, error: mapEmailError(err) };
    }
  }
  ```

#### Tasks
1. Update `sendMessage` per pseudocode.
2. Subject `Re:` prepending (only if not already prefixed).
3. References chain concatenation.

#### TDD
```
RED:     test_send_no_topic_id_uses_default_subject — no thread context → "Message from agent"
RED:     test_send_with_topic_id_prepends_re_to_subject — "Hello" → "Re: Hello"
RED:     test_send_already_re_subject_not_double_prepended — "Re: x" stays "Re: x"
RED:     test_send_constructs_references_chain — context refs + last msg id
RED:     test_send_references_dedup (EC-6) — when context.references already includes lastMessageId, final array has it ONCE
RED:     test_send_in_reply_to_is_last_message_id
RED:     test_send_empty_text_returns_error
RED:     test_send_not_connected_returns_error
RED:     test_send_returns_message_id
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test adapter.test.ts
```

#### Acceptance Criteria
- [ ] All 8 tests pass
- [ ] Threading headers RFC-correct
- [ ] Subject prepending idempotent

#### DoD
- [ ] Outbound complete

---

## Phase 4: Filters

### T4.1 — Automated-sender filter (D332)

#### Objective
Drop messages from noreply / postmaster / Auto-Submitted senders BEFORE dispatching.

#### Files to edit
```
packages/gateway-email/src/filters.ts (NEW)
```

#### Deep Dives
- Regex patterns:
  ```typescript
  const NOREPLY_RE = /^(noreply|no-reply|no_reply|donotreply|do-not-reply|mailer-daemon|postmaster|bounce|notifications)@/i;
  ```
- Header checks:
  - `Auto-Submitted: auto-generated` or `auto-replied` (RFC 3834)
  - `Precedence: bulk` or `list`
  - `X-Auto-Response-Suppress: All` (Microsoft)
- API:
  ```typescript
  export function isAutomatedSender(
    fromAddress: string,
    headers: Map<string, string>,
  ): boolean;
  ```

#### Tasks
1. Create `filters.ts`.
2. Implement `isAutomatedSender(fromAddress, headers)`.
3. Test each pattern + header combo.

#### TDD
```
RED:     test_filter_blocks_noreply_addresses
RED:     test_filter_blocks_postmaster
RED:     test_filter_blocks_mailer_daemon
RED:     test_filter_blocks_auto_submitted_header
RED:     test_filter_blocks_precedence_bulk_header
RED:     test_filter_allows_normal_user_address
RED:     test_filter_case_insensitive
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test filters.test.ts
```

#### Acceptance Criteria
- [ ] 7 tests pass
- [ ] Pure function (no I/O)

#### DoD
- [ ] Filter consumed by `_dispatchInbound`

---

### T4.2 — Allowed-sender allowlist (D333)

#### Objective
When `allowedSenders` option set, drop messages from senders NOT in the list.

#### Files to edit
```
packages/gateway-email/src/filters.ts — add isAllowedSender
```

#### Deep Dives
- API:
  ```typescript
  export function isAllowedSender(
    fromAddress: string,
    allowedSenders: readonly string[] | undefined,
  ): boolean;
  ```
- Case-insensitive exact match. `undefined` allowlist → returns `true`.
- **(EC-3 absorbed)** Normalize BOTH sides via address-extract helper. If user passes `"Alice <alice@example.com>"` as an allowlist entry, the embedded brackets MUST be stripped before comparing to the inbound `fromAddress` (which is already pure):
  ```typescript
  function extractAddr(s: string): string {
    const m = s.match(/<([^>]+)>/);
    return (m?.[1] ?? s).toLowerCase().trim();
  }
  export function isAllowedSender(fromAddress: string, allowedSenders?: readonly string[]): boolean {
    if (allowedSenders === undefined) return true;
    const norm = fromAddress.toLowerCase().trim();
    return allowedSenders.some(s => extractAddr(s) === norm);
  }
  ```
  Without this, common copy-paste from `From:` header (`"Alice" <alice@...>`) silently blocks legitimate users.

#### Tasks
1. Add `isAllowedSender` to `filters.ts`.
2. Test allowed + denied + open paths.

#### TDD
```
RED:     test_allowed_sender_undefined_allowlist_allows_all
RED:     test_allowed_sender_empty_allowlist_denies_all (empty array MEANS no one allowed)
RED:     test_allowed_sender_exact_match
RED:     test_allowed_sender_case_insensitive
RED:     test_allowed_sender_not_in_list_denied
RED:     test_allowed_sender_bracketed_allowlist_entry (EC-3) — allowlist `["Alice <alice@e.com>"]` matches inbound `alice@e.com`
RED:     test_allowed_sender_pure_email_in_allowlist (EC-3) — allowlist `["alice@e.com"]` matches inbound `alice@e.com` (no regression)
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test filters.test.ts
```

#### Acceptance Criteria
- [ ] 5 tests pass
- [ ] Undefined = open; empty array = closed (intentional distinction)

#### DoD
- [ ] Filter pipeline complete

---

## Phase 5: Errors + lifecycle wire

### T5.1 — Error mapper (`mapEmailError`)

#### Objective
Map IMAP/SMTP errors → canonical `SendResult.error`.

#### Files to edit
```
packages/gateway-email/src/errors.ts (NEW)
```

#### Deep Dives
- Common error patterns:
  - `nodemailer` auth fail → `EAUTH` error code → `auth_failed`
  - `nodemailer` SMTP refused → `ECONNECTION` / `ESOCKET` → `server_error`
  - SMTP 421 / 5xx response codes → server_error
  - SMTP 550 (no such user) → `invalid_request`
  - `imapflow` auth fail → throws with error name `IMAP_AUTH_FAILED` → `auth_failed`
  - Plain Error (network) → `server_error` via regex fallback (same as Teams EC-7).

#### Tasks
1. Create `errors.ts`.
2. Implement `mapEmailError(err)`.

#### TDD
```
RED:     test_map_smtp_eauth_to_auth_failed
RED:     test_map_smtp_econnection_to_server_error
RED:     test_map_smtp_550_to_invalid_request
RED:     test_map_imap_auth_failed
RED:     test_map_plain_error_econnrefused_to_server_error
RED:     test_map_null_to_unknown
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test errors.test.ts
```

#### Acceptance Criteria
- [ ] 6 codes covered (auth_failed, rate_limit, invalid_request, server_error, not_connected, unknown)

#### DoD
- [ ] Mapper consumed by smtp-client + sendMessage

---

### T5.2 — `connect()` / `disconnect()` finalization

#### Objective
Wire IMAP IDLE/poll + SMTP verify into adapter lifecycle.

#### Files to edit
```
packages/gateway-email/src/adapter.ts — finalize connect/disconnect
```

#### Deep Dives
- `connect()`:
  ```typescript
  async connect(): Promise<boolean> {
    if (this.connected) return true;
    try {
      this.imap = new ImapClient({...});
      this.smtp = new SmtpClient({...});
      await this.imap.connect();
      await this.smtp.verify();
      // Start inbound dispatch loop (IDLE if available, else poll).
      this.inboundTask = this._runInboundLoop();
      this.connected = true;
      return true;
    } catch (err) {
      console.error("[email] connect failed:", err);
      await this.disconnect();
      return false;
    }
  }
  ```
- `_runInboundLoop()`: long-running async that:
  1. If IMAP IDLE supported, listen for `exists` events; on event, fetch UNSEEN and dispatch.
  2. Else, every `pollIntervalMs`, fetch UNSEEN and dispatch.

#### Tasks
1. Refine `connect()` per pseudocode.
2. Implement `_runInboundLoop` (IDLE preferred, poll fallback).
3. `disconnect()`: cancel loop, close IMAP/SMTP.
4. Idempotency.

#### TDD
```
RED:     test_connect_starts_imap_idle_when_supported
RED:     test_connect_falls_back_to_poll_when_idle_unavailable
RED:     test_connect_returns_false_on_imap_auth_failure
RED:     test_connect_idempotent
RED:     test_disconnect_cancels_inbound_loop
RED:     test_disconnect_idempotent
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test adapter.test.ts
```

#### Acceptance Criteria
- [ ] Both IDLE + poll paths exercised
- [ ] Lifecycle idempotent

#### DoD
- [ ] Adapter fully lifecycle-compliant

---

### T5.3 — `_dispatchInbound` pipeline integration

#### Objective
Wire normalize → filters → handler dispatch.

#### Files to edit
```
packages/gateway-email/src/adapter.ts — add _dispatchInbound
```

#### Deep Dives
- Pipeline. **(EC-1, EC-4 absorbed)** Outer dispatcher serializes via Promise queue; inner pipeline adds own-address loopback guard BEFORE all other filters:
  ```typescript
  private dispatchQueue: Promise<void> = Promise.resolve();

  /** EC-4: serialize concurrent IDLE dispatches so seen-check is atomic. */
  private _dispatchInbound(uid: number, rawBuffer: Buffer, headers: Map<string,string>): Promise<void> {
    this.dispatchQueue = this.dispatchQueue.then(() =>
      this._dispatchInboundInner(uid, rawBuffer, headers).catch(err =>
        console.error("[email] dispatch error:", err instanceof Error ? err.message : err),
      ),
    );
    return this.dispatchQueue;
  }

  private async _dispatchInboundInner(uid: number, rawBuffer: Buffer, headers: Map<string,string>): Promise<void> {
    if (this.seenUids.has(uid)) return;
    this.seenUids.add(uid);

    const event = await normalizeEmail(rawBuffer, {
      botAddress: this.options.address,
      maxBodyChars: this.options.maxBodyChars,
    });

    // EC-1 (CRITICAL): drop own-address loopback FIRST — defeats infinite send-loop
    // when Gmail "All Mail" / mailing-lists / BCC-self deliver bot's own messages.
    if (event.email.fromAddress === this.options.address.toLowerCase()) {
      console.warn(`[email] dropped own-address loopback (uid=${uid})`);
      return;
    }
    // D332: drop automated senders (unless explicitly allowed).
    if (!this.options.allowAutomated && isAutomatedSender(event.email.fromAddress, headers)) {
      console.warn(`[email] dropped automated sender: ${event.email.fromAddress}`);
      return;
    }
    // D333 + EC-3: enforce allowlist (both sides normalized via extractAddr).
    if (!isAllowedSender(event.email.fromAddress, this.options.allowedSenders)) {
      console.warn(`[email] sender not in allowlist: ${event.email.fromAddress}`);
      return;
    }
    // Record thread context for outbound reciprocity.
    this.threadStore.recordFromInbound(event);

    if (this.handler !== undefined) await this.handler(event);
  }
  ```

#### Tasks
1. Implement `_dispatchInbound` in `adapter.ts`.
2. Wire from imap-client inbound events.

#### TDD
```
RED:     test_dispatch_skips_seen_uid
RED:     test_dispatch_dedups_via_seen_uid_set
RED:     test_dispatch_drops_own_address_loopback (EC-1) — inbound from bot's own address is silently dropped BEFORE automated/allowlist filters
RED:     test_dispatch_own_address_check_case_insensitive (EC-1) — bot=BOT@x.com, inbound from=bot@x.com → dropped
RED:     test_dispatch_serializes_concurrent_calls (EC-4) — 2 simultaneous _dispatchInbound(same uid) → handler invoked exactly once
RED:     test_dispatch_filters_automated_senders
RED:     test_dispatch_filters_disallowed_senders
RED:     test_dispatch_records_thread_context
RED:     test_dispatch_invokes_handler_on_allowed_message
GREEN:   Implement
VERIFY:  pnpm --filter @usetheo/gateway-email test adapter.test.ts
```

#### Acceptance Criteria
- [ ] Pipeline correct: seen-check → normalize → automated-filter → allowlist-filter → thread-store → handler
- [ ] All filter paths exercised

#### DoD
- [ ] Inbound dispatch complete

---

## Phase 6: Example + env-gated smoke

### T6.1 — `examples/email-bot/` scaffold

#### Objective
Reference bot — Gmail App Password setup walkthrough + Express-less standalone Node script.

#### Files to edit
```
examples/email-bot/package.json (NEW)
examples/email-bot/.env.example (NEW)
examples/email-bot/README.md (NEW)
examples/email-bot/run.ts (NEW)
examples/email-bot/smoke.ts (NEW)
examples/email-bot/tsconfig.json (NEW)
```

#### Deep Dives
- `.env.example`:
  ```
  EMAIL_ADDRESS=bot@example.com
  EMAIL_PASSWORD=app-password-here
  EMAIL_IMAP_HOST=imap.gmail.com
  EMAIL_IMAP_PORT=993
  EMAIL_SMTP_HOST=smtp.gmail.com
  EMAIL_SMTP_PORT=587
  EMAIL_FROM_NAME=Theo Bot
  EMAIL_ALLOWED_SENDERS=alice@example.com,bob@example.com
  OPENROUTER_API_KEY=
  ```
- `run.ts`:
  ```typescript
  import { EmailAdapter } from "@usetheo/gateway-email";
  import { Agent } from "@usetheo/sdk";
  const adapter = new EmailAdapter({...});
  adapter.onInbound(async (event) => {
    if (event.platform !== "email") return;
    const agent = await Agent.create({...});
    try {
      const r = await (await agent.send(event.text)).wait();
      await adapter.sendMessage({ channel: event.channel, text: r.result ?? "(no reply)" });
    } finally { await agent.dispose(); }
  });
  await adapter.connect();
  process.on("SIGINT", async () => { await adapter.disconnect(); process.exit(0); });
  ```
- README has 5-step walkthrough:
  1. Enable 2FA on Gmail account
  2. Generate App Password (Google Account → Security → 2-Step Verification → App passwords)
  3. Set `.env`
  4. (Optional) Configure allowlist
  5. `pnpm run run`
- README **Troubleshooting** section absorbs documented edges:
  - **(EC-9)** "IMAP IDLE: `imapflow` auto-refreshes the IDLE connection every ~28min (under the RFC 2177 29-min limit). If your IMAP server drops connections faster, file an issue."
  - **(EC-10)** "TLS / port flexibility: defaults are 993 (IMAPS) + 587 (SMTP+STARTTLS). For self-hosted or dev servers using 465 (SMTPS) / 143 (plain IMAP) / 25 (plain SMTP), set `EMAIL_IMAP_PORT` / `EMAIL_SMTP_PORT`."
  - **(EC-11)** "SMTP latency: v0.1 opens a fresh connection per send (~100-500ms). Pooled connections may land in v0.2 if demand emerges; today this only matters for high-throughput bots."
  - **(EC-1)** "If you cc the bot on a thread you also receive, the bot drops its own messages from the inbox automatically — no loop."
  - **(EC-2)** "Bodies over 50 KB are truncated. Override with `maxBodyChars` in `EmailAdapterOptions`."
  - Auth errors → regenerate Gmail App Password (they expire when account password changes).

#### Tasks
1. Create scaffold.
2. README with Gmail walkthrough (most common provider).
3. Note: Outlook / Fastmail / self-hosted IMAP work the same — just different hosts.

#### TDD
```
GREEN:   pnpm typecheck on the example dir
VERIFY:  cd examples/email-bot && pnpm install --ignore-workspace && npx tsc --noEmit
```

#### Acceptance Criteria
- [ ] Example typechecks
- [ ] README has 5-step Gmail walkthrough
- [ ] `.env.example` lists every required var

#### DoD
- [ ] Example runnable

---

### T6.2 — Env-gated live smoke

#### Objective
Validates SMTP transport.verify() works against the provider (auth + connectivity).

#### Files to edit
```
examples/email-bot/smoke.ts (NEW)
```

#### Deep Dives
- Script:
  1. Read env. If `EMAIL_ADDRESS`/`PASSWORD`/`IMAP_HOST`/`SMTP_HOST` missing → log skipped + exit 0.
  2. Construct adapter; call `connect()`.
  3. Assert `connect` returned true (means SMTP verify passed + IMAP connected).
  4. Disconnect; exit 0.
- Doesn't send a message (would deliver to a real inbox during dev — bad UX).

#### Tasks
1. Create `smoke.ts`.
2. Implement env check + skip gate.

#### TDD
```
GREEN:   With env unset: exits 0 with "skipped" message
GREEN:   With env set + valid creds: connect returns true + exit 0
VERIFY:  cd examples/email-bot && pnpm tsx smoke.ts
```

#### Acceptance Criteria
- [ ] Skips cleanly without creds
- [ ] PASS message with valid creds

#### DoD
- [ ] Smoke documented in README

---

## Phase 7: Docs site update

### T7.1 — Update `concepts/gateways.mdx`

#### Files to edit
```
../theo-opendocs/content/theokit-sdk/concepts/gateways.mdx
```

#### Tasks
1. Add `@usetheo/gateway-email` row to shipped-adapters table.
2. Update roadmap blurb: ✅ WhatsApp, ✅ Teams, ✅ Email — next: Google Workspace skills.

#### TDD
```
GREEN:   grep -i email concepts/gateways.mdx — Email row present
```

#### Acceptance Criteria
- [ ] Page lists Email alongside other adapters

#### DoD
- [ ] Build verde

---

### T7.2 — Cookbook recipe auto-gen

#### Files to edit
```
../theo-opendocs/content/theokit-sdk/cookbook/email-bot.mdx (regenerated)
```

#### Tasks
1. Run `pnpm generate:sdk-cookbook` in theo-opendocs.
2. Confirm `cookbook/email-bot.mdx` emitted.

#### DoD
- [ ] Build verde + drift clean

---

### T7.3 — Drift checker

#### Tasks
1. `pnpm --filter @usetheo/sdk run docs:drift`.

#### DoD
- [ ] Exit 0

---

## Phase 8: Dogfood + commits

### T8.1 — SDK dogfood (sanity)

#### Tasks
1. Boot telegram-pro bot.
2. Run `/dogfood full`.
3. Confirm 44/44 PASS.

#### DoD
- [ ] Zero regression

---

### T8.2 — publint + attw

#### Tasks
1. Build the package.
2. Run `publint dist/` and `attw --pack`.

#### DoD
- [ ] Both clean

---

### T8.3 — Commit + push (both repos)

#### Tasks
1. theokit-sdk: stage new package + CHANGELOG + roadmap + plan.
2. theokit-sdk: commit `feat(gateway): @usetheo/gateway-email v0.1.0 (Roadmap v1.4 #4)`.
3. theokit-sdk: push.
4. theo-opendocs: commit cookbook + gateways.mdx.
5. theo-opendocs: push.

#### DoD
- [ ] Both repos pushed to main

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Community-standard lib stack (D327) | T1.1 | nodemailer + imapflow + mailparser peer deps |
| 2 | IMAP IDLE preferred (D328) | T2.1, T5.2 | ImapClient.idle() with poll fallback |
| 3 | Threading via Message-ID chain (D329) | T2.2, T3.1, T3.3 | normalize + smtp-client + sendMessage |
| 4 | topicId = stripped Message-ID (D330) | T2.2 | Strip `<>` in normalize |
| 5 | Seen-UID cap (D331) | T2.3 | SeenUidSet with FIFO trim |
| 6 | Automated-sender filter (D332) | T4.1 | isAutomatedSender regex + headers |
| 7 | Allowed-sender allowlist (D333) | T4.2 | isAllowedSender |
| 8 | HTML-to-text via mailparser (D334) | T2.2 | parsed.text field |
| 9 | Attachments skip in v0.1 (D335) | T2.2 | attachmentCount populated; payload dropped |
| 10 | DM-only channel mapping (D336) | T2.2 | channel.type always "dm" |
| 11 | Outbound threading reciprocity (D337) | T3.2, T3.3 | ThreadStore + sendMessage uses chain |
| 12 | v0.1.0 versioning (D338) | T1.1 | package.json |
| 13 | PlatformName opens (D339) | T1.2 | Union extended to "email" |
| 14 | Example + smoke | T6.1, T6.2 | examples/email-bot/ |
| 15 | Docs site update | T7.1, T7.2, T7.3 | concepts + cookbook + drift |
| 16 | Zero regression | T8.1 | Telegram-pro dogfood 44/44 |
| 17 | npm publishable | T8.2 | publint + attw |
| 18 | Own-address loopback drop (EC-1) | T5.3 | `_dispatchInboundInner` first guard |
| 19 | Body size cap (EC-2) | T2.2 + types | `maxBodyChars` option + truncation with marker |
| 20 | Allowed-sender normalization (EC-3) | T4.2 | `extractAddr` helper normalizes both sides |
| 21 | Concurrent dispatch race (EC-4) | T5.3 | Promise queue serializes `_dispatchInbound` |
| 22 | Subject fallback (EC-5) | T2.2 | `parsed.subject ?? "(no subject)"` |

**Coverage: 22/22 (100%)**

## Global Definition of Done

- [ ] Phases 0-8 complete
- [ ] All tests passing in `@usetheo/gateway-email`
- [ ] `@usetheo/gateway` bumped to 0.4.0 (union opened for `"email"`)
- [ ] `examples/email-bot/` scaffold + README + smoke
- [ ] theo-opendocs `concepts/gateways.mdx` updated + cookbook regenerated
- [ ] Drift checker clean
- [ ] publint + attw clean on the new package
- [ ] CHANGELOG entries in both `gateway` and `gateway-email`
- [ ] CLAUDE.md Roadmap v1.4 #4 marked ✅ DONE
- [ ] **SDK dogfood telegram-pro: 44/44 PASS** (zero regression)
- [ ] Live smoke either PASS (with creds) or skipped honestly per `.claude/rules/real-llm-validation.md`

## Final Phase: Dogfood QA (MANDATORY)

> Plan does not touch SDK runtime. Dogfood is **sanity** + Email-specific **smoke**.

### Execution

1. SDK sanity: `/dogfood full` — telegram-pro must remain 44/44 PASS.
2. Email smoke: `cd examples/email-bot && pnpm tsx smoke.ts`.

### Acceptance Criteria

- [ ] SDK dogfood: 44/44 PASS (zero regression)
- [ ] Email smoke: PASS (with creds) OR skip honestly (without creds)
- [ ] Zero CRITICAL or HIGH issues introduced

### If Dogfood Fails

1. SDK regression → unexpected (no SDK changes). Investigate.
2. Smoke fail → check Gmail App Password generation; check IMAP/SMTP host names.
3. Pre-existing issues documented, do not block.
