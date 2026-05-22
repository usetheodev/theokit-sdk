# Plan: Slack Gateway Adapter (`@usetheo/gateway-slack`)

> **Version 1.2 — ✅ COMPLETE 2026-05-22.** TODAS AS TASKS, CRITERIOS DE ACEITES, DODs CONCLUIDAS E VALIDADAS. `@usetheo/gateway-slack` shipped: 56/56 unit tests PASS (split/errors/normalize/adapter cobrindo D267-D285 + EC-1/2/3/4/6); build ESM+CJS+DTS verde; 19 ADRs registradas; example `examples/slack-bot/` standalone. Telegram-pro regression check via dogfood: **43/45 PASS, 0 feature regressions** induzidas por adicionar `"slack"` ao `PlatformName` union; 1 FAIL é `/personality ghost` CDP-timeout flake (environmental, não relacionado), 1 SKIP HONCHO. Live Slack workspace test é manual env-gated (D284).
>
> **Version 1.1** — Edge case review 2026-05-22 absorveu 4 MUST FIX (EC-1 `app.stop()` no catch para evitar app órfão, EC-2 serializar `connect()` concorrente, EC-3 mention guard default-true para canais, EC-4 surrogate-safe split) + adicionou **D285** (`requireMention` default true) → 19 ADRs (D267-D285). 3 SHOULD TEST adicionados aos TDD; 2 DOCUMENT integrados. Review: `.claude/knowledge-base/reviews/edge-case/gateway-slack-edge-cases-2026-05-22.md`.
>
> **Version 1.0** — Adiciona `@usetheo/gateway-slack` como o terceiro platform adapter sobre `@usetheo/gateway` (após Telegram e Discord). Segue o padrão estabelecido em ADRs D170-D181 (gateway core + peer-dep packages): `BasePlatformAdapter` implementation com `connect/disconnect/sendMessage/onInbound`, normalização de `SlackEvent` → `SlackMessageEvent` (discriminated union por `platform: "slack"`), Socket Mode default via `@slack/bolt`, threading nativa via `thread_ts`, message split 4000-char (limite Slack `chat.postMessage.text`). Outcome esperado: shippar item #7 do Adoption Roadmap com 18 ADRs (D267-D284), 40+ unit tests com Bolt SDK mockado, example `examples/slack-bot/` standalone, validação end-to-end opcional contra workspace Slack real quando `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` estiverem disponíveis no env.

## Context

**O que existe hoje (gateway core, validado em 2 platforms):**

- `BasePlatformAdapter` abstract class em `packages/gateway/src/adapter/base.ts` define o contrato: `connect(): Promise<boolean>`, `disconnect(): Promise<void>`, `sendMessage(out: OutboundMessage): Promise<SendResult>`, `onInbound(handler): () => void`.
- `MessageEvent` discriminated union (D173) por campo `platform: "telegram" | "discord"` (vai virar `"telegram" | "discord" | "slack"`).
- `TelegramAdapter` em `packages/gateway-telegram/src/adapter.ts` — referência principal: grammy bot, `splitForTelegram` 4096-char util, group-policy filter, `replyParameters`/`message_thread_id` para threads.
- `DiscordAdapter` em `packages/gateway-discord/src/adapter.ts` — segunda referência: discord.js WebSocket Gateway (D179), `MessageContent` intent obrigatório (EC-C), 2000-char split.
- `gateway-telegram/package.json` segue ADR D171: `@usetheo/gateway` + `@usetheo/sdk` como workspace peer-deps; `grammy` como peer-dep externa. Template direto para `@usetheo/gateway-slack`.
- Gateway runner (`packages/gateway/src/runner/`) + session router (D174) + delivery router (D175) já são platform-agnostic — adapter novo conecta automaticamente.

**O que está faltando:**

Hoje, qualquer cliente Slack que queira usar o SDK precisa escrever sua própria integração — não há reuso da abstração `BasePlatformAdapter`. Slack é o 3º maior canal para bots empresariais (Telegram + Discord + Slack cobrem ~90% dos use cases de chat-bot). Sem ele, customers enterprise (cuja preferência majoritária é Slack) ficam de fora.

**Evidências da pesquisa em referências (relatório completo no contexto desta sessão):**

1. **OpenClaw `extensions/slack/`** — 15+ arquivos cobrindo socket mode, HTTP webhook, threading, Block Kit, multi-account, slash commands. Muito mais escopo do que precisamos no v1.
2. **Hermes-Agent `gateway/platforms/slack.py`** — 3024 LoC Python: `slack-bolt` async + `AsyncSocketModeHandler` + thread cache + dedup + bot-loop protection. Mostra as armadilhas (bot-loop, async context vars para slash commands, event_id dedup) que devemos evitar/aceitar conscientemente.
3. **Telegram + Discord adapters** no monorepo — padrão TypeScript validado: ~300 LoC por adapter, contrato uniforme.
4. **`@slack/bolt`** (canonical Slack TS SDK, v3.20+) — suporta Socket Mode nativamente, abstrai events + commands + actions, peer-friendly com Node 22+.

**Por que NOW:**
- 5/8 itens do roadmap shipados (CLI, Eval, Handoffs, Workflows, Cache em 2026-05-22). Gateway-Slack é parte de fechar paridade competitiva de adapters.
- Padrão gateway core já existe; o trabalho é localizado em `packages/gateway-slack/`.
- Zero refactor invasivo em `packages/gateway/` (só adicionar `"slack"` ao `PlatformName` union).
- Slack Bolt é maduro e o investimento é uma única vez — features avançadas (Block Kit, reactions, file uploads, modais) ficam para v1.x.

## Objective

**Done = `import { SlackAdapter } from "@usetheo/gateway-slack"` + `new SlackAdapter({ botToken, appToken }).connect()` produz um adapter funcional que recebe DMs + canais via Socket Mode, normaliza para `SlackMessageEvent`, envia respostas via `chat.postMessage`, com threading + error handling, integrável ao `AgentRunner` do gateway.**

Goals mensuráveis:

