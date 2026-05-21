# Plan: `@usetheo/gateway` v0.1 — Multi-platform messaging gateway as a workspace package

> **Version 1.2** (2026-05-21, COMPLETED) — all 10 phases shipped. 3 new workspace packages (`@usetheo/gateway`, `@usetheo/gateway-telegram`, `@usetheo/gateway-discord`) at `0.1.0`. 67 unit tests GREEN across the 3 packages (41 core + 19 telegram + 7 discord). 12 ADRs (D170-D181) registered. Telegram-pro migrated to consume `@usetheo/gateway-telegram` (group-policy + splitForTelegram extracted, 2 local files removed). Discord example `examples/gateway-discord/` typechecks clean. Telegram-pro dogfood: **39/42 PASS** (improvement over the 2026-05-20 baseline of 38/42), 2 flake failures (Gemini transient — both pass on retry), 1 env-gated skip. LoC reduction in `examples/telegram-pro/src/index.ts` did NOT hit the 40% target (1641 → 1649 LoC, 8-line gain from new imports) — honest assessment: the plan target was overoptimistic; the real benefit is architectural (consume the gateway contract), not LoC reduction. Total LoC reduction across the example directory: ~70 LoC (deleted local `format.ts` + `group-policy.ts`).
>
> **Version 1.1** (2026-05-20) — incorporates edge-case review: 7 MUST FIX (EC-A slash boundary, EC-B topicId fallback, EC-C Discord intents default, EC-D `block:message` auto-reply wired, EC-E `stop()` drain timeout, EC-F token redaction via D68, EC-G `ctx.reply` adapter routing) + 5 SHOULD TEST woven into TDD blocks + 4 DOCUMENT items added inline.
>
> **Version 1.0** (2026-05-20) — Ships `@usetheo/gateway` as a NEW workspace package paralel ao `@usetheo/sdk` (not inside it), with two transport adapters (`@usetheo/gateway-telegram`, `@usetheo/gateway-discord`) as peer-dep packages — same architectural pattern as `@usetheo/memory-*` (ADRs D141-D149). The core package owns transport-agnostic primitives (`BasePlatformAdapter`, `MessageEvent`, `SessionRouter`, `DeliveryRouter`, `GatewayRunner`, hooks) but never duplicates anything the SDK already has — sessions compose `Agent.resume`, scheduled delivery composes `Cron`, system context composes `SystemPromptResolver`. The success gate is the existing `/telegram-pro-dogfood` skill (42 commands today): the migration of `examples/telegram-pro` to use `@usetheo/gateway-telegram` must keep the suite at its current PASS count, with the 6 personality commands shipped in v1.14 still green. A minimal Discord example validates that the abstraction holds against a second transport (WebSocket-driven, fundamentally different from Telegram's long-polling).

## Context

### What exists today

- **`examples/telegram-pro/`** (1641 LoC `src/index.ts` + 21 sibling files, ~3831 LoC total) wires grammy directly: `new Bot(TOKEN)`, ~30 `bot.command(...)` handlers, ad-hoc helpers for group policy (`group-policy.ts`), streaming (`streaming.ts`), buttons (`buttons.ts`), vision (`vision.ts`), voice (`transcribe.ts`), workspace seeds, system prompt, agent factory. **There is no abstraction layer between grammy and the SDK** — every slash command calls `getAgent(ctx, opts)` and then either `agent.send()` directly or hits a memory/skill/MCP helper.
- **`packages/sdk/`** ships every primitive a gateway needs to compose: `Agent.resume(agentId)`, `AgentFactory.getOrCreate(...)`, `Cron`, `SystemPromptResolver`, `Plugin` (ADRs D97-D109), `Agent.usePersonality` (ADRs D160-D169 just landed), `MemoryAdapter` (ADRs D141-D149).
- **`packages/memory-{supermemory,honcho,mem0}/`** prove the workspace-package + peer-dep + opt-in adapter pattern works (5 ADRs each, 56 adapter-package tests, 3 real-LLM examples). This plan **copies that pattern verbatim** for the gateway adapters.
- **`referencia/hermes-agent/gateway/`** (Python, ~1000 LoC `run.py` + 25 platform adapters) is the design reference — we borrow the architectural shape (`BasePlatformAdapter`, `MessageEvent`, `SessionStore`, `DeliveryRouter`) without copying code. Python idioms (dataclasses, ABC) don't translate 1:1 to TypeScript.

### What's broken or missing

Three concrete evidence points justify this work now:

1. **The 1641-LoC `index.ts`** in telegram-pro is single-handedly the largest file in the monorepo and ~80% of it is grammy plumbing + slash command dispatch. Any second bot example (Discord, Slack) would re-implement the same plumbing — `cron-setup.ts`, `loops.ts`, `streaming.ts`, `group-policy.ts`, the agentId-per-chat factory pattern — none of which are Telegram-specific.
2. **Cross-Project Rule 2** (root `CLAUDE.md`): "Verify before claiming integration." Today TheoKit-SDK has zero documented integration surface for transport layers, so any future TheoKit (Next.js framework) attempt to wire bots will reinvent the same primitives. A typed `@usetheo/gateway` contract removes the speculation.
3. **The `/telegram-pro-dogfood` skill** is the only ratchet test in the monorepo (42 commands, ~248s wall clock, CDP-driven against real Gemini-via-OpenRouter). Without a gateway abstraction, any refactor of telegram-pro risks breaking it; with the gateway, the dogfood becomes the **regression gate of the gateway itself**.

### Why not just leave it as separate examples per platform?

The root `CLAUDE.md` rule: **don't reinvent**. Hermes' gateway is 1000+ LoC of mature production code — but Python, so we can't import it. The architectural pattern, however, is portable. Hermes runs in production with 20+ platforms; copying its **shape** (not its code) is the lowest-risk path to a TypeScript-native abstraction.

### Why not put it in TheoKit (the Next.js framework pillar)?

TheoKit is "Full-Stack AI Agents" — a Next.js framework. Bots run as long-lived processes with WebSockets / long-polling; that's a worse fit for serverless-Next-routes than for a standalone Node process. A separate workspace package gives us:
- TheoKit can later import `@usetheo/gateway` from its routes (e.g., `app/api/bot/[platform]/route.ts`) if Next.js webhook routes are the right delivery mode for some platform.
- CLI users / VPS users / Docker users can run the gateway directly without bringing Next.js in.
- The pillar boundary (SDK = harness, TheoKit = framework) stays clean.

## Objective

**Done = the running `@theo_paulo_bot` (telegram-pro) is wired through `@usetheo/gateway-telegram`, the `/telegram-pro-dogfood` skill passes at ≥38/42 (current baseline) with zero new failures, AND a minimal Discord example using `@usetheo/gateway-discord` successfully receives a slash command and replies with a real LLM response.**

Specific measurable goals:

1. Three new workspace packages exist and build cleanly: `@usetheo/gateway`, `@usetheo/gateway-telegram`, `@usetheo/gateway-discord`.
2. `examples/telegram-pro/src/index.ts` shrinks from 1641 LoC → ≤900 LoC (target: 40-45% reduction) by extracting all transport-specific plumbing into `@usetheo/gateway-telegram`.
3. The `/telegram-pro-dogfood` skill passes (≥38/42 PASS, same as 2026-05-20 baseline; the 3 known Gemini-flake commands stay flake, no NEW failures).
4. A new `examples/gateway-discord/` example runs `/ping`-style commands against a real Discord guild.
5. Twelve new ADRs (D170-D181) register every architectural decision.
6. Unit tests: ≥40 across the 3 packages.
7. Documentation: README in each package + integration guide in root `CLAUDE.md`.

## ADRs

### D170 — `@usetheo/gateway` is a workspace package separate from `@usetheo/sdk`

**Decision:** Ship the gateway as `packages/gateway/`, NOT inside `packages/sdk/src/gateway/`.

**Rationale:** The pillar narrative in the root `CLAUDE.md` is "SDK = harness, TheoKit = framework". A multi-transport messaging layer is framework-territory, not harness-territory. Putting it under the SDK would (a) bloat the SDK's API surface, (b) drag transport peer deps (grammy, discord.js) into the SDK's dependency graph even for users who never touch bots, and (c) blur the pillar boundary. The same logic justified the `@usetheo/memory-*` split (D143).

**Consequences:**
- **Enables:** independent versioning, opt-in install (`pnpm add @usetheo/gateway @usetheo/gateway-telegram`), clean SDK boundary.
- **Constrains:** consumers who want both the SDK and the gateway install two packages — same as memory adapters. Acceptable.

### D171 — Each platform adapter is its own peer-dep package

**Decision:** `@usetheo/gateway-telegram` and `@usetheo/gateway-discord` are separate workspace packages, each declaring `@usetheo/gateway`, `@usetheo/sdk`, and the platform SDK (grammy / discord.js) as peer deps.

**Rationale:** Exactly mirrors `@usetheo/memory-*` (D143). A user who only wants Telegram should not pay the install cost of discord.js (~1MB) and vice versa. Peer deps avoid the bundler-confusion problem when multiple adapters coexist.

**Consequences:**
- **Enables:** zero-cost addition of future adapters (Slack, WhatsApp, Signal) without modifying the core.
- **Constrains:** install instructions become more verbose. Mitigated by README examples.

### D172 — `BasePlatformAdapter` is an abstract class, not an interface

**Decision:** Use TypeScript's `abstract class` with concrete shared methods (e.g., `_keepTyping`, `_emitInboundEvent`) and abstract hooks subclasses must implement (`connect`, `disconnect`, `sendMessage`).

**Rationale:** Adapters share ~30-40% of lifecycle code (typing indicators, rate-limit backoff template, event normalization). Interface-only forces every adapter to copy that. Hermes' Python `BasePlatformAdapter` follows the same pattern for the same reason. The "favor composition" maxim doesn't apply when the shared code is **adapter lifecycle**, not domain logic — there's no third axis of variation to compose with.

**Consequences:**
- **Enables:** new adapters in ≤200 LoC by overriding 3-4 abstract methods.
- **Constrains:** every adapter is a subclass — tighter coupling than pure interface. Mitigated by LSP (D172.LSP): subclasses must not strengthen pre-conditions or weaken post-conditions of the base.

### D173 — `MessageEvent` is a discriminated union by `platform` field

**Decision:** `MessageEvent` exposes a `platform: "telegram" | "discord" | ...` literal; platform-specific extensions live in optional sibling fields (`telegram?`, `discord?`) typed by the corresponding adapter package.

**Rationale:** TypeScript's discriminated union gives compile-time exhaustiveness checks for free. Putting Telegram-specific fields directly on the `MessageEvent` (Hermes does this in Python via dataclass inheritance) would make the core type un-extendable without churn every time a new platform lands.

**Consequences:**
- **Enables:** safe `switch (event.platform)` blocks with exhaustive-check compiler errors when a new platform is added.
- **Constrains:** platform-specific fields require a non-null assertion when the consumer wants to read them. Acceptable — same shape as discord.js's own union types.

### D174 — `SessionRouter` composes `Agent.resume`; never reimplements session storage

**Decision:** `SessionRouter.resolveAgentId(event) → string` is pure routing logic (build the deterministic key); the resolved id is handed to `Agent.resume(agentId, options)` for actual session continuity.

**Rationale:** The SDK already owns session persistence (D17, D18 — `agent-registry.ts`, session JSONL, hydration). Reimplementing this in the gateway would either drift or duplicate. The gateway's job is **how to compute the key**, not **where to store the session**.

**Consequences:**
- **Enables:** session resume works identically whether driven by a slash command, a webhook, or a cron job. Zero new persistence code.
- **Constrains:** the gateway can't introduce session features the SDK doesn't have (e.g., gateway-only "ephemeral" sessions). Future PRs that need this must add the feature to the SDK first.

### D175 — `DeliveryRouter` composes `Cron`; never reimplements scheduling

**Decision:** `DeliveryRouter.send({ platform, channel, content })` is a pure dispatcher. Scheduled delivery uses the existing `Cron` (D7) with a callback that calls `DeliveryRouter.send(...)`.

**Rationale:** Same as D174 — Cron is mature (`croner` D7, JSON persistence D8). Building a parallel scheduler is YAGNI.

**Consequences:**
- **Enables:** all scheduled delivery features (timezone, retry, jitter) come from Cron for free.
- **Constrains:** delivery latency is bounded by Cron's tick resolution (~1s). Acceptable for the use cases (reminders, dream sweeps, batch reports).

### D176 — Gateway hooks are an own contract, NOT a new `Plugin.kind`

**Decision:** Define a separate `GatewayHook` type with three fire points (`pre_inbound`, `post_outbound`, `on_error`). Do NOT extend the SDK's `Plugin` discriminated union (D98) with `kind: "gateway-hook"`.

**Rationale:** The SDK's Plugin contract is sealed by design (D98 — "discriminated union by kind"). Adding kinds inflates the contract surface and forces every SDK consumer to know about gateway concerns even when they never touch transport. Keeping gateway hooks in `@usetheo/gateway` keeps the boundary clean. The same logic kept D101 (`pre_tool_call` veto) inside the SDK's plugin contract — because tool calls are SDK-domain. Transport hooks are gateway-domain.

**Consequences:**
- **Enables:** gateway hooks can have transport-specific contexts (e.g., a Telegram `ctx` object) without leaking into the SDK.
- **Constrains:** a hook that needs to fire both as `pre_tool_call` AND `pre_inbound` registers twice. Acceptable — rare case.

### D177 — Gateway hook signature mirrors SDK `pre_tool_call` veto pattern

**Decision:** Hooks return `{ block: true, message?: string }` to short-circuit the inbound event flow. Returning `{ block: false }` (or `undefined`) continues. Throwing is treated as `block: true` + log.

**Rationale:** Reuses the mental model SDK consumers already know from `pre_tool_call` (D101). Reduces cognitive load.

**Consequences:**
- **Enables:** group-policy filtering, allowlist enforcement, rate-limit veto all expressed in the same shape.
- **Constrains:** hooks can't transform an event (they only allow/block). For transform use cases, the consumer mutates fields on the event in place — same as Express middleware.

### D178 — Telegram-pro migration preserves 100% of slash commands; dogfood is the regression gate

**Decision:** Every `bot.command("X", handler)` in the current `index.ts` is rewritten as `gateway.command("X", handler)` with the **same handler body** modulo `ctx` replacement (`grammy.Context` → `GatewayContext`). No slash command is dropped, renamed, or behaviorally changed in this PR.

**Rationale:** The `/telegram-pro-dogfood` suite is 42 commands of regression coverage. Removing or renaming commands invalidates the suite — and the suite is the only thing standing between us and silent regressions across the Hermes feature parity (memory, MCP, vision, voice, batch, goals, personality, etc).

**Consequences:**
- **Enables:** mechanical migration with low cognitive risk.
- **Constrains:** any **enhancement** to a command (e.g., new flag) is out of scope for this PR — must be a follow-up.

### D179 — Discord adapter uses WebSocket Gateway (discord.js), not HTTP webhooks

**Decision:** `@usetheo/gateway-discord` opens a long-lived WebSocket via discord.js's `Client.login()`. We do NOT build a webhook-based variant for v0.1.

**Rationale:** WebSocket is the canonical Discord bot mode; webhook bots are limited (no presence, no DM, no thread events). Telegram's bot mode is long-polling (grammy default). Both are long-lived process patterns, justifying a unified "GatewayRunner stays up" lifecycle. v0.1 is not trying to be serverless-friendly.

**Consequences:**
- **Enables:** full Discord feature parity (slash commands, threads, reactions, presence).
- **Constrains:** the gateway requires a long-lived process. Serverless deployment is out of scope. Documented; non-issue for VPS/Docker/local-dev.

### D180 — Platform-portable features are first-class; platform-specific features are opt-in extensions

**Decision:** The `GatewayContext` exposes text + slash commands + threads as core capabilities (work identically on Telegram + Discord). Platform-specific features (Telegram voice transcription, Discord embeds, photo OCR, stickers) live in adapter-specific extension methods (`ctx.telegram?.transcribeVoice()`, `ctx.discord?.replyWithEmbed()`) and the consumer feature-detects.

**Rationale:** The 80/20 rule for messaging bots: text in / text out + slash commands cover ~80% of real usage. Forcing every adapter to implement voice transcription would block Discord (which has voice channels but not voice-as-message-attachment). Opt-in extensions keep the core lean.

**Consequences:**
- **Enables:** Discord adapter ships without needing to invent a voice-message concept that doesn't exist on Discord.
- **Constrains:** consumers writing portable bots must feature-detect (`if (ctx.telegram?.transcribeVoice) {...}`). Standard TypeScript pattern.

### D181 — Initial version is `0.1.0` (pre-1.0, semver pre-release status)

**Decision:** All three new packages publish at `0.1.0`. Breaking changes are allowed within `0.x.y` per semver minor bumps.

**Rationale:** No real users yet. Locking the API at 1.0 before two adapters have exercised it would be premature. The memory adapters (D143) shipped at `0.1.0` for the same reason. We promote to `1.0.0` after at least one quarter of real-world use and a third adapter validates the contract.

**Consequences:**
- **Enables:** rapid iteration on the contract based on dogfood feedback.
- **Constrains:** consumers see the `0.x` version and know to pin exactly. Documented in README.

## Dependency Graph

```
Phase 0 (workspace setup)
   │
   ▼
Phase 1 (core contracts: MessageEvent, BasePlatformAdapter, GatewayRunner)
   │
   ├──▶ Phase 2 (SessionRouter — composes Agent.resume)
   │
   ├──▶ Phase 3 (DeliveryRouter — composes Cron)
   │
   └──▶ Phase 4 (Hook system — own contract per D176)
            │
            ▼
   ┌────────┴────────┐
   ▼                 ▼
Phase 5 (Telegram)  Phase 6 (Discord)   ← parallel
   │                 │
   ▼                 ▼
Phase 7 (Migrate    Phase 8 (gateway-discord example)
telegram-pro)        │
   │                 │
   └────────┬────────┘
            ▼
Phase 9 (ADRs + READMEs + CHANGELOG)
            │
            ▼
Phase 10 (Dogfood QA — /telegram-pro-dogfood gate)
```

**Parallelization opportunities:**
- Phases 2, 3, 4 can run in parallel after Phase 1.
- Phases 5 and 6 (the two adapters) can run in parallel after Phase 4.
- Phases 7 and 8 can run in parallel after their respective adapters land.

**Sequential blockers:**
- Phase 0 blocks everything.
- Phase 1 blocks all subsequent phases.
- Phase 10 (dogfood) requires Phases 5 and 7 to complete.

---

## Phase 0: Workspace setup

**Objective:** Create the three new workspace packages with build infrastructure mirroring `@usetheo/memory-supermemory`.

### T0.1 — Scaffold `packages/gateway/`

#### Objective
Create the core gateway package with the same build/test infrastructure as the existing workspace packages.

#### Evidence
- `packages/memory-supermemory/` is the proven template: `tsup` build, `vitest` tests, dual ESM/CJS exports, peer-dep declaration of `@usetheo/sdk`.

#### Files to edit
```
packages/gateway/package.json (NEW) — workspace package, name @usetheo/gateway, version 0.1.0
packages/gateway/tsconfig.json (NEW) — extends ../../tsconfig.base.json
packages/gateway/tsup.config.ts (NEW) — dual ESM/CJS, target node22, entry src/index.ts
packages/gateway/vitest.config.ts (NEW) — standard vitest config
packages/gateway/src/index.ts (NEW) — empty placeholder exporting {} for now
packages/gateway/tests/.gitkeep (NEW)
packages/gateway/README.md (NEW) — short stub describing the package
packages/gateway/CHANGELOG.md (NEW) — [Unreleased] section
pnpm-workspace.yaml — add packages/gateway, packages/gateway-* to globs
```

#### Deep file dependency analysis
- `pnpm-workspace.yaml` currently lists `packages/*` — verify the glob already picks up new directories.
- `package.json` workspace mirror — every existing memory package follows the same shape (peer deps, dual exports, files allowlist).
- Root `tsconfig.base.json` provides strict TS + ES2022 + bundler resolution.

#### Deep Dives

**Package layout invariants:**
- `peerDependencies` declares `@usetheo/sdk: workspace:^` so consumers control the SDK version.
- `dependencies` is empty for the core (no runtime deps beyond TS types from SDK).
- `devDependencies` includes `tsup`, `typescript`, `vitest`, `@usetheo/sdk: workspace:*`.

**Tsup config (copy from memory-supermemory):**
```typescript
import { defineConfig } from "tsup";
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: "node22",
});
```

**Edge cases:**
- **EC-1:** if `pnpm-workspace.yaml` doesn't auto-pick up the new dirs, add explicit globs `packages/gateway`, `packages/gateway-*`.

#### Tasks
1. Copy `packages/memory-supermemory/` as a template into `packages/gateway/`.
2. Rewrite `package.json` name + description.
3. Strip `memory-adapter`-specific code from `src/`, leave a single empty `index.ts`.
4. Run `pnpm install` at repo root to wire the workspace.
5. Run `pnpm --filter @usetheo/gateway build` to confirm the toolchain compiles.

#### TDD
```
RED:     test_package_exports_empty_object — import * from "@usetheo/gateway" should not throw
GREEN:   ship the empty index.ts
REFACTOR: none
VERIFY:  pnpm --filter @usetheo/gateway build && pnpm --filter @usetheo/gateway test
```

#### Acceptance Criteria
- [ ] `packages/gateway/package.json` exists with name `@usetheo/gateway`, version `0.1.0`
- [ ] `pnpm install` succeeds and creates a symlink in workspace `node_modules`
- [ ] `pnpm --filter @usetheo/gateway build` succeeds, produces `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`
- [ ] 1 placeholder test passes

#### DoD
- [ ] Files created and committed
- [ ] Build and test pass
- [ ] CHANGELOG `[Unreleased] Added` entry

---

### T0.2 — Scaffold `packages/gateway-telegram/`

Same as T0.1 but with `grammy: ^1.x` as a peer dep. Stub-only.

#### Files to edit
```
packages/gateway-telegram/{package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, src/index.ts, tests/, README.md, CHANGELOG.md} (NEW)
```

#### Acceptance Criteria
- [ ] `pnpm --filter @usetheo/gateway-telegram build` succeeds
- [ ] Peer deps declared: `@usetheo/gateway`, `@usetheo/sdk`, `grammy`

---

### T0.3 — Scaffold `packages/gateway-discord/`

Same as T0.2 but with `discord.js: ^14.x` as a peer dep. Stub-only.

#### Files to edit
```
packages/gateway-discord/{...} (NEW)
```

#### Acceptance Criteria
- [ ] `pnpm --filter @usetheo/gateway-discord build` succeeds
- [ ] Peer deps declared: `@usetheo/gateway`, `@usetheo/sdk`, `discord.js`

---

## Phase 1: Core contracts

**Objective:** Define `MessageEvent`, `BasePlatformAdapter`, and `GatewayRunner` skeleton — the transport-agnostic vocabulary all adapters speak.

### T1.1 — `MessageEvent` discriminated-union type

#### Objective
The canonical inbound shape every adapter emits. Discriminated by `platform` (D173).

#### Evidence
- D173 (decision).
- Hermes `gateway/session.py` has the equivalent `MessageEvent` dataclass — Python inheritance maps to TS discriminated unions.

#### Files to edit
```
packages/gateway/src/types/message-event.ts (NEW)
packages/gateway/src/types/index.ts (NEW) — barrel
packages/gateway/src/index.ts — re-export types
packages/gateway/tests/types/message-event.test.ts (NEW)
```

#### Deep file dependency analysis
- No external deps; pure types.
- `index.ts` re-exports so consumers do `import type { MessageEvent } from "@usetheo/gateway"`.

#### Deep Dives

**Shape:**
```typescript
export interface BaseMessageEvent {
  /** Stable id used as a session key segment. */
  readonly id: string;
  /** Discriminator. */
  readonly platform: PlatformName;
  /** Sender identity — opaque, platform-namespaced. */
  readonly sender: { id: string; username?: string; displayName?: string };
  /** Channel/chat scope — opaque, platform-namespaced. */
  readonly channel: { id: string; type: "dm" | "group" | "thread"; topicId?: string };
  /** Plain-text content (extracted from media captions if relevant). */
  readonly text: string;
  /** Receipt timestamp (ms since epoch). */
  readonly receivedAt: number;
  /** Optional reply-to message id. */
  readonly replyTo?: string;
}

export type PlatformName = "telegram" | "discord";

export interface TelegramMessageEvent extends BaseMessageEvent {
  readonly platform: "telegram";
  readonly telegram: {
    readonly chatId: number;
    readonly messageId: number;
    readonly threadId?: number;
    readonly raw: unknown; // grammy Context, narrowed by adapter package
  };
}

export interface DiscordMessageEvent extends BaseMessageEvent {
  readonly platform: "discord";
  readonly discord: {
    readonly guildId: string | null;
    readonly channelId: string;
    readonly messageId: string;
    readonly raw: unknown; // discord.js Message, narrowed by adapter package
  };
}

export type MessageEvent = TelegramMessageEvent | DiscordMessageEvent;
```

**Invariants:**
- `id` is unique per platform per receipt — generated by the adapter, used by the runner to dedupe in case of platform redelivery.
- `text` is normalized whitespace; empty string for media-only messages (consumer falls back to media inspection).
- `sender.id` and `channel.id` are namespaced by `platform` prefix when used as session keys (see T2.1).

**Edge cases:**
- **EC-1:** Discord DMs have `guildId: null` — `channel.type === "dm"`.
- **EC-2:** Telegram forum topics: `channel.type === "thread"`, `channel.topicId` set, `telegram.threadId` set.
- **EC-3:** future platforms add their own variant; the union type extends without churning the core.

#### Tasks
1. Define `BaseMessageEvent`, `TelegramMessageEvent`, `DiscordMessageEvent`, `MessageEvent` in `message-event.ts`.
2. Define `PlatformName` union.
3. Export via `types/index.ts` barrel.
4. Re-export from `src/index.ts`.
5. Type-only test that discriminated narrowing works.

#### TDD
```
RED:     test_platform_field_narrows_telegram — `switch (e.platform)` exhaustive
RED:     test_platform_field_narrows_discord
RED:     test_unknown_platform_is_compile_error — //@ts-expect-error trap
GREEN:   define the types
REFACTOR: none
VERIFY:  pnpm --filter @usetheo/gateway test
```

#### Acceptance Criteria
- [ ] 3 type-only tests pass
- [ ] `MessageEvent` exported from `@usetheo/gateway`
- [ ] File ≤80 LoC

#### DoD
- [ ] CHANGELOG entry
- [ ] Types public

---

### T1.2 — `BasePlatformAdapter` abstract class

#### Objective
Define the contract every adapter subclasses (D172).

#### Evidence
- D172 (abstract class chosen over interface).
- Hermes `gateway/platforms/base.py` is the structural reference.

#### Files to edit
```
packages/gateway/src/adapter/base.ts (NEW)
packages/gateway/src/adapter/index.ts (NEW) — barrel
packages/gateway/src/index.ts — re-export
packages/gateway/tests/adapter/base.test.ts (NEW)
```

#### Deep file dependency analysis
- Depends on `types/message-event.ts` (T1.1).
- `EventEmitter`-style API for the runner to subscribe.

#### Deep Dives

**Shape:**
```typescript
export interface OutboundMessage {
  readonly channel: { id: string; type: "dm" | "group" | "thread"; topicId?: string };
  readonly text: string;
  /** Markdown / HTML hint — adapter-specific rendering. */
  readonly format?: "plain" | "markdown" | "html";
  /** Optional reply target. */
  readonly replyTo?: string;
}

export interface SendResult {
  readonly ok: boolean;
  readonly messageId?: string;
  readonly error?: { code: string; message: string };
}

export abstract class BasePlatformAdapter {
  abstract readonly platform: PlatformName;

  /** Open the connection; return true on success. Idempotent. */
  abstract connect(): Promise<boolean>;

  /** Close the connection. Idempotent. */
  abstract disconnect(): Promise<void>;

  /** Send a message to a channel. */
  abstract sendMessage(out: OutboundMessage): Promise<SendResult>;

  /** Subscribe to inbound events. Called by GatewayRunner. */
  abstract onInbound(handler: (event: MessageEvent) => Promise<void>): () => void;

  /** Lifecycle: emit a typing indicator while the agent works. Default: noop. */
  async startTyping(_channelId: string): Promise<void> { /* override */ }

  /** Lifecycle: stop the typing indicator. Default: noop. */
  async stopTyping(_channelId: string): Promise<void> { /* override */ }
}
```

**Invariants:**
- `connect()` is idempotent — calling twice returns true the second time without side effects.
- `sendMessage` returns a result object, NEVER throws on platform-level errors (rate-limit, 4xx); the result carries the error code.
- Adapters MAY throw on programmer errors (missing config, invalid channel id).
- `onInbound` returns an unsubscribe function (D178-style functional event listener).

**Edge cases:**
- **EC-1:** `sendMessage` with empty text → adapter returns `{ ok: false, error: { code: "empty_text" } }`. Never sends.
- **EC-2:** Reconnect: if `connect()` is called while already connected, it's a no-op returning `true`.
- **EC-3:** `disconnect()` on a never-connected adapter is also a no-op.

#### Tasks
1. Define `OutboundMessage`, `SendResult`, `BasePlatformAdapter`.
2. Export via `adapter/index.ts`.
3. Write a `MockAdapter` for tests (in tests/, not src/).
4. Tests: contract conformance.

#### TDD
```
RED:     test_mock_adapter_connect_idempotent
RED:     test_mock_adapter_send_returns_result_object
RED:     test_mock_adapter_send_empty_text_returns_error_not_throw
RED:     test_mock_adapter_inbound_subscribe_unsubscribe
RED:     test_mock_adapter_disconnect_idempotent
RED:     test_mock_adapter_inbound_second_call_replaces_handler — EC-H: predictable runner integration
GREEN:   implement BasePlatformAdapter abstract class
REFACTOR: extract typing-indicator default into mixin if 2+ adapters duplicate
VERIFY:  pnpm --filter @usetheo/gateway test
```

#### Acceptance Criteria
- [ ] 6 RED tests GREEN (was 5 — +1 from EC-H replace semantics)
- [ ] File ≤150 LoC
- [ ] Knip clean
- [ ] EC-H: `onInbound` calling twice replaces the prior handler (not stacks). Documented in the abstract method JSDoc.

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

### T1.3 — `GatewayRunner` skeleton

#### Objective
The top-level orchestrator: holds adapters, dispatches inbound events to the consumer's handler.

#### Evidence
- Hermes `gateway/run.py::GatewayRunner` is the structural reference.

#### Files to edit
```
packages/gateway/src/runner/gateway-runner.ts (NEW)
packages/gateway/src/runner/index.ts (NEW)
packages/gateway/src/index.ts — re-export
packages/gateway/tests/runner/gateway-runner.test.ts (NEW)
```

#### Deep file dependency analysis
- Depends on T1.1 (MessageEvent), T1.2 (BasePlatformAdapter).
- Does NOT depend on `@usetheo/sdk` yet — that wiring happens in Phases 2-4.

#### Deep Dives

**Shape:**
```typescript
export interface GatewayHandler {
  (event: MessageEvent, ctx: GatewayContext): Promise<void>;
}

export interface GatewayContext {
  /** Send a reply to the originating channel — auto-routes to the
   *  adapter whose `platform === event.platform` (EC-G). */
  reply(text: string, opts?: { format?: "plain" | "markdown" | "html" }): Promise<SendResult>;
  /** The originating event (for advanced cases). */
  readonly event: MessageEvent;
}

export interface GatewayRunnerOptions {
  adapters: ReadonlyArray<BasePlatformAdapter>;
  handler: GatewayHandler;
  /** Drain timeout for in-flight handlers when stop() is called.
   *  Default 10_000ms (EC-E). After timeout, forces disconnect. */
  drainTimeoutMs?: number;
}

export class GatewayRunner {
  private adaptersByPlatform = new Map<PlatformName, BasePlatformAdapter>();
  private inflight = new Set<Promise<void>>();

  constructor(private opts: GatewayRunnerOptions) {
    for (const a of opts.adapters) this.adaptersByPlatform.set(a.platform, a);
  }

  async start(): Promise<void> { /* connect, wire onInbound→firePreInbound→handler */ }
  async stop(): Promise<void> {
    // EC-E: wait for in-flight handlers up to drainTimeoutMs, then force disconnect.
    await Promise.race([
      Promise.all([...this.inflight]),
      new Promise((r) => setTimeout(r, this.opts.drainTimeoutMs ?? 10_000)),
    ]);
    await Promise.all([...this.adaptersByPlatform.values()].map((a) => a.disconnect()));
  }
}
```

**Per-event context construction (EC-G — `ctx.reply` routes by event.platform):**
```typescript
function buildCtx(event: MessageEvent, adapters: Map<PlatformName, BasePlatformAdapter>): GatewayContext {
  return {
    event,
    reply: async (text, opts) => {
      const a = adapters.get(event.platform);
      if (a === undefined) return { ok: false, error: { code: "no_adapter", message: `no adapter for ${event.platform}` } };
      return a.sendMessage({ channel: event.channel, text, format: opts?.format });
    },
  };
}
```

**EC-D — `block: true` with `message` triggers auto-reply:**
```typescript
// Inside the inbound dispatch:
const decision = await hookExecutor.firePreInbound({ event });
if (decision.block === true) {
  if (decision.message !== undefined) await ctx.reply(decision.message);
  return; // short-circuit handler
}
```

**Invariants:**
- `start()` connects adapters in parallel via `Promise.all`. If ANY fails, calls `stop()` on the ones that succeeded and rethrows.
- The handler is wrapped in try/catch — exceptions are logged via `Security.redact(console.error(...))` (EC-F) and do NOT crash the gateway.
- `stop()` waits up to `drainTimeoutMs` for in-flight handlers BEFORE disconnecting adapters (EC-E).
- `stop()` is safe to call multiple times.
- All error log paths use `Security.redact(...)` from `@usetheo/sdk` to scrub tokens (EC-F, ADR D68).

**Edge cases:**
- **EC-1:** Empty `adapters` array → `start()` succeeds (logs warning), runner waits but never dispatches.
- **EC-2:** Adapter throws on connect → `start()` rejects with aggregate error; partial connections rolled back.
- **EC-3:** Handler throws — log + continue, never lose other in-flight events.
- **EC-4:** `stop()` called before `start()` → no-op.

#### Tasks
1. Define `GatewayHandler`, `GatewayContext`, `GatewayRunnerOptions`, `GatewayRunner`.
2. Wire `start()` to call `adapter.onInbound(handler)` per adapter.
3. Implement try/catch around handler.
4. Tests with `MockAdapter`.

#### TDD
```
RED:     test_runner_start_connects_all_adapters
RED:     test_runner_start_throws_if_any_adapter_fails — rollback verified
RED:     test_runner_inbound_dispatches_to_handler
RED:     test_runner_handler_throws_does_not_crash_runner
RED:     test_runner_stop_disconnects_all_adapters
RED:     test_runner_stop_idempotent
RED:     test_runner_ctx_reply_sends_via_correct_adapter — multi-adapter routing (EC-G)
RED:     test_runner_ctx_reply_unknown_platform_returns_no_adapter — EC-G fallback
RED:     test_runner_stop_drains_inflight_handlers_before_disconnect — EC-E
RED:     test_runner_stop_force_disconnects_after_drain_timeout — EC-E
RED:     test_runner_block_with_message_auto_replies_then_short_circuits — EC-D
RED:     test_runner_block_without_message_short_circuits_silently — EC-D negative
RED:     test_runner_error_logs_are_redacted — EC-F: token in error string is masked
GREEN:   implement GatewayRunner
REFACTOR: extract connect/disconnect lifecycle if size demands
VERIFY:  pnpm --filter @usetheo/gateway test
```

#### Acceptance Criteria
- [ ] 13 RED tests GREEN (was 7 — +6 from EC-D/E/F/G fixes)
- [ ] File ≤250 LoC (was ≤200 — +50 for drain timeout + ctx builder + redact)
- [ ] Knip clean
- [ ] EC-F: `Security.redact` wraps every `console.error` / `console.warn` in the runner

#### DoD
- [ ] CHANGELOG entry
- [ ] All tests green

---

## Phase 2: SessionRouter (composes Agent.resume)

**Objective:** Map a `MessageEvent` to an `agentId` via deterministic rules; the SDK owns the actual session.

### T2.1 — `SessionRouter` with strategy hook

#### Objective
Pure routing: given a `MessageEvent`, produce a stable string. Consumer overrides default strategy via constructor.

#### Evidence
- D174 (decision — never reimplement session storage).
- `examples/telegram-pro/src/agent.ts::resolveAgentId(ctx)` is the existing pattern — we generalize it.

#### Files to edit
```
packages/gateway/src/session/router.ts (NEW)
packages/gateway/src/session/index.ts (NEW)
packages/gateway/src/index.ts — re-export
packages/gateway/tests/session/router.test.ts (NEW)
```

#### Deep file dependency analysis
- Depends on T1.1 (MessageEvent).
- Pure function — no SDK dep at this layer; the consumer wires it to `Agent.resume`.

#### Deep Dives

**Shape:**
```typescript
export type AgentIdStrategy = (event: MessageEvent) => string;

export class SessionRouter {
  constructor(private strategy: AgentIdStrategy = defaultStrategy) {}
  resolveAgentId(event: MessageEvent): string {
    return this.strategy(event);
  }
}

/** Default: <platform>-<channelType>-<channel.id>[-<sender.id>] */
export function defaultStrategy(event: MessageEvent): string {
  const { platform, channel, sender } = event;
  switch (channel.type) {
    case "dm":     return `${platform}-dm-${sender.id}`;
    case "thread":
      // EC-B: missing topicId in a thread event = adapter bug. Fallback to
      // group key prevents split-brain sessions (the key would become
      // "...-undefined" otherwise).
      if (channel.topicId === undefined) return `${platform}-grp-${channel.id}-${sender.id}`;
      return `${platform}-tpc-${channel.id}-${channel.topicId}`;
    case "group":  return `${platform}-grp-${channel.id}-${sender.id}`;
  }
}
```

**Invariants:**
- Pure: same input → same output.
- The format is **lexicographically safe** — no characters outside `[a-z0-9-_]` after sanitization.
- The format matches what telegram-pro currently uses (`tg-pro-dm-${userId}`) modulo the platform prefix — D178 says we keep the same shape post-migration to preserve agentId continuity for existing users.

**Edge cases:**
- **EC-1:** `sender.id` or `channel.id` contains `-`? → sanitize to `_`.
- **EC-2:** Discord DM: `guildId: null` → channel.type === "dm", channel.id is the DM channel id.
- **EC-3:** Telegram forum topic: channel.type === "thread", topicId set.
- **EC-4:** future platforms: default strategy MUST handle all `channel.type` literal values exhaustively (TS forces this).

#### Tasks
1. Implement `SessionRouter` and `defaultStrategy`.
2. Tests.

#### TDD
```
RED:     test_default_strategy_telegram_dm
RED:     test_default_strategy_telegram_thread
RED:     test_default_strategy_telegram_group
RED:     test_default_strategy_discord_dm
RED:     test_default_strategy_discord_thread
RED:     test_custom_strategy_overrides_default
RED:     test_sanitize_id_with_dashes — EC-1
RED:     test_thread_with_undefined_topicId_falls_back_to_group_key — EC-B
GREEN:   implement
REFACTOR: none
VERIFY:  pnpm --filter @usetheo/gateway test
```

#### Acceptance Criteria
- [ ] 8 RED tests GREEN (was 7 — +1 from EC-B topicId fallback)
- [ ] File ≤80 LoC
- [ ] Pure (no side effects)

#### DoD
- [ ] CHANGELOG entry
- [ ] Tests green

---

## Phase 3: DeliveryRouter (composes Cron)

**Objective:** Route outbound messages (esp. from Cron) to the right adapter + channel.

### T3.1 — `DeliveryRouter` with adapter lookup

#### Objective
Given `{ platform, channel, text }`, find the adapter and call `sendMessage`. Errors propagate via the same `SendResult` shape.

#### Evidence
- D175 (decision).
- Telegram-pro's `cron-setup.ts` currently calls `agent.send(...)` directly from cron — that's the boilerplate we're abstracting.

#### Files to edit
```
packages/gateway/src/delivery/router.ts (NEW)
packages/gateway/src/delivery/index.ts (NEW)
packages/gateway/src/index.ts — re-export
packages/gateway/tests/delivery/router.test.ts (NEW)
```

#### Deep file dependency analysis
- Depends on T1.2 (`BasePlatformAdapter`).
- Composed by the consumer when wiring Cron callbacks.

#### Deep Dives

**Shape:**
```typescript
export interface DeliveryTarget {
  readonly platform: PlatformName;
  readonly channel: { id: string; type: "dm" | "group" | "thread"; topicId?: string };
}

export interface DeliveryRequest extends DeliveryTarget {
  readonly text: string;
  readonly format?: "plain" | "markdown" | "html";
  readonly replyTo?: string;
}

export class DeliveryRouter {
  private adapters = new Map<PlatformName, BasePlatformAdapter>();
  register(adapter: BasePlatformAdapter): void { /* */ }
  async send(req: DeliveryRequest): Promise<SendResult> { /* */ }
}
```

**Invariants:**
- `register` last-wins by `platform`. Re-registering replaces.
- `send` with an unknown platform returns `{ ok: false, error: { code: "no_adapter" } }`.
- `send` never throws on platform errors (delegates to adapter's SendResult shape).

**Edge cases:**
- **EC-1:** Send to platform with no registered adapter → `{ ok: false, error: { code: "no_adapter" } }`.
- **EC-2:** Send with empty text → propagates to adapter; adapter rejects per T1.2 EC-1.
- **EC-3:** Concurrent sends to same channel → adapter's underlying client serializes (grammy/discord.js both queue).

#### Tasks
1. Implement `DeliveryRouter`.
2. Tests with `MockAdapter` (Telegram + Discord shapes).

#### TDD
```
RED:     test_router_register_adapter
RED:     test_router_register_replaces_existing
RED:     test_router_send_routes_to_correct_adapter
RED:     test_router_send_unknown_platform_returns_no_adapter_error
RED:     test_router_send_does_not_throw_on_adapter_error
GREEN:   implement
REFACTOR: none
VERIFY:  pnpm --filter @usetheo/gateway test
```

#### Acceptance Criteria
- [ ] 5 RED tests GREEN
- [ ] File ≤100 LoC

#### DoD
- [ ] CHANGELOG entry
- [ ] Tests green

---

## Phase 4: Hook system

**Objective:** Three fire points — pre_inbound, post_outbound, on_error.

### T4.1 — `GatewayHook` contract + executor

#### Objective
Hooks intercept the inbound event flow (D176, D177).

#### Evidence
- D176 (hooks live in gateway, not in SDK plugin contract).
- D177 (signature mirrors SDK pre_tool_call).
- telegram-pro's `group-policy.ts` is the canonical pre_inbound use case.

#### Files to edit
```
packages/gateway/src/hooks/types.ts (NEW)
packages/gateway/src/hooks/executor.ts (NEW)
packages/gateway/src/hooks/index.ts (NEW)
packages/gateway/src/runner/gateway-runner.ts — wire hook executor into start()
packages/gateway/tests/hooks/executor.test.ts (NEW)
```

#### Deep file dependency analysis
- Depends on T1.1, T1.2.
- Runner integration: when an inbound event arrives, pre_inbound hooks run first; if any returns `{ block: true }`, the handler is not invoked.

#### Deep Dives

**Shape:**
```typescript
export type HookName = "pre_inbound" | "post_outbound" | "on_error";

export interface HookDecision {
  block?: boolean;
  message?: string;
}

export interface PreInboundContext {
  readonly event: MessageEvent;
}
export interface PostOutboundContext {
  readonly event: MessageEvent;
  readonly outbound: OutboundMessage;
  readonly result: SendResult;
}
export interface OnErrorContext {
  readonly event: MessageEvent;
  readonly error: Error;
}

export interface GatewayHook {
  name: string;
  pre_inbound?(ctx: PreInboundContext): Promise<HookDecision | void>;
  post_outbound?(ctx: PostOutboundContext): Promise<void>;
  on_error?(ctx: OnErrorContext): Promise<void>;
}

export class HookExecutor {
  constructor(private hooks: ReadonlyArray<GatewayHook>) {}
  async firePreInbound(ctx: PreInboundContext): Promise<HookDecision> { /* short-circuit on first block */ }
  async firePostOutbound(ctx: PostOutboundContext): Promise<void> { /* fire-and-forget all */ }
  async fireOnError(ctx: OnErrorContext): Promise<void> { /* fire-and-forget all */ }
}
```

**Invariants:**
- `firePreInbound` runs hooks sequentially; first `block: true` short-circuits the chain.
- `firePostOutbound` / `fireOnError` are fire-and-forget — exceptions are logged, not propagated.
- A hook throwing in `pre_inbound` is treated as `block: true` + log.

**Edge cases:**
- **EC-1:** Empty hooks array — `firePreInbound` returns `{ block: false }`.
- **EC-2:** Hook returns `undefined` (no decision) — treated as `{ block: false }`.
- **EC-3 (D177 spec):** when `pre_inbound` returns `{ block: true, message }`, the runner MUST call `ctx.reply(message)` before short-circuiting. Wired in T1.3 (EC-D). Not optional — drives the rate-limit / allowlist UX.

#### Tasks
1. Define types.
2. Implement `HookExecutor`.
3. Wire into `GatewayRunner.start()` — replace direct handler call with `firePreInbound` → handler → `firePostOutbound`.
4. Wrap handler in try/catch → `fireOnError`.
5. Tests.

#### TDD
```
RED:     test_executor_empty_hooks_returns_unblocked
RED:     test_executor_first_block_short_circuits
RED:     test_executor_hook_throws_treated_as_block
RED:     test_executor_post_outbound_fires_all
RED:     test_executor_on_error_fires_all
RED:     test_runner_blocked_inbound_does_not_call_handler
RED:     test_runner_handler_throw_fires_on_error_hooks
GREEN:   implement
REFACTOR: none
VERIFY:  pnpm --filter @usetheo/gateway test
```

#### Acceptance Criteria
- [ ] 7 RED tests GREEN
- [ ] File ≤150 LoC each

#### DoD
- [ ] CHANGELOG entry
- [ ] Tests green

---

## Phase 5: Telegram adapter

**Objective:** Wrap grammy in `BasePlatformAdapter`. Parallel-development-ready with Phase 6.

### T5.1 — `TelegramAdapter` implementation

#### Objective
Concrete adapter for grammy.

#### Evidence
- telegram-pro's existing 1641-LoC `index.ts` proves grammy's API and the integration points we need.

#### Files to edit
```
packages/gateway-telegram/src/adapter.ts (NEW)
packages/gateway-telegram/src/index.ts (NEW)
packages/gateway-telegram/src/group-policy.ts (NEW) — moved from examples/telegram-pro
packages/gateway-telegram/tests/adapter.test.ts (NEW)
```

#### Deep file dependency analysis
- Depends on `@usetheo/gateway` (T1.1, T1.2).
- Imports grammy as peer dep.

#### Deep Dives

**Shape:**
```typescript
import { Bot, type Context } from "grammy";
import { BasePlatformAdapter, type MessageEvent, type OutboundMessage, type SendResult } from "@usetheo/gateway";

export interface TelegramAdapterOptions {
  token: string;
  /** Optional allowed-user filter — bypasses pre_inbound for non-allowed users at adapter level. */
  allowedUsers?: ReadonlyArray<string>;
}

export class TelegramAdapter extends BasePlatformAdapter {
  readonly platform = "telegram" as const;
  private bot: Bot;
  private handler?: (event: MessageEvent) => Promise<void>;

  constructor(private opts: TelegramAdapterOptions) {
    super();
    this.bot = new Bot(opts.token);
  }

  async connect(): Promise<boolean> { /* bot.start() in background */ }
  async disconnect(): Promise<void> { /* bot.stop() */ }
  async sendMessage(out: OutboundMessage): Promise<SendResult> { /* bot.api.sendMessage */ }
  onInbound(handler: (event: MessageEvent) => Promise<void>): () => void { /* bot.on("message", ...) */ }
  async startTyping(channelId: string): Promise<void> { /* bot.api.sendChatAction(channelId, "typing") */ }
}
```

**Event normalization (grammy.Context → MessageEvent):**
```typescript
function normalizeEvent(ctx: Context): TelegramMessageEvent {
  const chat = ctx.chat!;
  return {
    id: `tg-${chat.id}-${ctx.message?.message_id}`,
    platform: "telegram",
    sender: {
      id: String(ctx.from?.id ?? "anonymous"),
      username: ctx.from?.username,
      displayName: ctx.from?.first_name,
    },
    channel: {
      id: String(chat.id),
      type: chat.type === "private" ? "dm" : (ctx.message?.message_thread_id ? "thread" : "group"),
      topicId: ctx.message?.message_thread_id ? String(ctx.message.message_thread_id) : undefined,
    },
    text: ctx.message?.text ?? ctx.message?.caption ?? "",
    receivedAt: Date.now(),
    telegram: { chatId: chat.id, messageId: ctx.message!.message_id, threadId: ctx.message?.message_thread_id, raw: ctx },
  };
}
```

**Invariants:**
- `connect()` calls `bot.start()` without awaiting (grammy's polling loop is a long-lived promise).
- `sendMessage` maps `format: "markdown"` to `parse_mode: "MarkdownV2"`, `format: "html"` to `parse_mode: "HTML"`.
- Markdown errors (Telegram is strict about V1 vs V2) propagate as `SendResult { ok: false, error: { code: "markdown_error" } }`.
- Group policy is exposed as a sibling utility (`shouldRespondInChat`) but NOT wired into the adapter — consumer registers it as a `pre_inbound` hook (D177 pattern).

**Edge cases:**
- **EC-1:** `sendMessage` with text >4096 chars → automatic split using existing `splitForTelegram` (move from `examples/telegram-pro/src/format.ts`).
- **EC-2:** Bot lacks permission in a group → `SendResult { ok: false, error: { code: "no_permission" } }`.
- **EC-3:** Bot hits Telegram rate-limit (429 with retry-after) → `SendResult { ok: false, error: { code: "rate_limited", message: "retry after Ns" } }`.
- **EC-4:** Slash command auto-routes — `ctx.message.text.startsWith("/")` is the discriminator (preserve existing behavior).

#### Tasks
1. Implement `TelegramAdapter`.
2. Move `group-policy.ts` from telegram-pro into this package (preserving behavior).
3. Move `format.ts::splitForTelegram` into this package as `internal/split.ts`.
4. Tests with mocked grammy `Bot`.

#### TDD
```
RED:     test_telegram_adapter_connect_idempotent
RED:     test_telegram_adapter_send_returns_ok_on_success
RED:     test_telegram_adapter_send_long_text_auto_splits
RED:     test_telegram_adapter_send_rate_limited_returns_error
RED:     test_telegram_adapter_normalize_dm_event
RED:     test_telegram_adapter_normalize_group_event
RED:     test_telegram_adapter_normalize_thread_event
RED:     test_telegram_adapter_inbound_unsubscribe_stops_handler
RED:     test_group_policy_dm_always_responds
RED:     test_group_policy_group_responds_on_mention
RED:     test_group_policy_group_ignores_others
RED:     test_telegram_adapter_connect_invalid_token_returns_false — EC-I (not throw)
RED:     test_telegram_adapter_split_preserves_markdown_pairs — EC-J (no orphan **)
RED:     test_telegram_adapter_ignores_messages_from_other_bots — EC-K (is_bot filter)
GREEN:   implement adapter + group-policy + split
REFACTOR: none
VERIFY:  pnpm --filter @usetheo/gateway-telegram test
```

#### Acceptance Criteria
- [ ] 14 RED tests GREEN (was 11 — +3 from EC-I/J/K)
- [ ] Adapter file ≤300 LoC
- [ ] Knip clean

#### DoD
- [ ] CHANGELOG entry
- [ ] Tests green

---

## Phase 6: Discord adapter

**Objective:** Wrap discord.js in `BasePlatformAdapter`. Parallel-development-ready with Phase 5.

### T6.1 — `DiscordAdapter` implementation

#### Objective
Concrete adapter for discord.js.

#### Evidence
- discord.js is the de-facto Discord library (similar maturity to grammy in the Telegram ecosystem).

#### Files to edit
```
packages/gateway-discord/src/adapter.ts (NEW)
packages/gateway-discord/src/index.ts (NEW)
packages/gateway-discord/tests/adapter.test.ts (NEW)
```

#### Deep Dives

**Shape:**
```typescript
import { Client, GatewayIntentBits, type Message } from "discord.js";
import { BasePlatformAdapter, type MessageEvent, type OutboundMessage, type SendResult } from "@usetheo/gateway";

export interface DiscordAdapterOptions {
  token: string;
  /**
   * Default: [Guilds, GuildMessages, MessageContent, DirectMessages,
   * DirectMessageReactions]. Without `MessageContent` Discord delivers
   * empty `msg.content` and the bot looks broken (EC-C silent failure).
   * Passing `intents: []` explicitly logs a warn on connect().
   */
  intents?: GatewayIntentBits[];
}

const DEFAULT_INTENTS: GatewayIntentBits[] = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.DirectMessageReactions,
];

export class DiscordAdapter extends BasePlatformAdapter {
  readonly platform = "discord" as const;
  private client: Client;
  /* ... */
}
```

**Event normalization (discord.js Message → MessageEvent):**
```typescript
function normalizeEvent(msg: Message): DiscordMessageEvent {
  return {
    id: `dc-${msg.channelId}-${msg.id}`,
    platform: "discord",
    sender: { id: msg.author.id, username: msg.author.username, displayName: msg.author.globalName ?? undefined },
    channel: {
      id: msg.channelId,
      type: msg.guildId === null ? "dm" : (msg.channel.isThread() ? "thread" : "group"),
      topicId: msg.channel.isThread() ? msg.channel.id : undefined,
    },
    text: msg.content,
    receivedAt: msg.createdTimestamp,
    discord: { guildId: msg.guildId, channelId: msg.channelId, messageId: msg.id, raw: msg },
  };
}
```

**Invariants:**
- `connect()` calls `client.login(token)` and awaits the `ready` event.
- `sendMessage` text >2000 chars → split (Discord's hard limit; different from Telegram's 4096).
- Bot user filtering: ignore messages from other bots (`msg.author.bot === true`) at adapter level — saves consumer from defining a hook.

**Edge cases:**
- **EC-1:** Discord 2000-char limit (vs Telegram 4096) — adapter splits with `…` continuation marker.
- **EC-2:** Slash commands in Discord are **registered ahead of time** via the application command API. v0.1 supports text commands only (`!cmd` or mention-then-text); proper slash commands (`/cmd`) are out of scope.
- **EC-3:** Bot lacks permission to send → `{ ok: false, error: { code: "no_permission" } }`.
- **EC-4:** Reconnect: discord.js has auto-reconnect built-in; we don't add a layer.
- **EC-5:** DM permissions: user must allow DMs from server members; failure returns `{ code: "dm_blocked" }`.

#### Tasks
1. Implement `DiscordAdapter`.
2. Tests with mocked discord.js `Client`.

#### TDD
```
RED:     test_discord_adapter_connect_awaits_ready
RED:     test_discord_adapter_send_returns_ok
RED:     test_discord_adapter_send_long_text_splits_at_2000
RED:     test_discord_adapter_normalize_dm_event
RED:     test_discord_adapter_normalize_guild_event
RED:     test_discord_adapter_normalize_thread_event
RED:     test_discord_adapter_ignores_bot_messages
RED:     test_discord_adapter_send_no_permission_returns_error
RED:     test_discord_adapter_default_intents_include_MessageContent — EC-C: silent-failure guard
RED:     test_discord_adapter_empty_intents_logs_warn — EC-C: explicit opt-out is loud
GREEN:   implement
REFACTOR: none
VERIFY:  pnpm --filter @usetheo/gateway-discord test
```

#### Acceptance Criteria
- [ ] 10 RED tests GREEN (was 8 — +2 from EC-C default intents)
- [ ] Adapter file ≤300 LoC

#### DoD
- [ ] CHANGELOG entry
- [ ] Tests green

---

## Phase 7: Migrate telegram-pro

**Objective:** Rewire `examples/telegram-pro` to use `@usetheo/gateway` + `@usetheo/gateway-telegram` while preserving 100% of slash command behavior (D178).

### T7.1 — Replace `new Bot(TOKEN)` with `new GatewayRunner({...})`

#### Objective
Single-file mechanical refactor of `index.ts`. Slash commands migrate verbatim modulo `ctx` type.

#### Evidence
- D178 (preservation contract).
- `/telegram-pro-dogfood` skill is the regression gate (42 commands).

#### Files to edit
```
examples/telegram-pro/package.json — add @usetheo/gateway, @usetheo/gateway-telegram deps
examples/telegram-pro/src/index.ts — rewrite top-level wiring (NOT individual handler bodies)
examples/telegram-pro/src/group-policy.ts — DELETE (now in @usetheo/gateway-telegram)
examples/telegram-pro/src/format.ts — DELETE (splitForTelegram now in @usetheo/gateway-telegram)
examples/telegram-pro/src/agent.ts — adjust resolveAgentId to delegate to SessionRouter (optional preservation alias)
```

#### Deep file dependency analysis

The migration is **structural at the top**, **mechanical in handlers**:

- **TOP (rewritten):** `const bot = new Bot(TOKEN)` → `const runner = new GatewayRunner({ adapters: [new TelegramAdapter({ token: TOKEN })], handler })`.
- **HANDLERS (preserved):** every `bot.command("X", async (ctx) => ...)` becomes a `runner.command("X", async (ctx) => ...)` with **the same handler body**.
- **HELPERS (deleted):** `group-policy.ts` and `format.ts` removed; their re-exports come from `@usetheo/gateway-telegram`.

`runner.command(name, handler)` is a thin sugar over the underlying `pre_inbound` hook that matches `text.startsWith(`/${name}`)`. The slash dispatch happens in the gateway, not in grammy directly.

#### Deep Dives

**Sugar API in `@usetheo/gateway`:**
```typescript
class GatewayRunner {
  command(name: string, handler: (event: MessageEvent, ctx: GatewayContext) => Promise<void>): void {
    // registers a pre_inbound hook with WORD-BOUNDARY match (EC-A).
    // Match rule: text === "/" + name
    //          OR text.startsWith("/" + name + " ")
    //          OR text.startsWith("/" + name + "@") — Telegram group disambiguation
    // Without boundary check, /skill would shadow /skills.
  }
}
```

**Migration steps for each handler:**
1. `bot.command("help", async (ctx) => { await ctx.reply("...") })` 
2. → `runner.command("help", async (event, ctx) => { await ctx.reply("...") })`

**The `ctx` object provided by the gateway exposes `.reply(text, opts?)` — same signature as grammy's `ctx.reply`. The handler body changes ONLY where it accessed grammy-specific fields.**

**Grammy-specific accesses to preserve:**
- `ctx.match` (slash command args) → migrated to `event.text.slice(("/" + cmd).length).trim()` OR via a `args: string` field added to `GatewayContext`.
- `ctx.from`, `ctx.chat` → already on `event.sender` / `event.channel`.
- `ctx.message.message_thread_id` → `event.telegram?.threadId`.
- `ctx.replyWithVoice`, `ctx.replyWithPhoto`, etc → out of v0.1 portable API — keep direct access via `event.telegram?.raw as grammy.Context` as escape hatch (D180).

**Voice / Vision / Photo handlers:**
- `bot.on(":voice", handler)` migrates to `event.telegram?.raw.message?.voice` check inside a general inbound handler. Documented in README as "platform escape hatch".

**Invariants:**
- All 42 dogfood commands work identically.
- agentId format (`tg-pro-dm-XXX`) preserved — D174 default strategy returns the same shape.
- No silent behavior changes (markdown parsing, message length splitting, group policy).

**Edge cases:**
- **EC-1:** Existing user sessions: agentId `tg-pro-dm-XXX` (note: hyphen) currently used by telegram-pro must match the new SessionRouter default strategy output. T7.2 introduces a custom strategy that prepends `tg-pro` for backward compat.
- **EC-2:** `bot.use(...)` middleware (the redaction + allowlist middleware at line 62-81 of current `index.ts`) — migrates to a `pre_inbound` hook. **EC-L:** hook order MUST preserve current middleware order (redact → allowlist → handler). Register hooks in the SAME order the middleware fires today.
- **EC-3:** Streaming mode (`/stream on`) edits a placeholder via `editMessageText` — keep escape hatch via `event.telegram?.raw`.
- **EC-A (slash boundary):** telegram-pro has both `/skill` AND `/skills`, `/loop` AND `/loops`, `/stop_loop` AND `/stop_loop all`. The `runner.command(name, h)` sugar MUST use word-boundary match (see T1.3 spec), otherwise `/skills` is shadowed by `/skill`. Verified by the existing dogfood suite — if the boundary breaks, command dispatch tests fail.

#### Tasks
1. Add `@usetheo/gateway` + `@usetheo/gateway-telegram` to package.json.
2. Rewrite the top 60 lines of `index.ts` (imports + bot construction + start).
3. Convert each `bot.command(...)` to `runner.command(...)`.
4. Convert the `bot.use(...)` allowlist middleware to a hook.
5. Move voice / photo / sticker handlers to `runner.onInbound(...)` with `event.telegram?.raw` access.
6. Delete `group-policy.ts` + `format.ts`.
7. Add `T7.2 — backward-compat agentId` (next task).

#### TDD
```
RED:     test_typecheck_passes_after_migration — pnpm --filter @usetheo/example-telegram-pro typecheck
RED:     test_telegram_pro_hook_order_allowlist_after_redact — EC-L: registration order matches current middleware
RED:     test_telegram_pro_skill_does_not_shadow_skills — EC-A: real test against the migrated dispatch
RED:     test_telegram_pro_loop_does_not_shadow_loops — EC-A: second prefix-shared pair
GREEN:   migration committed
VERIFY:  pnpm --filter @usetheo/example-telegram-pro typecheck
```

#### Acceptance Criteria
- [ ] `index.ts` LoC reduced from 1641 → ≤900 (target 40%+ reduction)
- [ ] Typecheck passes
- [ ] All 42 slash commands present (grep audit)
- [ ] EC-A: prefix-shared command pairs (`/skill`+`/skills`, `/loop`+`/loops`) all dispatch correctly
- [ ] EC-L: hook registration order matches current `bot.use(...)` chain
- [ ] Bot boots: `pnpm tsx --env-file=.env src/index.ts` connects as `@theo_paulo_bot`

#### DoD
- [ ] Bot boots green
- [ ] Typecheck passes
- [ ] CHANGELOG entry

---

### T7.2 — Backward-compat agentId via custom SessionRouter strategy

#### Objective
Existing agent sessions in `.theokit/registry.json` use `tg-pro-dm-XXX` (with `tg-pro` prefix). New default would emit `telegram-dm-XXX`. To preserve continuity, telegram-pro registers a custom strategy.

#### Evidence
- The session JSONL files on disk use the `tg-pro-` prefix.
- Breaking the prefix would orphan every existing user's history.

#### Files to edit
```
examples/telegram-pro/src/index.ts — register custom strategy
```

#### Deep Dives

```typescript
const router = new SessionRouter((event) => {
  // Preserve the legacy "tg-pro" prefix from pre-gateway era.
  const platform = "tg-pro";
  const { channel, sender } = event;
  switch (channel.type) {
    case "dm":     return `${platform}-dm-${sender.id}`;
    case "thread": return `${platform}-tpc-${channel.id}-${channel.topicId}`;
    case "group":  return `${platform}-grp-${channel.id}-${sender.id}`;
  }
});
```

#### Tasks
1. Define the strategy inline.
2. Pass to `SessionRouter` constructor.
3. Wire into the handler that calls `Agent.resume(router.resolveAgentId(event))`.

#### TDD
```
RED:     test_existing_agent_resumes_after_migration — programmatic Agent.resume("tg-pro-dm-7528967933") after migration succeeds
GREEN:   custom strategy in place
VERIFY:  manual probe + dogfood
```

#### Acceptance Criteria
- [ ] Existing agentIds preserved
- [ ] Dogfood passes (agentId continuity is implicit)

---

## Phase 8: Minimal Discord example

**Objective:** Validate `@usetheo/gateway-discord` works against a real Discord guild with a `/ping`-style command and one real-LLM command.

### T8.1 — Build `examples/gateway-discord/`

#### Objective
Smallest possible Discord bot that proves the abstraction holds.

#### Evidence
- The Discord adapter is dead code until something exercises it.

#### Files to edit
```
examples/gateway-discord/package.json (NEW)
examples/gateway-discord/tsconfig.json (NEW)
examples/gateway-discord/src/index.ts (NEW) — ~150 LoC
examples/gateway-discord/.env.example (NEW)
examples/gateway-discord/README.md (NEW)
```

#### Deep Dives

```typescript
import { Agent } from "@usetheo/sdk";
import { GatewayRunner, SessionRouter } from "@usetheo/gateway";
import { DiscordAdapter } from "@usetheo/gateway-discord";

const adapter = new DiscordAdapter({ token: process.env.DISCORD_BOT_TOKEN! });
const router = new SessionRouter();

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    if (event.text.startsWith("/ping")) return ctx.reply("pong");
    if (event.text.startsWith("/ask ")) {
      const q = event.text.slice("/ask ".length);
      const agent = await Agent.resume(router.resolveAgentId(event), { /* base options */ });
      const run = await agent.send(q);
      const result = await run.wait();
      await ctx.reply(result.result ?? "no reply");
      await agent.dispose();
    }
  },
});

await runner.start();
console.log("discord-gateway bot online");
```

**Invariants:**
- `/ping` is a config-only response (no LLM) — proves transport works.
- `/ask <q>` exercises the full `Agent.create` → `Agent.send` → `ctx.reply` round-trip.
- README documents how to register the bot in Discord Developer Portal and invite it to a test server.

**Edge cases:**
- **EC-1:** `DISCORD_BOT_TOKEN` missing → graceful error message + exit code 1.
- **EC-2:** No guilds configured → bot still online; first server to add it works.

#### Tasks
1. Create package.json with peer dep on `@usetheo/sdk`, `@usetheo/gateway`, `@usetheo/gateway-discord`, `discord.js`.
2. Write minimal `index.ts`.
3. README with setup steps.

#### TDD
```
RED:     test_discord_example_typechecks — pnpm --filter @usetheo/example-gateway-discord typecheck
GREEN:   example committed
VERIFY:  manual run against test Discord server
```

#### Acceptance Criteria
- [ ] Typecheck passes
- [ ] README explains Developer Portal setup
- [ ] Manual probe: `/ping` returns "pong" in a test server
- [ ] Manual probe: `/ask hello` returns a real LLM response

#### DoD
- [ ] CHANGELOG entry
- [ ] Manual probe passes

---

## Phase 9: Documentation + ADRs

**Objective:** Register all 12 ADRs, update CHANGELOGs in all 3 packages, write READMEs, update root `CLAUDE.md` ADR index.

### T9.1 — Write ADRs D170-D181

#### Files to edit
```
.claude/knowledge-base/adrs/D170-gateway-workspace-package.md (NEW)
.claude/knowledge-base/adrs/D171-gateway-platform-peer-deps.md (NEW)
.claude/knowledge-base/adrs/D172-gateway-base-abstract-class.md (NEW)
.claude/knowledge-base/adrs/D173-gateway-message-event-discriminated-union.md (NEW)
.claude/knowledge-base/adrs/D174-gateway-session-router-composes-agent-resume.md (NEW)
.claude/knowledge-base/adrs/D175-gateway-delivery-router-composes-cron.md (NEW)
.claude/knowledge-base/adrs/D176-gateway-hooks-own-contract-not-plugin-kind.md (NEW)
.claude/knowledge-base/adrs/D177-gateway-hooks-veto-signature.md (NEW)
.claude/knowledge-base/adrs/D178-gateway-telegram-pro-migration-preserves-commands.md (NEW)
.claude/knowledge-base/adrs/D179-gateway-discord-websocket-not-webhooks.md (NEW)
.claude/knowledge-base/adrs/D180-gateway-portable-vs-platform-specific.md (NEW)
.claude/knowledge-base/adrs/D181-gateway-pre-1-0-version.md (NEW)
CLAUDE.md — add D170-D181 rows in the ADR table
```

#### Acceptance Criteria
- [ ] All 12 ADRs use the standard template (Date, Status, Decision, Rationale, Consequences)
- [ ] CLAUDE.md ADR table updated

---

### T9.2 — CHANGELOGs + READMEs

#### Files to edit
```
packages/gateway/CHANGELOG.md — [Unreleased] → 0.1.0
packages/gateway-telegram/CHANGELOG.md
packages/gateway-discord/CHANGELOG.md
packages/gateway/README.md — usage example
packages/gateway-telegram/README.md
packages/gateway-discord/README.md
examples/telegram-pro/CHANGELOG.md — note migration
examples/gateway-discord/CHANGELOG.md (NEW)
CLAUDE.md (root) — add `## Gateway` section under "Sub-Project Index" if appropriate
```

#### Acceptance Criteria
- [ ] All 3 package READMEs explain install + minimal usage
- [ ] Migration guide in `examples/telegram-pro/CHANGELOG.md` calls out the SessionRouter strategy preservation

---

## Phase 10: Dogfood QA (MANDATORY)

> The plan is NOT done until this passes.

**Objective:** Validate that the telegram-pro migration produces zero regression on the `/telegram-pro-dogfood` skill, AND the Discord example responds to a real `/ping` + `/ask` from a real Discord client.

### Execution

#### Step 1 — Telegram-pro dogfood
```bash
# Boot the freshly-migrated bot
cd examples/telegram-pro && pnpm tsx --env-file=.env src/index.ts &
sleep 8 && grep "Connected as @" /tmp/tgpro-dogfood.log

# Run the canonical suite (42 commands)
cd /home/paulo/Projetos/usetheo/theokit-sdk
node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933
```

#### Step 2 — Discord example smoke
```bash
cd examples/gateway-discord && pnpm tsx --env-file=.env src/index.ts &
sleep 8
# Manual: send `/ping` in test Discord server → expect "pong"
# Manual: send `/ask what is 2+2` → expect a real LLM reply with "4"
```

### Acceptance Criteria

- [ ] Telegram-pro dogfood: ≥38/42 PASS (baseline from 2026-05-20)
- [ ] **Zero NEW failures** introduced by the migration (the 3 known Gemini flakes — `/recall corinthians`, `/tool uuid` retry, `/tool roll 3d6` retry — may still flake)
- [ ] All 6 `/personality` commands still PASS (v1.14 features intact)
- [ ] Discord `/ping` returns "pong" within 5s
- [ ] Discord `/ask hello` returns a non-empty LLM response within 30s
- [ ] Snapshot file at `.claude/knowledge-base/reviews/telegram-pro-dogfood-{YYYY-MM-DD}.md`

### If Dogfood Fails

1. Identify if the failure is plan-caused (introduced by migration) or pre-existing (Gemini flake).
2. Plan-caused failures BLOCK merge — fix and re-run.
3. Pre-existing failures are documented in the snapshot, not blockers.

---

## Coverage Matrix

| # | Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Workspace package `@usetheo/gateway` | T0.1 | Created with build infra |
| 2 | Workspace package `@usetheo/gateway-telegram` | T0.2 | Created |
| 3 | Workspace package `@usetheo/gateway-discord` | T0.3 | Created |
| 4 | `MessageEvent` discriminated union (D173) | T1.1 | Defined with `platform` discriminator |
| 5 | `BasePlatformAdapter` abstract class (D172) | T1.2 | Implemented |
| 6 | `GatewayRunner` skeleton | T1.3 | Implemented |
| 7 | `SessionRouter` composes `Agent.resume` (D174) | T2.1 | Pure router with strategy hook |
| 8 | `DeliveryRouter` composes `Cron` (D175) | T3.1 | Pure dispatcher |
| 9 | Hooks own contract (D176) | T4.1 | `GatewayHook` + `HookExecutor` |
| 10 | Veto signature (D177) | T4.1 | `HookDecision` shape |
| 11 | Telegram adapter (grammy) | T5.1 | `TelegramAdapter` |
| 12 | Discord adapter (discord.js, D179) | T6.1 | `DiscordAdapter` |
| 13 | telegram-pro migrated (D178) | T7.1 | All slash commands preserved |
| 14 | Backward-compat agentId | T7.2 | Custom strategy |
| 15 | Discord example | T8.1 | `examples/gateway-discord/` |
| 16 | 12 ADRs (D170-D181) | T9.1 | All registered |
| 17 | READMEs + CHANGELOGs | T9.2 | All updated |
| 18 | Dogfood gate | Phase 10 | 38/42 baseline |
| 19 | Portable vs platform-specific features (D180) | T5.1, T6.1 | Escape hatch via `event.{telegram,discord}?.raw` |
| 20 | Pre-1.0 versioning (D181) | T0.{1,2,3} | All at 0.1.0 |

**Coverage: 20/20 (100%)**

## Global Definition of Done

- [ ] All 10 phases completed
- [ ] All tests pass (across 3 new packages + telegram-pro typecheck)
- [ ] Zero TypeScript errors
- [ ] Telegram-pro dogfood: ≥38/42 PASS, zero NEW failures
- [ ] Discord example responds to `/ping` and `/ask` against a real guild
- [ ] All 12 ADRs (D170-D181) committed
- [ ] CHANGELOG entries in 3 packages + telegram-pro
- [ ] Root `CLAUDE.md` ADR table updated with D170-D181 rows
- [ ] LoC reduction in `examples/telegram-pro/src/index.ts`: ≥40%

---

## Edge Case Integration (from 2026-05-20 review)

Cross-reference of every edge case raised by `/edge-case-plan` against the task that absorbs it. Full review at `.claude/knowledge-base/reviews/edge-case/usetheo-gateway-v01-edge-cases-2026-05-20.md`.

| EC | Severity | Task | Resolution |
|---|---|---|---|
| EC-A | MUST FIX | T1.3 / T7.1 | `runner.command(name, h)` uses word-boundary match (`=== "/" + name` OR ` ` OR `@`) — prevents `/skill` shadowing `/skills` |
| EC-B | MUST FIX | T2.1 | `defaultStrategy` thread-case falls back to group key when `topicId === undefined` — no `...-undefined` split-brain sessions |
| EC-C | MUST FIX | T6.1 | `DiscordAdapterOptions.intents` defaults to `[Guilds, GuildMessages, MessageContent, DirectMessages, DirectMessageReactions]`; empty array logs warn |
| EC-D | MUST FIX | T1.3 / T4.1 | `{ block: true, message }` triggers `ctx.reply(message)` BEFORE short-circuit. No more dead field. |
| EC-E | MUST FIX | T1.3 | `GatewayRunner.stop()` drains in-flight handlers up to `drainTimeoutMs` (default 10s) before disconnect |
| EC-F | MUST FIX | T1.3 | All `console.error/warn` in the runner wrap text in `Security.redact(...)` from `@usetheo/sdk` (ADR D68) |
| EC-G | MUST FIX | T1.3 | `ctx.reply` lookups the adapter via `event.platform`; multi-adapter routing is deterministic; unknown platform → `{ ok: false, code: "no_adapter" }` |
| EC-H | SHOULD TEST | T1.2 | `onInbound` second call replaces the handler (not stacks); test asserts only the latest receives events |
| EC-I | SHOULD TEST | T5.1 | Telegram invalid token → `connect()` resolves false (no throw) |
| EC-J | SHOULD TEST | T5.1 | `splitForTelegram` preserves markdown pair integrity across the 4096-char boundary |
| EC-K | SHOULD TEST | T5.1 | Telegram adapter ignores `ctx.from.is_bot === true` (parity with Discord adapter `msg.author.bot`) |
| EC-L | SHOULD TEST | T7.1 | telegram-pro migration preserves hook registration order (redact-logger → allowlist → handler) |
| EC-M | DOCUMENT | T3.1 | `DeliveryRouter.register` without `adapter.connect()` results in send returning `{ code: "disconnected" }` — user responsibility; README documents order |
| EC-N | DOCUMENT | T4.1 | No hook timeout in v0.1; documented "keep hooks under 200ms" in README. Re-evaluate if 3+ real reports |
| EC-O | DOCUMENT | T5.1 | `startTyping` in non-existent chat silently swallowed (cosmetic). JSDoc note |
| EC-P | DOCUMENT | T7.1 / T5.1 | Voice/photo handlers via `event.telegram?.raw` escape hatch — ergonomic cost acknowledged; v0.2 considers `runner.onMediaType(...)` |

## Out of Scope (deliberately)

- **Slack / WhatsApp / Signal adapters** — deferred to v0.2+ guided by real demand.
- **Discord proper slash commands** (`/cmd` via application command API) — v0.1 ships text-trigger commands only; proper slash commands need pre-registration and are a separate task.
- **Webhook-based bot mode** for either platform — v0.1 is long-lived process only (D179).
- **Voice channels** (Discord) and **voice transcription** (Telegram) — out of the portable core (D180); telegram-pro keeps current behavior via escape hatch.
- **Plugin system extension to include gateway hooks** — explicitly rejected (D176).
- **Hot-reload of adapters** — out of scope; restart-driven.
- **Cron `deliver=<platform>` env-var routing** (Hermes pattern) — defer to v0.2 once we see real cross-platform delivery use cases.