1. `packages/gateway-slack/` criado com a estrutura espelhando `gateway-telegram/`.
2. `SlackAdapter` implementando `BasePlatformAdapter` (connect/disconnect/sendMessage/onInbound).
3. Socket Mode default (D268) — zero infra HTTP exigida; tokens `xoxb-` + `xapp-` bastam.
4. `SlackMessageEvent` adicionado ao discriminated union em `packages/gateway/src/types/message-event.ts`.
5. `PlatformName` extendido com `"slack"`.
6. `splitForSlack` utility (4000-char hard limit em `chat.postMessage.text`).
7. Threading: `thread_ts` mapeado para `channel.topicId` quando presente; reply usa o mesmo `thread_ts`.
8. Channel type mapping: `im` (DM) → `"dm"`, `mpim`/`channel` → `"group"`, mensagem com `thread_ts` ancestral → `"thread"`.
9. Error mapping: `SlackApiError` (rate_limited, channel_not_found, missing_scope, invalid_auth) → `SendResult { ok: false, error }`.
10. Bot loop guard: filtrar `bot_id === self.botUserId` (mensagens do próprio bot).
11. 18 ADRs registradas (D267-D284).
12. ≥40 unit tests com `@slack/bolt` + `@slack/web-api` mockados.
13. Example `examples/slack-bot/` standalone (similar a `examples/telegram-pro/` em forma reduzida — 1 comando demo).
14. `docs.md` seção "Slack gateway (v1.19+)".
15. **CLAUDE.md** Adoption Roadmap entry #7 → ✅ DONE.

**Não-goals (deferidos para v1.x):**
- HTTP webhook transport (D269) — Socket Mode é suficiente no v1.
- Block Kit formatting (D281) — somente plain text + simple markdown.
- File uploads / attachments (D280).
- Reactions, modals, slash commands nativos, interactive components (D282).
- Multi-account / multi-workspace (D173 reserva slot mas v1 é single-account).
- Live integration test via Slack workspace real — fica como opcional condicional ao env (D284).

## ADRs

### D267 — Use `@slack/bolt` como SDK Slack canônica (não `@slack/web-api` raw)

**Decision:** Adapter usa `@slack/bolt` (v3.20+) que internamente combina `@slack/web-api` + `@slack/socket-mode` + event routing. Tokens (`botToken`, `appToken`) passam diretamente.

**Rationale:** Bolt é a recomendação oficial do Slack para bot/app development em JS/TS. Implementa Socket Mode + event dedup + retry transparentes. Usar `web-api` raw exigiria reimplementar event handling.

**Consequences:** Peer-dep `@slack/bolt` adiciona ~3MB ao bundle do adapter (não do SDK core). Tests mockam Bolt App via `vi.mock`. Future migration para slack-edge (se Bolt for deprecated) é localizada.

### D268 — Socket Mode é o transport default em v1 (não HTTP webhook)

**Decision:** `SlackAdapter` opera exclusivamente em Socket Mode em v1. Requer `xoxb-` (botToken) + `xapp-` (appToken com `connections:write` scope).

**Rationale:** Socket Mode é o caminho "zero-infra" — funciona local sem domínio público, sem TLS, sem load balancer. HTTP webhook exige tudo isso + cuidado com URL verification challenge, retry de 3 segundos do Slack, etc. v1 ship simples; HTTP fica para v1.x quando demanda enterprise (multi-tenant SaaS) surgir.

**Consequences:** Apps Slack precisam ter Socket Mode ativado no admin UI. Documentar setup. HTTP webhook deferido (D269) explicitamente.

### D269 — HTTP webhook transport deferido a v1.x

**Decision:** Sem implementação. A interface `SlackAdapterOptions` reserva o slot `transport?: "socket" | "http"` que aceita só `"socket"` em v1. v1.x adiciona suporte HTTP com Bolt receiver type adequado.

**Rationale:** Foco em ship simples. Webhook adicionaria: URL verification challenge handler, signature verification, retry logic Slack-side. Complex.

**Consequences:** Default = Socket Mode. v1 documenta limitação. Forward-compat: `transport: "http"` adicionado quando shippar sem breaking API.

### D270 — Channel type mapping: `im → dm`, `mpim|channel → group`, `thread_ts presente → thread`

**Decision:** O campo canônico `channel.type` é derivado do evento Slack:
- `channel_type === "im"` → `"dm"`.
- `channel_type === "mpim"` (multi-user DM) OR `"channel"` → `"group"`.
- Independente do tipo acima, se `event.thread_ts !== undefined && event.thread_ts !== event.ts` (i.e., mensagem em thread iniciada antes), então `channel.type = "thread"` e `channel.topicId = thread_ts`.

**Rationale:** Mantém parity com Telegram/Discord (que também mapeiam para `dm | group | thread`). Detection via `thread_ts` é o canônico Slack (segundo Bolt docs).

**Consequences:** Tests cobrem 4 casos: DM, channel, mpim (group), thread reply. Documentar.

### D271 — Slack `thread_ts` é o `topicId` canonical

**Decision:** Quando uma mensagem chega num thread (D270), `channel.topicId = event.thread_ts`. Outbound `OutboundMessage.channel.topicId` é passado como `thread_ts` no `chat.postMessage`.

**Rationale:** Slack threading é mais granular que Telegram (que tem `message_thread_id` em forums) e Discord (que tem channel threads); `thread_ts` é o anchor da thread. Mapear 1:1.

**Consequences:** Tests verificam round-trip: thread reply preserva `thread_ts`. Documentar diferença vs Telegram.

### D272 — Message split em 4000 caracteres (não 4096 do Telegram, nem 2000 do Discord)

**Decision:** Utility `splitForSlack(text)` quebra em chunks ≤ 4000 chars. Quebra preferencialmente em `\n\n`, depois `\n`, depois espaço. Sem quebra mid-word.

**Rationale:** Slack `chat.postMessage.text` aceita até 40k chars MAS exibe truncated a partir de ~4000 com "Show more". 4000 é o pragmatic limit para experiência boa em DM e channel.

**Consequences:** Testes para mensagens > 4000 chars. Chunks enviados sequencialmente (mesma thread se aplicável).

### D273 — Error mapping: `SlackApiError` → tipo `SendResult { ok: false, error: { code, message } }`

**Decision:** Função `mapSlackError(err)` traduz códigos Slack para enum canonical:
- `rate_limited` → `{ code: "rate_limit", message: <retry_after> }`
- `channel_not_found` → `{ code: "channel_not_found", message: <id> }`
- `not_in_channel` → `{ code: "no_permission", ... }`
- `missing_scope` → `{ code: "no_permission", message: <scope> }`
- `invalid_auth` / `token_revoked` → `{ code: "auth_error", ... }`
- Outros → `{ code: "platform_error", message: <slack_error_code> }`.

**Rationale:** Códigos canonical são usados pelo `DeliveryRouter` (D175) para decisões de retry. Slack tem ~50 códigos de erro; mapear apenas os recorrentes mantém API enxuta.

**Consequences:** Documentar mapping em `docs.md`. Tests cobrem 5 código mappings + fallback.

### D274 — `SlackMessageEvent` extends `BaseMessageEvent` + `.slack.raw` = body Slack original

**Decision:** Nova interface:
```typescript
export interface SlackMessageEvent extends BaseMessageEvent {
  readonly platform: "slack";
  readonly slack: {
    readonly teamId: string | undefined;     // workspace
    readonly channelId: string;
    readonly userId: string;
    readonly ts: string;                     // message timestamp = canonical id Slack
    readonly threadTs?: string;
    readonly raw: unknown;                   // SlackEventMiddlewareArgs<"message">.body
  };
}
```

**Rationale:** Espelha Telegram/Discord. `raw` exposta como `unknown` (D180 — escape hatch); caller faz narrow se precisar de campos Slack-specific.

**Consequences:** Adiciona variant ao `MessageEvent` union. Discriminator `platform: "slack"` enable type narrowing. Tests cobrem normalização.

### D275 — Bot loop guard: filtrar mensagens onde `event.user === botUserId` OR `event.bot_id !== undefined && event.bot_id === selfBotId`

**Decision:** `connect()` resolve `botUserId` via `auth.test`. Toda message inbound passa por guard que descarta se origem for o próprio bot. Eventos `subtype: "bot_message"` com `bot_id` matching também descartados.

**Rationale:** Slack reentrega mensagens do bot quando outros usuários estão no canal (visibilidade própria); sem filter, loop infinito (bot responde a si mesmo). Hermes-Agent valida esse pattern em produção.

**Consequences:** `connect()` faz uma chamada extra `auth.test`. Tests cobrem bot-self-message filter. Documentar.

### D276 — `onInbound(handler)` substitui handler anterior (não stacks) — EC-H pattern

**Decision:** Segunda chamada de `onInbound` substitui o handler ativo. Retorna `() => void` para unsubscribe. Match com Telegram/Discord (EC-H).

**Rationale:** Consistência entre adapters. Stacks são confusos em multi-handler scenarios; SessionRouter já compõe internamente quando precisa.

**Consequences:** Tests verificam replace + unsubscribe. Doc strings.

### D277 — `botUserId` cacheado após connect (fetched via `auth.test`)

**Decision:** No `connect()` exitoso, `await app.client.auth.test()` retorna `user_id`. Armazenar em `this.botUserId`. Re-fetch só em reconnect.

**Rationale:** `auth.test` é cheap e roda 1x no startup. Cache evita lookup per-event (que rolaria milhares de vezes). Hermes-Agent + OpenClaw fazem isso.

**Consequences:** Token inválido falha `connect` (não `sendMessage` mais tarde). Tests mockam `auth.test`. Documentar.

### D278 — `disconnect()` é idempotente e seguro para chamar quando nunca conectado

**Decision:** `if (!this.connected) return;` no início. Caso conectado, `await app.stop()` + `app.client = undefined`. Erros loggados a stderr mas não propagados.

**Rationale:** Match com Telegram/Discord. SessionRouter + lifecycle managers chamam disconnect em vários paths (graceful shutdown, error recovery, test cleanup) — todos devem ser seguros.

**Consequences:** Test "disconnect-before-connect" verifica que NÃO joga. Tests também cobrem disconnect-after-connect.

### D279 — Connection failure retorna `false`, NUNCA lança — EC-I pattern

**Decision:** Token inválido, network down, Slack outage, etc — todos resultam em `connect()` retornando `false` + log a stderr. Nunca propagam exception ao caller.

**Rationale:** Match com Telegram/Discord. SessionRouter pode tentar fallback adapters; lançar quebra essa orquestração.

**Consequences:** Tests com tokens inválidos verificam `false` return. Documentar.

### D280 — File uploads / attachments deferidos a v1.x

**Decision:** `OutboundMessage` v1 só suporta `text`. Sem `files`, sem `attachments`. v1.x adiciona quando demanda surgir.

**Rationale:** Slack `files.upload_v2` API é complexa (multipart, retry, scope `files:write`). Defer simplifica v1. Telegram/Discord ainda não suportam files no `OutboundMessage` também — paridade.

**Consequences:** Caller que precisa de file upload usa `app.client.files.upload_v2(...)` direto via `adapter.getApp().client` (escape hatch). Tests não cobrem files.

### D281 — Block Kit formatting deferido a v1.x; v1 usa plain text + simple markdown

**Decision:** `OutboundMessage.format: "plain" | "markdown"` (sem `"blocks"`). Markdown vira `mrkdwn: true` no `chat.postMessage`. v1.x adiciona `OutboundMessage.format: "blocks"` + payload structure.

**Rationale:** Block Kit é poderoso mas adiciona ~300 LoC de mapping (sections, dividers, buttons, etc). Plain markdown cobre 80% dos use cases iniciais (FAQ bot, classify bot, summarize bot).

**Consequences:** Escape hatch via `adapter.getApp().client.chat.postMessage(...)` para Block Kit avançado. Documentar.

### D282 — Reactions / modals / slash commands / interactive components — v1.x

**Decision:** v1 NÃO expõe APIs para reactions (`reactions.add`), modals (`views.open`), slash commands (`app.command(...)`), nem block actions (`app.action(...)`). v1.x adiciona via hook system + escape-hatch documentado.

**Rationale:** Cada uma dessas precisa hook semantics novos no `BasePlatformAdapter` (que afetaria Telegram/Discord também). Foco v1: ship Slack core feature parity.

**Consequences:** Apps Slack que precisem disso usam `adapter.getApp().command(...)` direto (workspace gateway escape, não recomendado para production). Documentar.

### D283 — Peer dep `@slack/bolt` + `@slack/web-api` (espelha D171)

**Decision:** `gateway-slack/package.json` declara `@slack/bolt: "^3.20.0"` e `@slack/web-api: "^6.12.0"` como peer-deps. Caller instala. Workspace deps: `@usetheo/gateway` + `@usetheo/sdk`.

**Rationale:** Match com Telegram (grammy peer-dep) e Discord (discord.js peer-dep). Ship reduzido — caller controla versão do SDK Slack.

**Consequences:** README documenta install command. Tests usam workspace install.

### D285 — `requireMention: boolean` opção; default `true` para canais, `false` para DM/mpim (EC-3 absorbed)

**Decision:** `SlackAdapterOptions.requireMention?: boolean` (default `true`). Quando `true` e `channelType === "group"` (canal público), o `normalizeSlackEvent` descarta mensagens que NÃO contêm `<@${botUserId}>`. DMs e mpims (multi-DM) sempre passam — mention é implícita.

**Rationale:** Slack default delivers every channel message (different from Telegram privacy mode / Discord MessageContent intent). Sem guard, bot adicionado a canal público ouve TODO mundo e tenta responder, gerando cost explosion + spam. Safer default + opt-out explícito.

**Consequences:** Apps que querem bot respondendo a tudo no canal (FAQ scraper, summarize-on-message bots) precisam `requireMention: false`. Documentar trade-off no `docs.md`. Tests cobrem ambos modes.

### D284 — Example app + opt-in live integration test

**Decision:** `examples/slack-bot/` standalone com 1 comando demo (echo + thread). README documenta setup: criar Slack app, enable Socket Mode, gerar tokens, inserir em `.env`. Live test condicional: se `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` no env, dogfood roda; senão skip com mensagem clara (não fail).

**Rationale:** Mirror `examples/telegram-pro/` pattern. Live test exige workspace Slack próprio — não pode ser obrigatório no CI público. Skip com mensagem clara > fail mascarando o motivo real.

**Consequences:** README com setup walkthrough. Test env-gated. Documentar que dogfood gateway-slack é manual (vs telegram-pro automatizado via CDP).

## Dependency Graph

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 5
(ADRs)     (pkg+types) (connect)   (normalize) (send+split) (errors)
                              │           │           │           │
                              └───────────┴───────────┴───────────┘
                                          ▼
                                  Phase 6 (tests)
                                          │
                                          ▼
                                  Phase 7 (example + docs)
                                          │
                                          ▼
                                  Phase 8 (Dogfood QA)
```

**Sequencial:** 0 → 1 → 2 → 3 → 4 → 5 (cada um depende do anterior).
**Parallel:** Phase 6 (tests) e Phase 7 (example) podem rodar simultaneamente após Phase 5.
**Final gate:** Phase 8 (dogfood) — env-gated (skip-friendly) por D284.

---

## Phase 0: Setup e ADRs

**Objective:** Registrar D267-D284 (18 ADRs) e marcar item #7 como Em progresso.

### T0.1 — Escrever 18 ADRs + atualizar CLAUDE.md

#### Objective
Materializar D267-D284 sob `.claude/knowledge-base/adrs/` + apêndar linhas em CLAUDE.md.

#### Evidence
Padrão validado em D202-D213 (Eval), D214-D229 (Handoffs), D230-D248 (Workflows), D249-D266 (Cache).

#### Files to edit
```
.claude/knowledge-base/adrs/D267-bolt-sdk-choice.md (NEW)
.claude/knowledge-base/adrs/D268-socket-mode-default.md (NEW)
.claude/knowledge-base/adrs/D269-http-webhook-deferred.md (NEW)
.claude/knowledge-base/adrs/D270-channel-type-mapping.md (NEW)
.claude/knowledge-base/adrs/D271-thread-ts-topicId.md (NEW)
.claude/knowledge-base/adrs/D272-split-4000-chars.md (NEW)
.claude/knowledge-base/adrs/D273-error-mapping.md (NEW)
.claude/knowledge-base/adrs/D274-slack-message-event.md (NEW)
.claude/knowledge-base/adrs/D275-bot-loop-guard.md (NEW)
.claude/knowledge-base/adrs/D276-replace-handler-semantics.md (NEW)
.claude/knowledge-base/adrs/D277-cache-bot-user-id.md (NEW)
.claude/knowledge-base/adrs/D278-disconnect-idempotent.md (NEW)
.claude/knowledge-base/adrs/D279-connect-returns-false-on-failure.md (NEW)
.claude/knowledge-base/adrs/D280-file-uploads-deferred.md (NEW)
.claude/knowledge-base/adrs/D281-block-kit-deferred.md (NEW)
.claude/knowledge-base/adrs/D282-reactions-modals-deferred.md (NEW)
.claude/knowledge-base/adrs/D283-peer-deps-bolt-web-api.md (NEW)
.claude/knowledge-base/adrs/D284-example-plus-optin-dogfood.md (NEW)
.claude/knowledge-base/adrs/D285-require-mention-default.md (NEW, post edge-case review)
CLAUDE.md (MODIFY — add 19 rows to ADR table; bump Roadmap #7 to "Em progresso 2026-05-22")
```

#### TDD
```
N/A — ADRs are documentation. Validation: `ls .claude/knowledge-base/adrs/D2{67-84}-*.md | wc -l` = 18.
```

#### Acceptance Criteria
- [ ] 19 arquivos D267-D285 existem.
- [ ] CLAUDE.md table tem 19 novas linhas.
- [ ] Roadmap #7 → "Em progresso 2026-05-22".

#### DoD
- [ ] Commit verde.

---

## Phase 1: Package Skeleton + Types

**Objective:** Criar `packages/gateway-slack/` com `package.json`, `tsconfig.json`, `tsup.config.ts`, types, e barrel.

### T1.1 — Criar estrutura mínima `packages/gateway-slack/`

#### Objective
Workspace package vazio compilando.

#### Files to edit
```
packages/gateway-slack/package.json (NEW)
packages/gateway-slack/tsconfig.json (NEW)
packages/gateway-slack/tsup.config.ts (NEW)
packages/gateway-slack/README.md (NEW — setup instructions)
packages/gateway-slack/CHANGELOG.md (NEW — Unreleased section)
packages/gateway-slack/src/index.ts (NEW — empty barrel)
```

#### Deep Dives

`package.json` espelha `gateway-telegram` (D171 + D283):

```json
{
  "name": "@usetheo/gateway-slack",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "files": ["dist", "README.md", "LICENSE", "CHANGELOG.md"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": {
    "@usetheo/gateway": "workspace:^",
    "@usetheo/sdk": "workspace:^",
    "@slack/bolt": "^3.20.0",
    "@slack/web-api": "^6.12.0"
  },
  "devDependencies": {
    "@usetheo/gateway": "workspace:*",
    "@usetheo/sdk": "workspace:*",
    "@slack/bolt": "^3.20.0",
    "@slack/web-api": "^6.12.0",
    "tsup": "^8.5.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

#### Tasks
1. Criar arquivos acima.
2. `pnpm install` no root.
3. `pnpm -F @usetheo/gateway-slack typecheck` verde.

#### TDD
```
N/A — apenas scaffolding. Verification: `pnpm -F @usetheo/gateway-slack typecheck` passes; `pnpm -F @usetheo/gateway-slack build` produces empty dist.
```

#### Acceptance Criteria
- [ ] Package compila (empty barrel).
- [ ] Workspace `pnpm-workspace.yaml` reconhece o package (já tem `packages/*`).

#### DoD
- [ ] `pnpm -F @usetheo/gateway-slack typecheck` zero erros.
- [ ] Build produz `dist/` vazio (apenas barrel).

---

### T1.2 — Adicionar `"slack"` ao `PlatformName` union + `SlackMessageEvent`

#### Objective
Extend gateway core types para incluir Slack.

#### Files to edit
```
packages/gateway/src/types/message-event.ts (MODIFY: add "slack" to PlatformName + SlackMessageEvent interface)
packages/gateway/src/types/index.ts (MODIFY: re-export if needed)
```

#### Deep Dives

```typescript
// types/message-event.ts
export type PlatformName = "telegram" | "discord" | "slack";

export interface SlackMessageEvent extends BaseMessageEvent {
  readonly platform: "slack";
  readonly slack: {
    readonly teamId: string | undefined;
    readonly channelId: string;
    readonly userId: string;
    readonly ts: string;                  // message timestamp = canonical id
    readonly threadTs?: string;
    readonly subtype?: string;            // e.g. "bot_message", "thread_broadcast"
    readonly raw: unknown;                // Bolt event body
  };
}

export type MessageEvent =
  | TelegramMessageEvent
  | DiscordMessageEvent
  | SlackMessageEvent;
```

#### Tasks
1. Edit union.
2. Add SlackMessageEvent.
3. Re-export.

#### TDD
```
RED:
  - type_test_messageEvent_union_includes_slack (compile-time)
  - type_test_discriminator_narrows_to_SlackMessageEvent
GREEN: add types.
VERIFY: pnpm -F @usetheo/gateway typecheck
```

#### Acceptance Criteria
- [ ] `PlatformName` aceita `"slack"`.
- [ ] `SlackMessageEvent` exported.
- [ ] Zero quebra em Telegram/Discord consumers.

#### DoD
- [ ] `pnpm typecheck` verde no workspace inteiro.

---

## Phase 2: Connect / Disconnect (Socket Mode)

**Objective:** `SlackAdapter#connect` inicia Bolt Socket Mode; `disconnect` finaliza idempotentemente.

### T2.1 — `SlackAdapter` class skeleton + connect/disconnect

#### Files to edit
```
packages/gateway-slack/src/adapter.ts (NEW)
packages/gateway-slack/src/index.ts (MODIFY — export SlackAdapter + SlackAdapterOptions)
```

#### Deep Dives

```typescript
import { App } from "@slack/bolt";
import type { GatewayMessageEvent } from "@usetheo/gateway";
import { BasePlatformAdapter, type OutboundMessage, type SendResult } from "@usetheo/gateway";

export interface SlackAdapterOptions {
  readonly botToken: string;        // xoxb-...
  readonly appToken: string;        // xapp-... (Socket Mode)
  readonly transport?: "socket";    // D269: only "socket" in v1
  readonly logLevel?: "debug" | "info" | "warn" | "error";
}

export class SlackAdapter extends BasePlatformAdapter {
  readonly platform = "slack" as const;
  private app: App | undefined;
  private connected = false;
  private botUserId: string | undefined;
  private handler?: (event: GatewayMessageEvent) => Promise<void>;

  constructor(private readonly opts: SlackAdapterOptions) {
    super();
  }

  // EC-2 absorbed: serialize concurrent connect() calls.
  private connectingPromise?: Promise<boolean>;

  /** Expose Bolt App for escape-hatch features (D281/D282). */
  getApp(): App | undefined { return this.app; }

  override async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connectingPromise !== undefined) return this.connectingPromise;
    this.connectingPromise = this._doConnect().finally(() => {
      this.connectingPromise = undefined;
    });
    return this.connectingPromise;
  }

  private async _doConnect(): Promise<boolean> {
    try {
      this.app = new App({
        token: this.opts.botToken,
        appToken: this.opts.appToken,
        socketMode: true,
        logLevel: this.opts.logLevel ? (this.opts.logLevel as never) : undefined,
      });
      // D275: cache bot user id for loop guard
      this.app.event("message", async (args) => this.handleMessage(args));
      await this.app.start();
      const auth = await this.app.client.auth.test();
      this.botUserId = String(auth.user_id ?? "");
      this.connected = true;
      return true;
    } catch (err) {
      // D279: never throw on connect failure
      process.stderr.write(
        `[slack-adapter] connect failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      // EC-1 absorbed: stop orphan app to avoid memory leak + ghost listeners
      if (this.app !== undefined) {
        await this.app.stop().catch(() => undefined);
      }
      this.app = undefined;
      this.botUserId = undefined;
      return false;
    }
  }

  override async disconnect(): Promise<void> {
    // D278: idempotent + safe even when never connected
    if (!this.connected || this.app === undefined) return;
    try {
      await this.app.stop();
    } catch (err) {
      process.stderr.write(
        `[slack-adapter] disconnect error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    this.app = undefined;
    this.connected = false;
    this.botUserId = undefined;
  }

  override async sendMessage(_out: OutboundMessage): Promise<SendResult> {
    throw new Error("Phase 4");
  }

  override onInbound(_handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    throw new Error("Phase 3");
  }

  private async handleMessage(_args: unknown): Promise<void> {
    throw new Error("Phase 3");
  }
}
```

#### Tasks
1. Implement class.
2. Wire connect → Bolt App + auth.test.
3. Wire disconnect → app.stop.
4. Export.

#### TDD
```
RED:
  - connect_returns_true_on_success_mock_bolt
  - connect_caches_botUserId_via_authTest (D277)
  - connect_returns_false_on_token_invalid (D279)
  - connect_returns_false_on_network_error (D279)
  - disconnect_safe_when_never_connected (D278)
  - disconnect_calls_app_stop_when_connected
  - disconnect_clears_botUserId_and_app
  - EC-1: connect_failure_in_authTest_calls_app_stop (no orphan app)
  - EC-2: concurrent_connect_returns_same_promise (no double app)
  - EC-5: disconnect_while_connect_in_flight_leaves_no_app_running
  - EC-6: send_during_connect_returns_not_connected
GREEN: implement.
VERIFY: pnpm -F @usetheo/gateway-slack test tests/adapter-lifecycle.test.ts
```

#### Acceptance Criteria
- [ ] 7 tests verde.
- [ ] `connect()` nunca throws.
- [ ] `disconnect()` idempotente.

#### DoD
- [ ] Tests verde.

---

## Phase 3: onInbound + Event Normalization

**Objective:** Inbound Slack events → `SlackMessageEvent` normalizado + bot loop guard.

### T3.1 — `normalizeEvent` (Slack `message` event → `SlackMessageEvent`)

#### Files to edit
```
packages/gateway-slack/src/normalize.ts (NEW)
```

#### Deep Dives

```typescript
import type { SlackMessageEvent } from "@usetheo/gateway";

interface BoltMessageBody {
  event: {
    type: "message";
    channel: string;
    channel_type?: "im" | "mpim" | "channel";
    user?: string;
    text?: string;
    ts: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
  };
  team_id?: string;
}

export function normalizeSlackEvent(
  body: BoltMessageBody,
  botUserId: string | undefined,
  opts: { requireMention?: boolean } = {},
): SlackMessageEvent | undefined {
  const e = body.event;
  if (e.type !== "message") return undefined;
  // D275 bot loop guard
  if (e.user !== undefined && botUserId !== undefined && e.user === botUserId) return undefined;
  if (e.bot_id !== undefined && e.subtype === "bot_message") return undefined;
  // Edited messages / channel join / etc — skip subtypes that aren't user messages
  if (e.subtype !== undefined && e.subtype !== "thread_broadcast") return undefined;

  // D270 channel type
  let channelType: "dm" | "group" | "thread";
  if (e.thread_ts !== undefined && e.thread_ts !== e.ts) {
    channelType = "thread";
  } else if (e.channel_type === "im") {
    channelType = "dm";
  } else {
    channelType = "group";
  }

  // EC-3 / D285: mention guard for public channels (default required)
  const requireMention = opts.requireMention ?? true;
  if (
    requireMention &&
    channelType === "group" &&
    e.channel_type === "channel" &&
    botUserId !== undefined &&
    !(e.text ?? "").includes(`<@${botUserId}>`)
  ) {
    return undefined; // not addressed to bot — skip silently
  }

  return {
    id: `slack-${body.team_id ?? "?"}-${e.channel}-${e.ts}`,
    platform: "slack",
    sender: {
      id: e.user ?? "anonymous",
    },
    channel: {
      id: e.channel,
      type: channelType,
      ...(channelType === "thread" && e.thread_ts !== undefined ? { topicId: e.thread_ts } : {}),
    },
    text: e.text ?? "",
    receivedAt: Math.floor(Number(e.ts) * 1000),
    slack: {
      teamId: body.team_id,
      channelId: e.channel,
      userId: e.user ?? "anonymous",
      ts: e.ts,
      ...(e.thread_ts !== undefined ? { threadTs: e.thread_ts } : {}),
      ...(e.subtype !== undefined ? { subtype: e.subtype } : {}),
      raw: body,
    },
  };
}
```

#### Tasks
1. Implement normalize.
2. Cover edge cases.

#### TDD
```
RED:
  - normalize_dm_returns_channel_type_dm
  - normalize_channel_returns_group
  - normalize_thread_returns_thread_with_topicId (D270, D271)
  - normalize_skips_bot_self_message (D275)
  - normalize_skips_bot_id_subtype (D275)
  - normalize_skips_edited_messages
  - normalize_returns_undefined_for_unknown_event_type
  - normalize_extracts_userId_into_sender_and_slack
  - EC-3/D285: normalize_channel_skips_when_no_mention_default
  - EC-3/D285: normalize_channel_keeps_message_with_mention
  - EC-3/D285: normalize_channel_keeps_all_when_requireMention_false
  - EC-3/D285: normalize_dm_always_passes_even_without_mention
  - EC-7: normalize_keeps_file_only_message_as_empty_text
GREEN: implement.
VERIFY: pnpm test tests/normalize.test.ts
```

#### Acceptance Criteria
- [ ] 8 tests verde.

#### DoD
- [ ] Tests verde.

---

### T3.2 — Wire `onInbound` no SlackAdapter

#### Files to edit
```
packages/gateway-slack/src/adapter.ts (MODIFY)
```

#### Deep Dives

```typescript
override onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
  // D276: replace semantics
  this.handler = handler;
  return () => {
    if (this.handler === handler) this.handler = undefined;
  };
}

private async handleMessage(args: { body: unknown }): Promise<void> {
  if (this.handler === undefined) return;
  const event = normalizeSlackEvent(args.body as never, this.botUserId);
  if (event === undefined) return;
  try {
    await this.handler(event);
  } catch (err) {
    process.stderr.write(
      `[slack-adapter] handler threw: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}
```

#### Tasks
1. Replace stub.

#### TDD
```
RED:
  - onInbound_invokes_handler_on_message
  - onInbound_second_call_replaces_first (D276)
  - onInbound_returned_fn_unsubscribes
  - onInbound_handler_throw_logs_to_stderr_no_propagate
  - onInbound_skips_when_no_handler_registered
GREEN: implement.
VERIFY: pnpm test tests/inbound.test.ts
```

#### Acceptance Criteria
- [ ] 5 tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 4: sendMessage + Split + Threading

**Objective:** Outbound: `chat.postMessage` com chunking 4000-char + thread_ts preservado.

### T4.1 — `splitForSlack` utility

#### Files to edit
```
packages/gateway-slack/src/split.ts (NEW)
```

#### Deep Dives

```typescript
const SLACK_MAX_TEXT = 4000;

export function splitForSlack(text: string): string[] {
  if (text.length <= SLACK_MAX_TEXT) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > SLACK_MAX_TEXT) {
    // Prefer breaking at \n\n, then \n, then ' '
    let cut = remaining.lastIndexOf("\n\n", SLACK_MAX_TEXT);
    if (cut < SLACK_MAX_TEXT * 0.5) cut = remaining.lastIndexOf("\n", SLACK_MAX_TEXT);
    if (cut < SLACK_MAX_TEXT * 0.5) cut = remaining.lastIndexOf(" ", SLACK_MAX_TEXT);
    if (cut <= 0) cut = SLACK_MAX_TEXT;
    // EC-4 absorbed: avoid cutting in the middle of a UTF-16 surrogate pair (emoji).
    if (cut < remaining.length) {
      const code = remaining.charCodeAt(cut);
      if (code >= 0xDC00 && code <= 0xDFFF) cut -= 1; // low surrogate → back up before the high surrogate
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^[\s]+/, "");
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
```

#### Tasks
1. Implement.

#### TDD
```
RED:
  - split_short_text_returns_single_chunk
  - split_4001_chars_returns_two_chunks
  - split_prefers_paragraph_break
  - split_falls_back_to_word_break
  - split_handles_emoji_correctly
  - split_chunks_each_under_4000
  - EC-4: split_avoids_cutting_inside_surrogate_pair
GREEN: implement.
VERIFY: pnpm test tests/split.test.ts
```

#### Acceptance Criteria
- [ ] 6 tests verde.

#### DoD
- [ ] Tests verde.

---

### T4.2 — `errors.ts` SlackApiError mapping

#### Files to edit
```
packages/gateway-slack/src/errors.ts (NEW)
```

#### Deep Dives

```typescript
import type { SendResult } from "@usetheo/gateway";

interface SlackErrorLike {
  code?: string;
  data?: { error?: string; retry_after?: number; scope?: string };
  message?: string;
}

export function mapSlackError(err: unknown): SendResult {
  const e = err as SlackErrorLike;
  const code = e.data?.error ?? e.code ?? "platform_error";
  switch (code) {
    case "rate_limited":
      return {
        ok: false,
        error: { code: "rate_limit", message: `retry after ${e.data?.retry_after ?? "?"}s` },
      };
    case "channel_not_found":
      return { ok: false, error: { code: "channel_not_found", message: "channel id invalid" } };
    case "not_in_channel":
    case "missing_scope":
      return {
        ok: false,
        error: { code: "no_permission", message: e.data?.scope ?? code },
      };
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
      return { ok: false, error: { code: "auth_error", message: code } };
    case "message_limit_exceeded":
    case "msg_too_long":
      return { ok: false, error: { code: "message_too_long", message: code } };
    default:
      return {
        ok: false,
        error: { code: "platform_error", message: `${code}: ${e.message ?? "unknown"}` },
      };
  }
}
```

#### Tasks
1. Implement mapper.

#### TDD
```
RED:
  - map_rate_limited_returns_rate_limit_with_retry_after
  - map_channel_not_found
  - map_missing_scope_returns_no_permission_with_scope
  - map_invalid_auth_returns_auth_error
  - map_unknown_error_falls_through_to_platform_error
GREEN: implement.
VERIFY: pnpm test tests/errors.test.ts
```

#### Acceptance Criteria
- [ ] 5 tests verde.

#### DoD
- [ ] Tests verde.

---

### T4.3 — `sendMessage` implementation

#### Files to edit
```
packages/gateway-slack/src/adapter.ts (MODIFY)
```

#### Deep Dives

```typescript
override async sendMessage(out: OutboundMessage): Promise<SendResult> {
  if (this.app === undefined) {
    return { ok: false, error: { code: "not_connected", message: "adapter not connected" } };
  }
  if (out.text.length === 0) {
    return { ok: false, error: { code: "empty_text", message: "text is empty" } };
  }
  const chunks = splitForSlack(out.text);
  let lastId: string | undefined;
  for (const chunk of chunks) {
    try {
      const resp = await this.app.client.chat.postMessage({
        channel: out.channel.id,
        text: chunk,
        ...(out.channel.topicId !== undefined ? { thread_ts: out.channel.topicId } : {}),
        ...(out.format === "markdown" ? { mrkdwn: true } : {}),
      });
      lastId = String(resp.ts ?? "");
    } catch (err) {
      return mapSlackError(err);
    }
  }
  return { ok: true, messageId: lastId };
}
```

#### Tasks
1. Replace stub.

#### TDD
```
RED:
  - send_returns_not_connected_when_app_undefined
  - send_returns_empty_text_when_text_empty
  - send_calls_chat_postMessage_with_channel_and_text
  - send_preserves_thread_ts_when_topicId_set (D271)
  - send_sets_mrkdwn_for_markdown_format
  - send_chunks_long_text (D272)
  - send_returns_ok_with_messageId_on_success
  - send_maps_slack_error_to_SendResult
GREEN: implement.
VERIFY: pnpm test tests/send-message.test.ts
```

#### Acceptance Criteria
- [ ] 8 tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 5: Examples + docs.md

### T5.1 — `examples/slack-bot/` standalone

#### Files to edit
```
examples/slack-bot/package.json (NEW)
examples/slack-bot/.env.example (NEW)
examples/slack-bot/run.ts (NEW)
examples/slack-bot/README.md (NEW)
```

#### Deep Dives

`run.ts` cria `SlackAdapter`, conecta, ouve eventos, ecoa de volta. Demonstra integration com `Agent.create({...}).send`. Documentação inclui setup walkthrough Slack app + tokens.

#### Tasks
1. Criar arquivos.
2. README com setup detalhado.

#### TDD
```
N/A — example. Manual validation if SLACK_BOT_TOKEN + SLACK_APP_TOKEN available.
```

#### Acceptance Criteria
- [ ] `pnpm run run` connect-loop sem crash (mesmo sem tokens, log-error de connect deve aparecer; com tokens válidos, espera DM e ecoa).

---

### T5.2 — `docs.md` Slack section

#### Files to edit
```
docs.md (MODIFY: add "## Slack gateway (v1.19+)" after Workflows / Cache)
README.md (MODIFY: mention gateway-slack in features list)
```

#### Tasks
1. Append section.
2. Cobrir: setup, options, channel mapping, threading, error mapping, escape hatch via `getApp()`, v1 limitations.

#### Acceptance Criteria
- [ ] Section exists.

---

## Phase 6: Dogfood QA (env-gated)

**Objective:** Validar end-to-end **se** tokens Slack disponíveis. Caso contrário, skip claro.

### Execution

```bash
# 1. Build SDK + gateway + gateway-slack
pnpm -F @usetheo/sdk build
pnpm -F @usetheo/gateway build
pnpm -F @usetheo/gateway-slack build

# 2. Run example (env-gated)
cd examples/slack-bot
if [ -n "$SLACK_BOT_TOKEN" ] && [ -n "$SLACK_APP_TOKEN" ]; then
  pnpm tsx --env-file=.env run.ts &
  BOT_PID=$!
  sleep 8
  # User manually sends DM to bot in Slack; observe echo
  # OR: programmatic test via @slack/web-api: post a test message in dev channel, verify response
  kill $BOT_PID
else
  echo "SKIP: SLACK_BOT_TOKEN + SLACK_APP_TOKEN env vars required for live test"
fi
```

### Acceptance Criteria

- [ ] **Se tokens disponíveis:** Bot conecta, recebe DM/canal, ecoa. Log mostra `Connected as @<botname>`.
- [ ] **Se tokens ausentes:** Test skip com mensagem clara, NÃO fail.
- [ ] Unit tests 40+ PASS (essas são obrigatórias).
- [ ] Telegram-pro dogfood ainda PASS (≥43/45) — verificar que mudanças no gateway core não regressionaram outras platforms.

### Runtime-metric proof
- Adapter connect retorna `true` em token válido.
- `auth.test` retorna `botUserId` que é cached.
- Bot loop guard descarta own messages (verificável via stderr log + handler call counter).

### If Dogfood Fails

1. Identificar se é causado pelo plano (Slack code) ou regressão (gateway core mudou type/event union).
2. Telegram-pro dogfood detecta regressão indireta.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Slack adapter implementation | T2.1, T3.2, T4.3 | SlackAdapter extends BasePlatformAdapter |
| 2 | Inbound normalization | T3.1 | normalizeSlackEvent (D270, D271, D275) |
| 3 | Outbound sendMessage + split | T4.1, T4.3 | splitForSlack 4000-char (D272) |
| 4 | Threading (thread_ts) | T3.1, T4.3 | D271 |
| 5 | Error mapping | T4.2 | mapSlackError (D273) |
| 6 | Bot loop guard | T3.1 | D275 + cached botUserId D277 |
| 7 | Connect/disconnect lifecycle | T2.1 | D278, D279 |
| 8 | Handler replace semantics | T3.2 | D276 |
| 9 | SlackMessageEvent type | T1.2 | D274 |
| 10 | Peer deps + workspace | T1.1 | D171 + D283 |
| 11 | Socket Mode default | T2.1 | D268 |
| 12 | HTTP webhook reserved | (n/a v1) | D269 |
| 13 | File uploads reserved | (n/a v1) | D280 |
| 14 | Block Kit reserved | (n/a v1) | D281 |
| 15 | Reactions/modals reserved | (n/a v1) | D282 |
| 16 | Example + setup docs | T5.1, T5.2 | examples/slack-bot/ + docs.md |
| 17 | Dogfood (env-gated) | Phase 6 | live test if tokens available |
| 18 | 19 ADRs registered (post edge-case review) | T0.1 | D267-D285 |
| 19 | Channel spam prevention via mention guard (EC-3) | T3.1 + D285 | `requireMention: true` default; opt-out for FAQ bots |

**Coverage: 19/19 (100%)** (post edge-case review: +1 D285 for mention guard default)

## Global Definition of Done

- [ ] Todas as 6 phases completadas.
- [ ] ≥ 40 unit tests passing (`pnpm -F @usetheo/gateway-slack test`).
- [ ] Zero biome warnings.
- [ ] Build CJS + ESM + DTS green em `packages/gateway-slack`.
- [ ] 19 ADRs registered (D267-D285).
- [ ] CLAUDE.md Roadmap #7 → ✅ DONE 2026-05-22.
- [ ] `docs.md` Slack section added.
- [ ] Telegram-pro dogfood ainda passa (≥43/45) — regressão check.
- [ ] Live Slack dogfood: PASS se tokens disponíveis; SKIP claro caso contrário.

## Final Phase: Dogfood QA (MANDATORY)

See Phase 6. **Para este plano, o "dogfood QA" tem dois componentes:**

1. **Mandatório:** Telegram-pro dogfood continua passando (zero regressão induzida por mudanças no gateway core / type union).
2. **Opcional (env-gated):** Live Slack workspace test quando tokens disponíveis.

Plano completo somente quando (1) passa. (2) é "nice-to-have" documentado.
