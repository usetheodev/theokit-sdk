# Plan: Gateway Tier 1 Expansion — SMS + Mattermost + LINE + Matrix

> **Version 1.0** — Adicionar 4 novos workspace packages `@usetheo/gateway-{sms,mattermost,line,matrix}` seguindo o pattern D170-D181 já estabelecido (peer-dep packages, `BasePlatformAdapter`, `MessageEvent` variant). Saímos de **6 gateways oficiais (telegram/discord/slack/teams/email/whatsapp)** para **10**, fechando os gaps de mercado endereçável: vertical telecom (SMS), self-hosted enterprise (Mattermost), APAC consumer (LINE), e open-source federation (Matrix). Cada gateway entrega: package + 60-90 unit tests + example app + live smoke env-gated + concept page em `theo-opendocs`. v1.5 oficial completa quando os 4 estão verdes na dogfood.

## Context

### O que existe hoje

6 gateways oficiais shipados como packages peer-dep separados (D170-D181):

| Pacote | ADRs | Status |
|---|---|---|
| `@usetheo/gateway-telegram` | D170-D181 | Production (telegram-pro é o canary) |
| `@usetheo/gateway-discord` | D179 | Production |
| `@usetheo/gateway-slack` | D267-D285 | Production (Socket Mode, env-gated smoke) |
| `@usetheo/gateway-teams` | D315-D326 | Production (@microsoft/teams.apps v2) |
| `@usetheo/gateway-email` | D327-D339 | Production (IMAP IDLE + SMTP, threading) |
| `@usetheo/gateway-whatsapp` | D303-D314 | Production (multi-backend Cloud+Web) |

`packages/gateway/src/` (`@usetheo/gateway` core) expõe:
- `BasePlatformAdapter` (abstract) — `packages/gateway/src/adapter/base.ts`
- `MessageEvent` discriminated union — `packages/gateway/src/types/message-event.ts` (atual `PlatformName = "telegram" | "discord" | "slack" | "whatsapp" | "teams" | "email"`)
- `GatewayRunner` — `packages/gateway/src/runner/gateway-runner.ts` (handler dispatch + hooks)
- `SessionRouter` (D174 — compõe `Agent.resume`)
- `DeliveryRouter` (D175 — compõe `Cron`)
- Hook contract `{ block: true, message? }` (D176-D177)

### O que falta — evidência da análise SDK vs OpenClaw/Hermes

Auditoria 2026-05-28 contra `referencia/openclaw/` e `referencia/hermes-agent/` identificou que ambos cobrem plataformas que nós não cobrimos:

| Plataforma | OpenClaw | Hermes | Mercado real | Gap nosso |
|---|---|---|---|---|
| **Matrix** | ✅ | ✅ | Element/open-source enterprise; federação descentralizada crescente | Critical |
| **SMS** | ✅ | ✅ | Vertical telecom/healthcare/banking; 2FA + notification flows universais | Critical |
| **Mattermost** | ✅ | ✅ | Self-hosted enterprise (GitLab, Wikimedia); compliance/air-gapped | Important |
| **LINE** | ⚠️ | ✅ | APAC consumer dominante (JP ~85M MAU / TW / TH) | Important |

OpenClaw e Hermes bundlam essas plataformas no monorepo deles (anti-pattern de manutenção que rejeitamos em D171). Nossa proposta: shipar como **packages peer-dep** seguindo exatamente o pattern dos 6 existentes — cada package = workspace independente, opt-in via `pnpm add @usetheo/gateway-{name}`, peer-dep do SDK + transport library oficial.

### Por que agora

1. **Mercado endereçável aberto:** com SMS + LINE, a SDK passa de "cobre OCDE chat" para "cobre OCDE chat + telecom + APAC consumer". Pra um agente entregar reminder por SMS quando o usuário não está online, hoje precisamos forking — não escalável.
2. **Vertical compliance:** Mattermost desbloqueia consumidores enterprise self-hosted que rejeitam Slack Cloud (saúde, defesa, governo).
3. **Decentralized momentum:** Matrix Foundation está no momento certo (Element Bridge ecosystem, MSC4140 threading, EU adoption). Entrar agora aproveita o ciclo.
4. **Multiplicador comunidade:** com 10 gateways de qualidade + `BasePlatformAdapter` documentado, a comunidade pode entregar Signal/iMessage/WeChat/Feishu sem nós manter (anti-pattern de inflar contagem como Hermes faz).

## Objective

**Done definition (uma frase):** ao final, `pnpm add @usetheo/gateway-{sms,mattermost,line,matrix}` faz o consumidor ter exatamente o mesmo formato de uso dos 6 existentes — `new XxxAdapter(opts)` → `adapter.connect()` → `runner.handler(event)` → `adapter.sendMessage(out)`.

### Metas mensuráveis

- [ ] 4 novos workspace packages publicáveis via Changesets (`@usetheo/gateway-sms@0.1.0`, `@usetheo/gateway-mattermost@0.1.0`, `@usetheo/gateway-line@0.1.0`, `@usetheo/gateway-matrix@0.1.0`)
- [ ] Cada package: ≥60 unit tests, build CJS+ESM+DTS verde, publint clean, attw 100% verde, `pnpm typecheck` workspace clean, lint zero erros
- [ ] `PlatformName` union em `packages/gateway/src/types/message-event.ts` estendida para 10 platforms: `"telegram" | "discord" | "slack" | "whatsapp" | "teams" | "email" | "sms" | "mattermost" | "line" | "matrix"`
- [ ] 4 example apps em `examples/{sms,mattermost,line,matrix}-bot/` com `README` walkthrough (config + env vars + smoke command)
- [ ] 4 live smoke env-gated em `tests/integration/{platform}-live.test.ts` (mesmo pattern de D284, env-gated por `*_LIVE_SMOKE=1`)
- [ ] 4 concept pages em `theo-opendocs/content/theokit-sdk/concepts/gateway-{name}.mdx`
- [ ] `telegram-pro` regression sanity: 44/44 PASS na dogfood final (zero regressão dos 6 existentes)
- [ ] ADRs D389-D421 registradas em `.claude/knowledge-base/adrs/` (33 decisões)
- [ ] `CHANGELOG.md` workspace + `packages/gateway-*/CHANGELOG.md` com entrada `Added` por gateway

## ADRs

### SMS — `@usetheo/gateway-sms`

- **D389** — **Multi-backend opt-in (Twilio + Plivo + Vonage)**.
  - **Decisão:** package expõe discriminated union `SMSBackendKind = "twilio" | "plivo" | "vonage"` selecionado via `new SMSAdapter({ backend: "twilio", ... })`. Apenas o backend escolhido tem peer-dep import; outros são lazy.
  - **Rationale:** SMS não tem player único como WhatsApp (Meta) ou Slack (Bolt). Os 3 backends cobrem 95% do mercado de SMS programmable. WhatsApp adapter (D303-D314) já provou o pattern multi-backend funciona.
  - **Consequences:** Mais código upfront, mas o consumidor instala só o SDK necessário (`twilio` ou `plivo` ou `@vonage/server-sdk`). Mantém o footprint pequeno.

- **D390** — **Two-way SMS via webhook server compartilhado**.
  - **Decisão:** `SMSAdapter` inclui `createWebhookServer({ path, port })` que registra rotas Express para cada backend (`/sms/twilio`, `/sms/plivo`, `/sms/vonage`). Caller controla lifecycle (start/stop) ou injeta um Express app existente.
  - **Rationale:** SMS é inerentemente webhook-based (operadores enviam HTTP POST quando chega SMS). Boilerplate é idêntico entre backends — só muda parsing + signature.
  - **Consequences:** Caller precisa expor porta pública (ngrok local, ALB em prod). Documentado no example app.

- **D391** — **E.164 phone normalization obrigatória**.
  - **Decisão:** Todos os números (`event.sender.id`, `OutboundMessage.channel.id`) são normalizados para formato E.164 (`+5511999999999`) usando `libphonenumber-js` (zero peer-dep, MIT, 130KB). Rejeição com `ConfigurationError` se não conseguir parsear.
  - **Rationale:** Twilio aceita várias formas (E.164, +55, 5511...). Sem normalização canônica, mesma pessoa cria duas sessões diferentes (`+5511999999999` vs `+5511 99999-9999`). Inconsistência quebra `SessionRouter` cache.
  - **Consequences:** +130KB no install. Inválido para números non-international (toll-free 1-800 nos EUA — documentar).

- **D392** — **Signature verification por backend (rejeição antes do handler)**.
  - **Decisão:** Cada backend valida assinatura na entrada do webhook (Twilio `X-Twilio-Signature` HMAC-SHA1 + URL+params; Plivo `X-Plivo-Signature-V3` HMAC-SHA256; Vonage `Authorization: Bearer` JWT). Rejeição com `401` antes de dispatch.
  - **Rationale:** Webhook público = ataque. Spoofing trivial sem signature. Mesma postura defensiva do email (D331 own-loopback) e Slack (Bolt signing secret).
  - **Consequences:** Se signing secret não for configurado, package lança `ConfigurationError` no `connect()` — NÃO permite "modo inseguro" mesmo opt-in.

- **D393** — **1600-char multipart com segmentação automática**.
  - **Decisão:** Mensagens > 1600 chars são segmentadas em N partes, prefixadas com `(1/N)`, `(2/N)`, etc. Limite 1600 (não 160) porque concatenated SMS modernos suportam isso. UTF-16 surrogate-safe split (mesmo pattern de D272/EC-4 do Slack).
  - **Rationale:** 160 é o limite GSM-7. Concatenated SMS (UDH) une múltiplas partes em UI única. Twilio/Plivo lidam com concatenação no operator — só precisamos não cortar em surrogate pair.
  - **Consequences:** Cada parte = 1 cobrança no provider. Documentar custo no example app.

- **D394** — **Sem threading model (phone = thread)**.
  - **Decisão:** `event.channel.type = "dm"` sempre. `topicId = undefined`. SMS não tem threading; conversação é serial por par (sender, receiver). `SessionRouter` chaveia em `sender.id` E.164.
  - **Rationale:** Forçar threading em SMS é inventar primitivo que não existe. Outros adapters (telegram threads, slack thread_ts) têm threading nativo — SMS não.
  - **Consequences:** Group SMS (US "MMS group" — múltiplos destinatários) não é suportado em v0.1. Documentar como deferred.

- **D395** — **MMS (imagens/áudio) deferido para v0.2**.
  - **Decisão:** v0.1 só texto. Inbound MMS rejeita com warn stderr; outbound apenas texto. Pattern de "deferred" idêntico ao Slack file uploads (D280) e Slack Block Kit (D281).
  - **Rationale:** MMS adiciona scope: media upload to S3/CDN, MIME-type handling, transcoding. v0.1 entrega valor 90% (texto) com 50% do esforço.
  - **Consequences:** Customers que precisam MMS esperam v0.2 ou usam escape hatch `adapter.getBackendClient()` (não documentado mas existe).

- **D396** — **Budget integration deferred (charge per message)**.
  - **Decisão:** v0.1 NÃO integra com `Budget` namespace. Caller que quiser tracking de SMS cost (Twilio cobra ~$0.0075/SMS US, ~$0.04 BR) faz wrap manual.
  - **Rationale:** Budget primitive (D375-D388) é token-based, não message-based. Adaptar exige modelo de pricing por-platform — escopo separado.
  - **Consequences:** v0.2 do package pode adicionar `chargePerMessage: true` opt-in.

### Mattermost — `@usetheo/gateway-mattermost`

- **D397** — **SDK choice = `@mattermost/client` (oficial v4 REST + WebSocket)**.
  - **Decisão:** Usar `@mattermost/client` (peer-dep, MIT, mantido pelo Mattermost). NÃO `mattermost-redux` (depreciado).
  - **Rationale:** Mesmo SDK que o webapp oficial usa. `@mattermost/client` empacota REST v4 + WebSocket gateway. Tipos TS nativos.
  - **Consequences:** Peer-dep `@mattermost/client@^9.0.0`. Suporta self-hosted (qualquer baseUrl) + Mattermost Cloud.

- **D398** — **WebSocket gateway para inbound (não webhooks)**.
  - **Decisão:** Connect via WebSocket `/api/v4/websocket` autenticado com token. Inbound events vêm via `posted` event.
  - **Rationale:** Webhook outgoing Mattermost suportam só channel-specific. WebSocket cobre todo o user scope (DMs, mentions, channels onde o bot está). Mesmo trade-off de Slack Socket Mode vs Events API (D268).
  - **Consequences:** Long-running connection. Auto-reconnect com backoff exponencial (1s, 2s, 4s, 8s, 30s max).

- **D399** — **Root post ID → `topicId` (mirror do Slack thread_ts)**.
  - **Decisão:** Posts com `root_id !== ""` são threads. `event.channel.type = "thread"`, `topicId = root_id`. Posts sem root_id são DM/group/channel raiz.
  - **Rationale:** Slack já estabeleceu o pattern (D271). Mattermost usa o mesmo conceito (root_id = parent post). Manter consistência cross-platform reduz superfície de surpresa.
  - **Consequences:** Reply em thread chama `sendMessage({ channel: { type: "thread", topicId: <root> } })`.

- **D400** — **Base URL configurável (self-hosted-first)**.
  - **Decisão:** `new MattermostAdapter({ baseUrl: "https://mattermost.acme.com", token: "xxx" })`. Sem default — caller obriga a configurar (não há "Mattermost Cloud single URL").
  - **Rationale:** Mattermost é self-hosted majoritariamente. Cada instalação tem seu próprio domain. Forçar configuração explícita evita o smell de "Cloud default".
  - **Consequences:** Caller precisa saber sua URL. README do example app documenta como achar.

- **D401** — **Personal Access Token (PAT) auth (não OAuth)**.
  - **Decisão:** v0.1 usa PAT (gerado em System Console → Integrations). OAuth deferred.
  - **Rationale:** PAT é admin-issued, opera com identidade fixa (bot account). OAuth requer fluxo interativo com cada usuário — overkill para bot.
  - **Consequences:** Bot opera com identidade fixa. Multi-tenant deferred.

- **D402** — **Channel-type mapping**:
  - **Decisão:** Mattermost channel types: `D` (DM) → `"dm"`, `G` (group DM) → `"group"`, `O` (open/public) → `"group"`, `P` (private) → `"group"`. `event.mattermost.raw.type` exposto via escape hatch.
  - **Rationale:** Gateway core MessageEvent só conhece `dm | group | thread`. Channels public/private para o agent são funcionalmente equivalentes — quem precisar da distinção usa `event.mattermost.raw.channelType`.
  - **Consequences:** Caller que quer tratar public vs private diferente faz o switch via raw.

- **D403** — **Bot mention default required em channels (mirror D285)**.
  - **Decisão:** `requireMention: true` default. Em DM (`type: "dm"`), processa qualquer mensagem; em group/public/private channel, só processa se `@bot_username` mencionado.
  - **Rationale:** Mesmo motivo de D285 (Slack). Bot em canal de 200 pessoas que responde a tudo = explosão de custo.
  - **Consequences:** Caller que quer modo "responda a tudo" usa `requireMention: false`.

- **D404** — **File uploads deferred para v0.2**.
  - **Decisão:** v0.1 só texto. File uploads (anexo de imagem, doc) deferred.
  - **Rationale:** Mesma justificativa de D280 (Slack) e D404 (SMS) — escopo 90/50.
  - **Consequences:** Caller que precisa upload usa `adapter.getClient()` (escape hatch).

### LINE — `@usetheo/gateway-line`

- **D405** — **SDK choice = `@line/bot-sdk` (oficial)**.
  - **Decisão:** Peer-dep `@line/bot-sdk@^9.0.0`. Bot Server class + WebhookEvent types.
  - **Rationale:** SDK oficial mantido pela LINE Corp. Suporta Messaging API + signature validation built-in.
  - **Consequences:** Tipos LINE-específicos (FlexMessage, Carousel) acessíveis via escape hatch.

- **D406** — **Webhook-only transport (sem WebSocket)**.
  - **Decisão:** LINE Messaging API é 100% webhook-based. `LineAdapter.createWebhookServer({ path, port })` ou inject Express app.
  - **Rationale:** LINE não oferece WebSocket gateway. Webhook é o único caminho oficial.
  - **Consequences:** Caller precisa expor URL pública (ngrok dev, ALB prod). Documentar.

- **D407** — **Reply token primary, Push API fallback**.
  - **Decisão:** Para responses dentro de 1 min do evento, usar `replyMessage(replyToken, ...)` (gratis ilimitado). Após expiry, usar `pushMessage(userId, ...)` (cobra após 500/mês free tier).
  - **Rationale:** LINE distingue claramente os dois APIs. Reply token é otimização real ($$$).
  - **Consequences:** Adapter precisa rastrear `(userId → replyToken → expiry)` em mapa LRU (capacity 1000, TTL 60s). Após expiry, automatic fallback para push com warn stderr.

- **D408** — **Signature validation HMAC-SHA256 em todo POST**.
  - **Decisão:** Validar `X-Line-Signature` header em todo webhook POST usando `crypto.timingSafeEqual(hmac, signature)`. Rejeitar com 401 se falhar.
  - **Rationale:** Mesma postura defensiva de SMS (D392). Webhook público = signature obrigatória.
  - **Consequences:** Caller obriga a fornecer `channelSecret` no constructor.

- **D409** — **Mentionee array, sem text marker**.
  - **Decisão:** LINE mentions vêm como `event.message.mentionees = [{ index, length, userId }]` separado do texto (não inline `@username`). Adapter normaliza para `event.line.mentionees: string[]` (lista de userIds mencionados). `requireMention: true` checa se `botUserId in mentionees`.
  - **Rationale:** Inconsistente com Telegram/Discord/Slack (que usam `@username` inline). API força a representação separada.
  - **Consequences:** `stripBotMention()` precisa usar `mentionees[i].index + length` em vez de regex.

- **D410** — **Channel mapping**:
  - **Decisão:** LINE source types: `user` (DM) → `"dm"`, `group` → `"group"`, `room` → `"group"`. Topic = `undefined` (LINE não tem threads em v0.1).
  - **Rationale:** Group e Room são funcionalmente iguais (multi-user); diferença é só "group = persistent, room = ad-hoc". Não exposto.
  - **Consequences:** Caller pode distinguir via `event.line.sourceType`.

- **D411** — **Character limit 5000 + split (UTF-16 surrogate-safe)**.
  - **Decisão:** Limite LINE é 5000 chars por mensagem texto. `splitForLine()` segmenta em surrogate-safe chunks ≤5000.
  - **Rationale:** Limite oficial da API. Mesmo pattern de D272 (Slack 4000).
  - **Consequences:** Mensagens longas = múltiplos messages (cada push API cobra após free tier).

- **D412** — **Flex Message + Carousel via escape hatch (não first-class v0.1)**.
  - **Decisão:** Rich messages (Flex, Carousel) acessíveis via `adapter.getClient().pushMessage()` direto. v0.1 só texto via `sendMessage()`.
  - **Rationale:** Mesma justificativa de Slack Block Kit (D281). Rich rendering é vertical-específico — caller que precisar usa escape hatch.
  - **Consequences:** Documentar no README do example.

### Matrix — `@usetheo/gateway-matrix`

- **D413** — **SDK choice = `matrix-js-sdk` (oficial Element)**.
  - **Decisão:** Peer-dep `matrix-js-sdk@^32.0.0`. SDK oficial mantido pela Element/Matrix Foundation.
  - **Rationale:** Único SDK oficial em JS/TS. Outros (`matrix-bot-sdk`) são abandonados ou wrap deste.
  - **Consequences:** ~2MB de peer-dep. Aceitável (gigantic mas funcional).

- **D414** — **Homeserver configurável + access token auth (sem device password)**.
  - **Decisão:** `new MatrixAdapter({ homeserverUrl: "https://matrix.org", accessToken: "syt_xxx", userId: "@bot:matrix.org" })`. Token gerado via Element UI (Settings → Help & About → Advanced).
  - **Rationale:** Federation = homeserver pode ser qualquer um (matrix.org, element.io, self-hosted Synapse/Dendrite). Access token é canonic auth para bots; device login interativo não cabe.
  - **Consequences:** Caller precisa gerar token manualmente. README documenta como.

- **D415** — **Sync transport via long-poll (`/_matrix/client/v3/sync`)**.
  - **Decisão:** `client.startClient({ initialSyncLimit: 10 })` triggera long-poll sync loop. Cada iteração = batch de events.
  - **Rationale:** É como Matrix funciona. Não há WebSocket nativo (MSC4140 push notifications é separado).
  - **Consequences:** Sempre 1 conexão aberta por adapter. Reconnect automático via SDK.

- **D416** — **DM detection via room.getJoinedMemberCount()**:
  - **Decisão:** Room com 2 members (bot + 1 user) = `type: "dm"`. ≥3 members = `type: "group"`. Sem threads em v0.1.
  - **Rationale:** Matrix não tem "DM" como conceito primitivo — é uma room privada de 2 pessoas. Heurística baseline correta.
  - **Consequences:** Falsos positivos se user invitar bot a sala de 2 (intended group, looks like DM). Caller pode override via `event.matrix.roomId` em hooks.

- **D417** — **MSC4140 thread support deferido para v0.2**.
  - **Decisão:** v0.1 NÃO suporta Matrix threads. Replies vão raiz da room. Threading deferred.
  - **Rationale:** MSC4140 ainda é experimental, clients (Element) implementam parcialmente. v0.2 adiciona quando spec estabilizar.
  - **Consequences:** Documentar limitation.

- **D418** — **E2EE OPT-OUT default (sem encryption v0.1)**.
  - **Decisão:** v0.1 conecta apenas a rooms unencrypted. Bot recusa join em E2EE room com warn stderr + log "room is encrypted; E2EE deferred to v0.2".
  - **Rationale:** E2EE no Matrix exige key sharing, device verification, Olm/Megolm crypto — adiciona ~1MB lib + complexidade enorme. v0.1 entrega 90% (unencrypted rooms = ainda a maioria).
  - **Consequences:** Caller que precisa E2EE espera v0.2 ou usa `matrix-js-sdk` direto (escape hatch).

- **D419** — **Room aliases resolved → room IDs**.
  - **Decisão:** Configuração aceita aliases (`#general:matrix.org`) ou IDs (`!abc123:matrix.org`). Adapter resolve alias → ID na conexão e cacheia.
  - **Rationale:** UX: humanos usam aliases (Element mostra alias). Internamente Matrix opera em IDs imutáveis. Resolver na entrada evita lookup repetido.
  - **Consequences:** Cache invalida se admin alterar alias (raro, mas documentar).

- **D420** — **Federation transparent (homeserver gerencia)**.
  - **Decisão:** Adapter não trata federation diretamente — Matrix SDK federa automaticamente. Bot em `@bot:matrix.org` consegue receber mensagens de user `@alice:element.io` via federation built-in.
  - **Rationale:** É o ponto de Matrix. Não inventar lógica de federation — confiar no protocolo.
  - **Consequences:** Performance varia por homeserver remoto. Deferred handling de federation lag.

- **D421** — **MessageEvent.matrix raw event preserve**:
  - **Decisão:** `event.matrix.raw` expõe o `MatrixEvent` completo do SDK. Caller pode acessar `redactions`, `relations`, `unsigned`, etc.
  - **Rationale:** Matrix events são ricos (replies, reactions, edits via `m.replace` relations). Não cabe normalizar tudo — escape hatch garante extensibilidade.
  - **Consequences:** API estável: `event.text` + `event.sender` + `event.channel` sempre cobrem 80% dos casos; raw cobre o resto.

## Dependency Graph

```
                                    ┌────────────────────┐
                                    │ Phase 0 — Shared  │
                                    │ (PlatformName +    │
                                    │ MessageEvent union)│
                                    └─────────┬──────────┘
                                              │
                ┌─────────────────────────────┼─────────────────────────────┐
                ▼                             ▼                             ▼
        ┌───────────────┐             ┌───────────────┐             ┌───────────────┐
        │ Phase 1: SMS  │             │ Phase 2:      │             │ Phase 3: LINE │
        │ (2 dias)      │             │ Mattermost    │             │ (2 dias)      │
        │               │             │ (2 dias)      │             │               │
        └───────┬───────┘             └───────┬───────┘             └───────┬───────┘
                │                             │                             │
                └─────────────────────────────┼─────────────────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │ Phase 4: Matrix │
                                    │ (3-5 dias)      │
                                    └────────┬────────┘
                                             │
                                             ▼
                                    ┌─────────────────────────┐
                                    │ Phase 5: Cross-cutting │
                                    │ (docs + CHANGELOG +     │
                                    │ dogfood entries)        │
                                    └────────┬────────────────┘
                                             │
                                             ▼
                                    ┌─────────────────────────┐
                                    │ Phase 6: Dogfood QA     │
                                    │ (telegram-pro 44/44 +   │
                                    │ 4 live smokes)          │
                                    └─────────────────────────┘
```

**Paralelização:** Phases 1, 2, 3 são **totalmente independentes** após Phase 0 — podem ser implementadas em paralelo (2-3 devs ou em quaisquer 3 worktrees separados). Phase 4 (Matrix) é o mais pesado (3-5d); pode rodar em paralelo com 1-3 mas geralmente cabe ao final como "boss task". Phase 5 só roda quando todos os 4 estão verdes.

**Esforço total estimado:** 11-13 dias úteis serial; 5-7 dias úteis paralelizado em 3-frentes.

---

## Phase 0: Shared Groundwork — Estender PlatformName + MessageEvent Union

**Objective:** Adicionar os 4 novos discriminators (`"sms" | "mattermost" | "line" | "matrix"`) na union `PlatformName` em `@usetheo/gateway` core ANTES de qualquer package novo importar dele.

### T0.1 — Estender PlatformName + adicionar variant interfaces stub

#### Objective
Atualizar `packages/gateway/src/types/message-event.ts` para incluir os 4 novos discriminators + interfaces variant skeleton.

#### Evidence
`packages/gateway/src/types/message-event.ts:23` atualmente tem `PlatformName = "telegram" | "discord" | "slack" | "whatsapp" | "teams" | "email"` — 6 platforms. `MessageEvent` é union sobre essas 6 variants. Para os 4 novos packages declararem suas variants sem erro de tipo, a base union precisa aceitar os novos kinds.

#### Files to edit
```
packages/gateway/src/types/message-event.ts — adicionar 4 discriminators + 4 interface stubs
packages/gateway/src/index.ts — re-exports (sanity)
packages/gateway/CHANGELOG.md — entry sob [Unreleased]
```

#### Deep file dependency analysis
- `message-event.ts` é importado por TODOS os 6 packages gateway existentes (`packages/gateway-*/src/adapter.ts` faz `import type { MessageEvent } from "@usetheo/gateway"`). Adicionar variants é backward-compatible — exhaustive switches em adapters existentes continuam corretos (TypeScript não força handling de novos union members em código que importa, só em código que pattern-matches sobre o union).
- `packages/gateway/src/runner/gateway-runner.ts` consome `MessageEvent.platform` em dispatch — adicionar discriminators é additive (default handler ainda funciona).

#### Deep Dives

**Variant interfaces stub:** cada uma declara minimal shape — `raw: unknown` para permitir o package específico depois estreitar o tipo via module augmentation (mesmo pattern do Telegram `raw: unknown` que `gateway-telegram` re-declara como `Context` via declaration merging).

```ts
// SMS
export interface SMSMessageEvent extends BaseMessageEvent {
  readonly platform: "sms";
  readonly sms: {
    readonly backend: "twilio" | "plivo" | "vonage";
    readonly from: string; // E.164
    readonly to: string;   // E.164
    readonly raw: unknown;
  };
}

// Mattermost
export interface MattermostMessageEvent extends BaseMessageEvent {
  readonly platform: "mattermost";
  readonly mattermost: {
    readonly postId: string;
    readonly channelId: string;
    readonly teamId: string;
    readonly rootId?: string;
    readonly raw: unknown;
  };
}

// LINE
export interface LineMessageEvent extends BaseMessageEvent {
  readonly platform: "line";
  readonly line: {
    readonly sourceType: "user" | "group" | "room";
    readonly sourceId: string;
    readonly mentionees: ReadonlyArray<string>;
    readonly replyToken?: string;
    readonly raw: unknown;
  };
}

// Matrix
export interface MatrixMessageEvent extends BaseMessageEvent {
  readonly platform: "matrix";
  readonly matrix: {
    readonly roomId: string;
    readonly eventId: string;
    readonly memberCount: number;
    readonly raw: unknown;
  };
}
```

**Edge case:** `MessageEvent` union final tem 10 variants. Exhaustive switch em consumidores que listam todos 10 ainda compila; quem usa `default: unreachable(event)` precisa só tratar `never`. Garantir compat com discord/slack/etc adapters que faziam `if (event.platform === "telegram") return ...; return;` (default path).

#### Tasks

0. **(EC-5 absorvido)** Pre-step: `grep -rn "_exhaustive: never\|: never = event" packages/ examples/ tools/` para identificar TODOS os switches exhaustive sobre `MessageEvent.platform`. Em cada hit, adicionar 4 novos cases (`sms | mattermost | line | matrix`) com fallback noop (`return undefined` ou similar). Sem isso, expansão da union quebra compile em consumidores.
1. Adicionar 4 discriminators na linha 23: `"sms" | "mattermost" | "line" | "matrix"`
2. Adicionar 4 interface variants stub no final do arquivo
3. Atualizar `MessageEvent = TelegramMessageEvent | ... | MatrixMessageEvent` (union de 10)
4. `packages/gateway/src/index.ts` — re-exportar os 4 novos types
5. `packages/gateway/CHANGELOG.md` — entry sob `[Unreleased]` documentando os 4 novos discriminators (backward compat)
6. Rodar `pnpm typecheck` workspace; nenhum existing gateway pode quebrar
7. Rodar `pnpm test` em `packages/gateway/` — tests existentes passam

#### TDD

```
RED:     test_platform_name_includes_sms() — expect "sms" assignable to PlatformName (type test via test-d.ts ou inline)
RED:     test_platform_name_includes_mattermost() — same
RED:     test_platform_name_includes_line() — same
RED:     test_platform_name_includes_matrix() — same
RED:     test_sms_message_event_shape() — interface compatibility check (no exhaustive switch break)
GREEN:   Adicionar os 4 discriminators + 4 variant interfaces
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/gateway typecheck && pnpm --filter @usetheo/gateway test
```

#### Acceptance Criteria

- [ ] `PlatformName` union tem 10 strings
- [ ] 4 novas interface variants exportadas de `@usetheo/gateway`
- [ ] `pnpm typecheck` workspace verde (zero erro nos 6 packages existentes)
- [ ] `pnpm --filter @usetheo/gateway test` verde
- [ ] `pnpm --filter @usetheo/gateway build` produz CJS+ESM+DTS válidos
- [ ] `pnpm publint --filter @usetheo/gateway` clean
- [ ] CHANGELOG.md entry sob `[Unreleased]` adicionada

#### DoD

- [ ] Todas as 7 tarefas concluídas e validadas
- [ ] Tests passam em todos os 6 packages gateway existentes (regression sanity)
- [ ] Zero lint warnings (biome check)
- [ ] PR-ready (commitável isolado)

---

## Phase 1: SMS — `@usetheo/gateway-sms`

**Objective:** Shipar `@usetheo/gateway-sms@0.1.0` com 3 backends (Twilio + Plivo + Vonage), two-way webhook server, signature verification, E.164 normalization, e 1600-char multipart split. Vertical: telecom/healthcare/banking.

### T1.1 — Scaffold package + multi-backend skeleton

#### Objective
Criar workspace package `packages/gateway-sms/` com `package.json`, `tsconfig.json`, `tsup.config.ts`, `biome.json`, `src/` layout, peer-deps declarados (todos opcionais).

#### Evidence
`packages/gateway-whatsapp/` (D303-D314) é o template multi-backend mais recente — copiar layout. WhatsApp shipou 85/85 unit tests, build verde, publint clean — pattern provado.

#### Files to edit
```
packages/gateway-sms/package.json (NEW)
packages/gateway-sms/tsconfig.json (NEW)
packages/gateway-sms/tsup.config.ts (NEW)
packages/gateway-sms/biome.json (NEW)
packages/gateway-sms/CHANGELOG.md (NEW)
packages/gateway-sms/README.md (NEW)
packages/gateway-sms/src/index.ts (NEW)
packages/gateway-sms/src/types.ts (NEW)
packages/gateway-sms/src/backend-types.ts (NEW)
packages/gateway-sms/src/errors.ts (NEW)
packages/gateway-sms/src/phone.ts (NEW)
pnpm-workspace.yaml — adicionar packages/gateway-sms (já glob? confirmar)
```

#### Deep file dependency analysis
- `pnpm-workspace.yaml` provavelmente tem `packages/*` glob — adicionar package novo é detectado automaticamente.
- `packages/gateway-sms/package.json` declara peer-deps opcionais: `twilio`, `plivo`, `@vonage/server-sdk`, `libphonenumber-js`. Apenas `@usetheo/gateway` + `@usetheo/sdk` são required.
- `src/index.ts` re-exporta `SMSAdapter`, `SMSAdapterOptions`, `SMSBackendKind`, `SMSMessageEvent` (já existe no gateway core via Phase 0).
- Module augmentation em `src/types.ts` re-declara `SMSMessageEvent.sms.raw` para narrowing por backend.

#### Deep Dives

**`backend-types.ts`** — contrato comum:

```ts
export interface SMSBackend {
  readonly kind: "twilio" | "plivo" | "vonage";
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  sendMessage(to: string, body: string): Promise<{ ok: true; messageId: string } | { ok: false; error: { code: string; message: string } }>;
  verifySignature(headers: Record<string, string>, rawBody: string, url: string): boolean;
  parseInbound(rawBody: string): SMSInbound; // throws on malformed
  registerInboundListener(handler: (inbound: SMSInbound) => Promise<void>): () => void;
}

export interface SMSInbound {
  from: string;       // E.164
  to: string;         // E.164
  body: string;
  messageId: string;
  receivedAt: number;
}
```

**`phone.ts`** — wrapper em `libphonenumber-js`:

```ts
import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";

export function normalizeE164(input: string, defaultCountry?: string): string {
  const parsed = parsePhoneNumberFromString(input, defaultCountry as never);
  if (parsed === undefined || !parsed.isValid()) {
    throw new ConfigurationError({ code: "invalid_phone_number", raw: input });
  }
  return parsed.format("E.164");
}
```

**Edge case (D391 absorbed):** Toll-free US (1-800-...) NÃO é "mobile" no libphonenumber. Documentar limitation no README; caller pode passar `defaultCountry: "US"` + número sem prefix.

#### Tasks
0. **(EC-1 absorvido)** Constructor `SMSAdapter` valida `signingSecret` (Twilio `authToken` / Plivo `authToken` / Vonage `signatureSecret`) — lança `ConfigurationError({ code: "signing_secret_required" })` se vazio/undefined. Webhook público SEM signature = security hole; package recusa modo inseguro mesmo opt-in.
1. Criar `packages/gateway-sms/package.json` com name=`@usetheo/gateway-sms`, version `0.1.0`, peer-deps `{ "@usetheo/gateway": "workspace:^", "@usetheo/sdk": "workspace:^", "twilio": "^5.0.0", "plivo": "^4.0.0", "@vonage/server-sdk": "^3.0.0", "libphonenumber-js": "^1.10.0", "express": "^4.18.0" }`, todos marcados optional exceto `@usetheo/gateway` + `@usetheo/sdk`
2. `tsconfig.json` extends `../../tsconfig.base.json` com `outDir: "./dist"`
3. `tsup.config.ts` — CJS+ESM+DTS dual export (copy from whatsapp)
4. `biome.json` — extends workspace root
5. `src/types.ts` — module augmentation `declare module "@usetheo/gateway"` para narrow `sms.raw` por backend
6. `src/backend-types.ts` — interface `SMSBackend`, `SMSInbound`
7. `src/errors.ts` — `ConfigurationError`, `BackendNotInstalledError` (lança quando peer-dep não está)
8. `src/phone.ts` — `normalizeE164(input, defaultCountry?)` + tests
9. `src/index.ts` — re-exports placeholder
10. `README.md` — quickstart skeleton (preencher depois)
11. `CHANGELOG.md` — `[Unreleased]` skeleton
12. Rodar `pnpm install` (detecta novo workspace), `pnpm --filter @usetheo/gateway-sms build` deve produzir dist vazio mas válido

#### TDD

```
RED:     test_normalize_e164_valid_br() — "+5511999999999" → "+5511999999999"
RED:     test_normalize_e164_with_country_default() — "11999999999" + defaultCountry="BR" → "+5511999999999"
RED:     test_normalize_e164_invalid_throws() — "abc" → ConfigurationError
RED:     test_normalize_e164_empty_throws() — "" → ConfigurationError
RED:     test_normalize_e164_toll_free_us_accepted() — (EC-6) "+18001234567" → "+18001234567" sem throw
RED:     test_adapter_constructor_throws_without_signing_secret() — (EC-1) new SMSAdapter({ backend: "twilio", authToken: "" }) → ConfigurationError
GREEN:   Implementar phone.ts com libphonenumber-js (aceitando MOBILE + TOLL_FREE types)
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/gateway-sms test
```

#### Acceptance Criteria

- [ ] `packages/gateway-sms/` existe com 11 arquivos (lista acima)
- [ ] `pnpm --filter @usetheo/gateway-sms typecheck` clean
- [ ] `pnpm --filter @usetheo/gateway-sms build` produz CJS+ESM+DTS
- [ ] `pnpm --filter @usetheo/gateway-sms test` passa (4 phone tests)
- [ ] `pnpm publint --filter @usetheo/gateway-sms` clean
- [ ] `node tools/check-loc.mjs` — todos os arquivos ≤400 LoC
- [ ] Peer-deps marcados optional exceto gateway+sdk

#### DoD

- [ ] Tarefas 1-12 concluídas
- [ ] Tests verde
- [ ] Build verde
- [ ] Lint zero warnings

---

### T1.2 — Backend implementations: Twilio + Plivo + Vonage

#### Objective
Implementar os 3 backends concretos cada qual implementando `SMSBackend` interface. Cada backend valida signature, parseia inbound, envia outbound, e expõe `raw` SDK type.

#### Evidence
Twilio SDK doc: https://www.twilio.com/docs/messaging/quickstart/node. Plivo: https://www.plivo.com/docs/sms/quickstart/node. Vonage: https://developer.vonage.com/messaging/sms/overview. Os 3 têm SDKs maduros com signature verification built-in (Twilio `validateRequest`, Plivo `validateV3Signature`, Vonage `verifySignature`).

#### Files to edit
```
packages/gateway-sms/src/backend/twilio.ts (NEW)
packages/gateway-sms/src/backend/plivo.ts (NEW)
packages/gateway-sms/src/backend/vonage.ts (NEW)
packages/gateway-sms/src/backend/index.ts (NEW) — factory `createBackend(opts)`
packages/gateway-sms/tests/backend/twilio.test.ts (NEW)
packages/gateway-sms/tests/backend/plivo.test.ts (NEW)
packages/gateway-sms/tests/backend/vonage.test.ts (NEW)
```

#### Deep file dependency analysis
- Cada `backend/{name}.ts` faz `import` lazy do SDK respectivo via dynamic import wrapped em try/catch — quando peer-dep não está instalada, lança `BackendNotInstalledError` com mensagem actionable ("Install `twilio` to use the twilio backend: pnpm add twilio").
- `backend/index.ts` exporta factory `createBackend(opts: SMSAdapterOptions): Promise<SMSBackend>` que faz switch em `opts.backend`.
- Cada backend tem teste unit que mocka o SDK e valida: (a) signature verification rejeita assinatura inválida, (b) parseInbound parseia corretamente o body do webhook, (c) sendMessage chama o SDK com args corretos, (d) sendMessage trata 4xx (rate limit, invalid number) sem throw.

#### Deep Dives

**Twilio signature** — `X-Twilio-Signature` é HMAC-SHA1 de `(url + sortedParams)`. Twilio SDK fornece `validateRequest(authToken, signature, url, params)` que retorna bool. Não reimplementar.

**Plivo signature V3** — `X-Plivo-Signature-V3` é HMAC-SHA256 do payload. SDK Plivo fornece `Plivo.validateV3Signature(url, nonce, signature, authToken)` (assinatura mais nova que V1).

**Vonage signature** — JWT no `Authorization: Bearer` header. SDK Vonage `Auth.verifySignature(token, signatureSecret)`. Não confundir com Vonage Verify API (API diferente).

**Outbound rate limit handling:** Twilio retorna 429 com `Retry-After` em ms. Adapter retorna `SendResult { ok: false, error: { code: "rate_limit", message: "Retry after X ms" } }` — caller decide se faz retry (NÃO retry automático em v0.1).

**Edge case:** Twilio sandbox numbers (não confirmados) podem ter status `failed` mesmo após 200 OK. Adapter checa `MessageInstance.status` no callback opcional (deferred para v0.2 — v0.1 retorna ok=true logo após 200).

#### Tasks
1. `backend/twilio.ts` — instanciar client lazy, implementar SMSBackend interface
2. `backend/plivo.ts` — idem
3. `backend/vonage.ts` — idem
4. `backend/index.ts` — factory + error mapping
5. Tests para cada backend: signature OK + signature FAIL + parseInbound + sendMessage success + sendMessage 4xx

#### TDD

```
RED:     test_twilio_signature_valid_accepts() — valid HMAC → returns true
RED:     test_twilio_signature_invalid_rejects() — bad HMAC → returns false
RED:     test_twilio_parse_inbound_extracts_from_to_body() — webhook payload → {from, to, body}
RED:     test_twilio_send_message_calls_sdk_with_e164() — adapter sends, SDK receives E.164 numbers
RED:     test_twilio_send_message_rate_limit_returns_send_result_not_throw() — 429 → SendResult.ok=false
RED:     [equivalentes para plivo + vonage = ~5 tests cada]
GREEN:   Implementar 3 backends com SDK lazy import + signature + parse + send
REFACTOR: Extract common error mapping (mapHttpToSendResult) se duplicação aparecer
VERIFY:  pnpm --filter @usetheo/gateway-sms test
```

#### Acceptance Criteria

- [ ] 3 backends implementam `SMSBackend` interface 100%
- [ ] ≥15 unit tests (5 por backend)
- [ ] Backend não instalado lança `BackendNotInstalledError` com mensagem actionable
- [ ] Signature verification usa SDK oficial (não reimplementação)
- [ ] `pnpm test` passa
- [ ] LoC ≤400 por arquivo

#### DoD
- [ ] Tarefas 1-5 concluídas
- [ ] ≥15 tests verde
- [ ] Coverage `pnpm test --coverage` ≥80% no `src/backend/`
- [ ] Lint zero warnings

---

### T1.3 — `SMSAdapter` + webhook server + adapter integration

#### Objective
Implementar `SMSAdapter extends BasePlatformAdapter` que orquestra os backends, expõe `createWebhookServer()`, normaliza inbound → `SMSMessageEvent`, e implementa `sendMessage` com multipart split.

#### Evidence
`packages/gateway-whatsapp/src/adapter.ts:76` (`WhatsAppAdapter extends BasePlatformAdapter`) é template — mesma estrutura para webhook server + backend switch.

#### Files to edit
```
packages/gateway-sms/src/adapter.ts (NEW)
packages/gateway-sms/src/webhook-server.ts (NEW)
packages/gateway-sms/src/normalize.ts (NEW)
packages/gateway-sms/src/split.ts (NEW)
packages/gateway-sms/src/index.ts — re-exportar SMSAdapter
packages/gateway-sms/tests/adapter.test.ts (NEW)
packages/gateway-sms/tests/split.test.ts (NEW)
packages/gateway-sms/tests/normalize.test.ts (NEW)
```

#### Deep file dependency analysis
- `adapter.ts` consome `backend/index.ts:createBackend()` na construção, mantém ref ao backend escolhido. `connect()` chama `backend.connect()`. `disconnect()` chama `backend.disconnect()` + para webhook server se iniciado.
- `webhook-server.ts` exporta `createWebhookServer({ adapter, path, port })` que retorna `{ start, stop }`. Stop é idempotente (D278 mirror).
- `normalize.ts` converte `SMSInbound` (E.164 + body) em `SMSMessageEvent` (gateway core shape). Chama `phone.normalizeE164` para validar.
- `split.ts` exporta `splitForSMS(text: string, limit = 1600): string[]` — UTF-16 surrogate-safe segmentação com prefixo `(i/N)` quando N>1.

#### Deep Dives

**Webhook server pattern (D390):**

```ts
import express, { type Express } from "express";

export interface WebhookServerOptions {
  adapter: SMSAdapter;
  path?: string;       // default "/sms"
  port?: number;       // default 3000
  app?: Express;        // inject existing
}

export function createWebhookServer(opts: WebhookServerOptions) {
  const app = opts.app ?? express();
  app.use(`${opts.path ?? "/sms"}/twilio`, express.urlencoded({ extended: false }), twilioHandler(opts.adapter));
  app.use(`${opts.path ?? "/sms"}/plivo`, express.json(), plivoHandler(opts.adapter));
  app.use(`${opts.path ?? "/sms"}/vonage`, express.json(), vonageHandler(opts.adapter));
  let server: ReturnType<typeof app.listen> | undefined;
  return {
    start: () => new Promise<void>((resolve) => { server = app.listen(opts.port ?? 3000, () => resolve()); }),
    stop: () => new Promise<void>((resolve) => { server?.close(() => resolve()); }),
  };
}
```

**`splitForSMS` (D393):** 1600 limit; surrogate-safe (cluster aware via `Intl.Segmenter`):

```ts
export function splitForSMS(text: string, limit = 1600): string[] {
  if (text.length <= limit) return [text];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments = Array.from(segmenter.segment(text), (s) => s.segment);
  const parts: string[] = [];
  let buf = "";
  for (const seg of segments) {
    if ((buf + seg).length > limit - 8 /* reserve for "(i/N) " */) {
      parts.push(buf);
      buf = "";
    }
    buf += seg;
  }
  if (buf.length > 0) parts.push(buf);
  if (parts.length === 1) return parts;
  return parts.map((p, i) => `(${i + 1}/${parts.length}) ${p}`);
}
```

**Edge case (EC-1 grapheme cluster):** emoji compound (🇧🇷 = 2 codepoints) tratado como 1 grapheme. Sem `Intl.Segmenter`, split partiria emoji ao meio. Verificado com `tests/split.test.ts`.

**Adapter inbound flow:**

```
Twilio POST /sms/twilio →
  backend.verifySignature(headers, body, fullUrl) → if false: 401
  backend.parseInbound(body) → { from, to, body, ... }
  normalize(inbound, "twilio") → SMSMessageEvent
  adapter.dispatchInbound(event) → caller handler
  return 200 (Twilio expects empty TwiML or 204)
```

#### Tasks
1. `normalize.ts` — `inboundToMessageEvent(inbound, backend): SMSMessageEvent`
2. `split.ts` — `splitForSMS()` com Intl.Segmenter
3. `webhook-server.ts` — express handlers por backend
4. `adapter.ts` — `SMSAdapter` extends `BasePlatformAdapter` (connect/disconnect/sendMessage/onInbound/createWebhookServer)
5. Inbound dispatch: signature → parse → normalize → handler. Falha em qualquer ponto = log stderr + 401/400 response, não dispatch.
6. `sendMessage()` chama `splitForSMS()` então `Promise.all(parts.map(backend.sendMessage))`; SendResult agregado: ok=true se TODOS partes ok, senão error code "partial_send_failure".
7. `index.ts` — exportar `SMSAdapter`, `SMSAdapterOptions`, `createWebhookServer`, `splitForSMS`
8. Tests: 5+ split tests, 4+ normalize tests, 8+ adapter tests (lifecycle, send, inbound dispatch, signature reject, etc.)

#### TDD

```
RED:     test_split_for_sms_short_returns_single_chunk() — "hi" → ["hi"]
RED:     test_split_for_sms_long_segments_with_prefix() — 3000 chars → 2 parts with "(1/2)" "(2/2)" prefix
RED:     test_split_for_sms_emoji_safe() — emoji 🇧🇷 at boundary stays intact
RED:     test_normalize_extracts_e164_from_twilio_inbound()
RED:     test_normalize_throws_invalid_phone()
RED:     test_adapter_connect_idempotent() — 2x connect = ok
RED:     test_adapter_disconnect_idempotent() — 2x disconnect = ok
RED:     test_adapter_send_message_invalid_to_returns_error() — non-E.164 → SendResult.ok=false
RED:     test_adapter_send_message_long_text_splits() — 3000 char body → 2 sub-messages
RED:     test_adapter_inbound_dispatch_handler_called()
RED:     test_adapter_inbound_signature_invalid_rejects_401()
RED:     test_adapter_onInbound_replaces_previous_handler() — EC-H mirror
RED:     test_adapter_empty_text_returns_send_result_not_throw() — base contract
GREEN:   Implementar adapter + webhook + normalize + split
REFACTOR: Extract logBackendError helper se duplica
VERIFY:  pnpm --filter @usetheo/gateway-sms test
```

#### Acceptance Criteria
- [ ] `SMSAdapter` implementa BasePlatformAdapter completo
- [ ] `splitForSMS()` é surrogate-safe (Intl.Segmenter)
- [ ] Webhook server idempotente (start/stop)
- [ ] ≥17 novos unit tests
- [ ] Total package: ≥32 unit tests
- [ ] Build verde CJS+ESM+DTS
- [ ] `pnpm publint` + `pnpm attw` ambos clean
- [ ] Lint zero warnings, LoC ≤400/arquivo

#### DoD
- [ ] Tarefas 1-8 concluídas
- [ ] Tests ≥17 novos verde
- [ ] Coverage `src/` ≥85%

---

### T1.4 — Example app + live smoke env-gated + docs page

#### Objective
Shipar `examples/sms-bot/` rodável com README walkthrough, `tests/integration/sms-live.test.ts` env-gated, e `theo-opendocs/content/theokit-sdk/concepts/gateway-sms.mdx`.

#### Evidence
Padrão de D284 (Slack live workspace dogfood env-gated) + D311 (WhatsApp example com Express webhook server) — exemplo + live smoke é mandatório por `.claude/rules/real-llm-validation.md`.

#### Files to edit
```
examples/sms-bot/package.json (NEW)
examples/sms-bot/.env.example (NEW)
examples/sms-bot/src/index.ts (NEW)
examples/sms-bot/README.md (NEW)
examples/sms-bot/tsconfig.json (NEW)
packages/gateway-sms/tests/integration/live-twilio.test.ts (NEW) — env-gated
theo-opendocs/content/theokit-sdk/concepts/gateway-sms.mdx (NEW)
theo-opendocs/content/theokit-sdk/cookbook/sms-reminder.mdx (NEW) — recipe (auto-gen via examples?)
```

#### Deep file dependency analysis
- `examples/sms-bot/src/index.ts` é o canary — instancia `SMSAdapter` com Twilio backend (mais popular), `Agent.create` com OpenRouter, registra handler que ecoa input.
- Live smoke faz POST simulado para webhook (não chama Twilio real — usa Twilio test credentials que retornam status sem cobrar).
- Concept page MDX consume API ref auto-gerada via TypeDoc — caller faz import e usa.

#### Deep Dives

**README walkthrough estrutura** (mirror `examples/whatsapp-bot/README.md`):
1. Pré-requisitos (Twilio account com test phone + ngrok)
2. `cp .env.example .env` + preencher
3. `pnpm install`
4. `ngrok http 3000` (capturar URL pública)
5. Configurar webhook URL em Twilio Console (Twilio number → Voice & Messaging → "A message comes in" → webhook URL)
6. `pnpm start`
7. Enviar SMS de número real para Twilio number → ver bot ecoar

**Live smoke env-gated:**

```ts
const SMS_LIVE_SMOKE = process.env.SMS_LIVE_SMOKE === "1";
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;
const TWILIO_TO = process.env.TWILIO_TO;

(SMS_LIVE_SMOKE ? describe : describe.skip)("Twilio live smoke", () => {
  if (TWILIO_SID === undefined || ...) throw new Error("missing env");
  it("sends a real SMS", async () => { ... });
});
```

Mesmo pattern de D284 (Slack) — vive como teste pero só roda quando env explícito está set. Documenta no README como rodar.

#### Tasks
1. `examples/sms-bot/` scaffold (package.json + tsconfig + src/index.ts + README + .env.example)
2. README com 7-step walkthrough Twilio + ngrok
3. Live smoke test env-gated (`SMS_LIVE_SMOKE=1` + Twilio test creds)
4. Concept page MDX em `theo-opendocs/content/theokit-sdk/concepts/gateway-sms.mdx`
5. Cookbook recipe `sms-reminder.mdx` (agente que dispara SMS via cron)
6. `packages/gateway-sms/CHANGELOG.md` — entrada `Added — @usetheo/gateway-sms@0.1.0`
7. `CHANGELOG.md` workspace — entrada idem

#### TDD

```
RED:     test_example_app_compiles() — `pnpm --filter sms-bot typecheck` clean
RED:     test_example_app_starts() — programmatically import index.ts, no throw on Agent.create
RED:     test_live_smoke_skipped_when_env_unset() — SMS_LIVE_SMOKE=undefined → describe.skip
GREEN:   Escrever example + live smoke + docs
REFACTOR: None
VERIFY:  pnpm typecheck && pnpm --filter @usetheo/gateway-sms test
```

#### Acceptance Criteria
- [ ] `examples/sms-bot/` funcional (typecheck verde, runs sem error fixture mode)
- [ ] README 7-step walkthrough completo
- [ ] Live smoke env-gated (skip default, run on env opt-in)
- [ ] Concept page MDX live em `theo-opendocs`
- [ ] Cookbook recipe ship
- [ ] CHANGELOG entrada workspace + package

#### DoD
- [ ] Tarefas 1-7 concluídas
- [ ] Example app typecheck verde
- [ ] `tests/integration/live-twilio.test.ts` registrado mas skipped em CI
- [ ] Documentação ship

---

## Phase 2: Mattermost — `@usetheo/gateway-mattermost`

**Objective:** Shipar `@usetheo/gateway-mattermost@0.1.0` com WebSocket gateway, root-id thread mapping, channel-type normalization, requireMention default true. Vertical: self-hosted enterprise.

### T2.1 — Scaffold package + WebSocket client setup

#### Objective
Criar workspace `packages/gateway-mattermost/`, peer-dep `@mattermost/client@^9.0.0`, WebSocket connection lifecycle.

#### Files to edit
```
packages/gateway-mattermost/package.json (NEW)
packages/gateway-mattermost/tsconfig.json (NEW)
packages/gateway-mattermost/tsup.config.ts (NEW)
packages/gateway-mattermost/biome.json (NEW)
packages/gateway-mattermost/CHANGELOG.md (NEW)
packages/gateway-mattermost/README.md (NEW)
packages/gateway-mattermost/src/index.ts (NEW)
packages/gateway-mattermost/src/client.ts (NEW)
packages/gateway-mattermost/src/errors.ts (NEW)
packages/gateway-mattermost/src/types.ts (NEW)
```

#### Deep file dependency analysis
- `client.ts` envolve `@mattermost/client` Client4 (REST) + WebSocketClient. Lazy import (peer-dep optional). Reconnect com backoff exponencial.
- Module augmentation em `types.ts` re-declara `MattermostMessageEvent.mattermost.raw` como SDK `Post` type.

#### Deep Dives

**WebSocket reconnect (D398):** `@mattermost/client` WebSocketClient tem auto-reconnect built-in mas exponential backoff é 1s/2s/4s/etc. até 30s max. Caller pode override via `clientOpts.reconnectIntervalMs`.

**Bot user ID detection (mirror D277 Slack):** após login, `client.getMe()` → cache `botUserId`. Necessário para filter loop guard (bot ignora own posts) + mention check.

#### Tasks
1. Package skeleton com peer-deps
2. `client.ts` — wrap @mattermost/client Client4 + WebSocketClient
3. `errors.ts` — ConnectionError, ConfigurationError
4. `types.ts` — module augmentation
5. README + CHANGELOG skeleton

#### TDD
```
RED:     test_client_connect_caches_bot_user_id() — após connect, botUserId acessível
RED:     test_client_connect_returns_false_on_invalid_token()
RED:     test_client_disconnect_idempotent()
GREEN:   Implementar client.ts
VERIFY:  pnpm --filter @usetheo/gateway-mattermost test
```

#### Acceptance Criteria
- [ ] Package scaffold completo
- [ ] Client wrapper com WS reconnect
- [ ] ≥3 unit tests
- [ ] Build verde

#### DoD
- [ ] Tarefas 1-5 concluídas, tests verde

---

### T2.2 — `MattermostAdapter` + normalize + send + filter

#### Objective
Implementar `MattermostAdapter extends BasePlatformAdapter` com normalize (post → MessageEvent), send (com root_id para threads), mention filter (D403 default true).

#### Files to edit
```
packages/gateway-mattermost/src/adapter.ts (NEW)
packages/gateway-mattermost/src/normalize.ts (NEW)
packages/gateway-mattermost/src/filters.ts (NEW)
packages/gateway-mattermost/tests/adapter.test.ts (NEW)
packages/gateway-mattermost/tests/normalize.test.ts (NEW)
packages/gateway-mattermost/tests/filters.test.ts (NEW)
```

#### Deep file dependency analysis
- `adapter.ts` consome `client.ts`, registra WebSocket listener para `posted` events, despacha para handler após filter (own-post guard + mention guard).
- `normalize.ts` converte `Post` (SDK type) → `MattermostMessageEvent`. Channel type detection: `client.getChannel(channelId).type` → mapping (D402).
- `filters.ts` exporta `shouldRespond(post, channelType, botUserId, requireMention)`.

#### Deep Dives

**Filter pipeline (D403):** ordem importa.
1. `post.user_id === botUserId` → ignore (loop guard D275 mirror)
2. `channelType === "D"` (DM) → respond (sempre)
3. `requireMention === false` → respond
4. `botUserId in post.metadata.mentions` (array de userIds) → respond — **PRIORITY** (D403 + EC-2)
5. Fallback: `new RegExp(\`\\\\b@${botUsername}\\\\b\`).test(post.message)` (**word-boundary** obrigatório — EC-2 absorbido) → respond
6. Else → ignore

**EC-2 absorbido — mention regex collision:** Bot username `theo` + user `@theory_dept` em mesma sala — substring match `@theo` disparava dispatch errado. Fix: priorizar `metadata.mentions` array (já entregue pela API, sem ambiguidade) E quando cair em text fallback usar word-boundary `\b@${botUsername}\b`.

#### Tasks
1. `normalize.ts` — Post → MessageEvent com channel-type lookup
2. `filters.ts` — `shouldRespond` pipeline
3. `adapter.ts` — connect/disconnect/onInbound/sendMessage
4. `sendMessage()`: type=thread → `root_id: topicId`; type=dm/group → no root_id
5. Tests: ≥10 normalize tests, ≥8 filter tests, ≥10 adapter tests

#### TDD

```
RED:     test_normalize_dm_channel_type() — D channel → "dm"
RED:     test_normalize_thread_post_sets_topicId() — root_id set → channel.type="thread" + topicId=root_id
RED:     test_normalize_root_post_no_topicId() — root_id empty → topicId undefined
RED:     test_filter_ignores_own_posts() — post.user_id=bot → no dispatch
RED:     test_filter_dm_no_mention_required() — DM → dispatch even without @mention
RED:     test_filter_channel_requires_mention_default() — channel + no @mention → ignore
RED:     test_filter_channel_with_mention_dispatches() — channel + @mention → dispatch
RED:     test_filter_requireMention_false_ignores_mention_check() — opt-out
RED:     test_filter_word_boundary_no_substring_match() — (EC-2) bot "theo" + post "@theory" → ignore
RED:     test_filter_prefers_metadata_mentions_over_text() — (EC-2) mentions array só com bot.id → dispatch mesmo se text não tem "@bot"
RED:     test_send_message_returns_permission_denied_on_403() — (EC-9) mock 403 → SendResult.error.code="permission_denied"
RED:     test_adapter_send_to_thread_uses_root_id()
RED:     test_adapter_send_to_dm_no_root_id()
RED:     test_adapter_onInbound_replaces_handler()
GREEN:   Implementar adapter + normalize + filters
REFACTOR: Extract channelTypeFromMattermost helper se útil
VERIFY:  pnpm --filter @usetheo/gateway-mattermost test
```

#### Acceptance Criteria
- [ ] `MattermostAdapter` 100% interface BasePlatformAdapter
- [ ] requireMention=true default
- [ ] Thread mapping bidirecional
- [ ] ≥28 unit tests
- [ ] Build verde, publint+attw clean
- [ ] LoC ≤400/arquivo

#### DoD
- [ ] Tarefas 1-5 concluídas, tests verde

---

### T2.3 — Example app + live smoke + docs

#### Objective
`examples/mattermost-bot/` + live smoke env-gated + concept page.

#### Files to edit
```
examples/mattermost-bot/package.json (NEW)
examples/mattermost-bot/.env.example (NEW)
examples/mattermost-bot/src/index.ts (NEW)
examples/mattermost-bot/README.md (NEW)
packages/gateway-mattermost/tests/integration/live.test.ts (NEW)
theo-opendocs/content/theokit-sdk/concepts/gateway-mattermost.mdx (NEW)
packages/gateway-mattermost/CHANGELOG.md
CHANGELOG.md
```

#### Deep Dives
README walkthrough estrutura: criar Mattermost server (Docker compose ou Mattermost Cloud trial), criar bot account, gerar PAT, configurar `.env`, `pnpm start`.

#### Tasks
1. Example scaffold
2. README walkthrough
3. Live smoke env-gated (`MATTERMOST_LIVE_SMOKE=1`)
4. Concept page MDX
5. CHANGELOG entradas

#### TDD
```
RED:     test_example_typechecks()
RED:     test_live_smoke_skipped_default()
GREEN:   Escrever example + docs
VERIFY:  pnpm typecheck && pnpm --filter @usetheo/gateway-mattermost test
```

#### Acceptance Criteria
- [ ] Example funcional
- [ ] Live smoke env-gated registrado
- [ ] Concept page live
- [ ] CHANGELOG ship

#### DoD
- [ ] Tarefas 1-5 concluídas

---

## Phase 3: LINE — `@usetheo/gateway-line`

**Objective:** Shipar `@usetheo/gateway-line@0.1.0` com webhook server, reply-token-vs-push API switching, signature HMAC-SHA256, mentionee array handling. Vertical: APAC consumer.

### T3.1 — Scaffold + LINE bot SDK + signature

#### Objective
Workspace `packages/gateway-line/`, peer-dep `@line/bot-sdk@^9.0.0`, signature middleware.

#### Files to edit
```
packages/gateway-line/package.json (NEW)
packages/gateway-line/tsconfig.json (NEW)
packages/gateway-line/tsup.config.ts (NEW)
packages/gateway-line/biome.json (NEW)
packages/gateway-line/CHANGELOG.md (NEW)
packages/gateway-line/README.md (NEW)
packages/gateway-line/src/index.ts (NEW)
packages/gateway-line/src/client.ts (NEW)
packages/gateway-line/src/signature.ts (NEW)
packages/gateway-line/src/errors.ts (NEW)
packages/gateway-line/src/types.ts (NEW)
```

#### Deep Dives

**Signature middleware (D408):**

```ts
import crypto from "node:crypto";

export function verifyLineSignature(channelSecret: string, body: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", channelSecret).update(body).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

Express middleware wrapping `verifyLineSignature` — falha = 401.

#### Tasks
1. Package scaffold
2. `signature.ts` + tests (4 tests: valid/invalid/empty/timing-safe)
3. `client.ts` — wrap `@line/bot-sdk` Client (lazy import)
4. README + CHANGELOG skeleton

#### TDD
```
RED:     test_signature_valid_accepts()
RED:     test_signature_invalid_rejects()
RED:     test_signature_empty_rejects()
RED:     test_signature_uses_timing_safe_equal() — não strcmp
GREEN:   Implementar signature
VERIFY:  pnpm --filter @usetheo/gateway-line test
```

#### Acceptance Criteria
- [ ] Package scaffold
- [ ] Signature 4 tests verde
- [ ] Client wrapper

#### DoD
- [ ] Tarefas 1-4 concluídas

---

### T3.2 — `LineAdapter` + reply-token cache + normalize

#### Objective
`LineAdapter` com mapa LRU `(userId → replyToken + expiry)`, fallback automático para push API, normalize event LINE → MessageEvent.

#### Files to edit
```
packages/gateway-line/src/adapter.ts (NEW)
packages/gateway-line/src/normalize.ts (NEW)
packages/gateway-line/src/reply-cache.ts (NEW)
packages/gateway-line/src/webhook-server.ts (NEW)
packages/gateway-line/src/split.ts (NEW)
packages/gateway-line/tests/adapter.test.ts (NEW)
packages/gateway-line/tests/normalize.test.ts (NEW)
packages/gateway-line/tests/reply-cache.test.ts (NEW)
packages/gateway-line/tests/split.test.ts (NEW)
```

#### Deep Dives

**`reply-cache.ts` (D407):**

```ts
const TTL_MS = 60_000;
const CAPACITY = 1000;

export class ReplyTokenCache {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();
  put(userId: string, token: string): void {
    if (this.cache.size >= CAPACITY) this.evictOldest();
    this.cache.set(userId, { token, expiresAt: Date.now() + TTL_MS });
  }
  take(userId: string): string | undefined {
    const entry = this.cache.get(userId);
    if (entry === undefined) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(userId);
      return undefined;
    }
    this.cache.delete(userId); // one-shot
    return entry.token;
  }
}
```

**`sendMessage` flow:**
1. Try `cache.take(userId)` → if token: `client.replyMessage(token, ...)` 
2. Else: warn stderr "reply token expired" + `client.pushMessage(userId, ...)`

**`normalize.ts` mentionee handling (D409):**

```ts
// EC-4 absorbido — LINE webhook entrega muitos tipos (message/follow/unfollow/postback/beacon/join/leave).
// Filtrar ANTES de acessar event.message (que é undefined para outros tipos).
if (event.type !== "message") return undefined; // skip dispatch
if (event.message.type !== "text") return undefined; // v0.1 só texto; image/audio/sticker → skip + warn stderr

const mentionees: string[] = event.message.mentionees?.map((m) => m.userId) ?? [];
const channel = mapSourceType(event.source); // user→dm, group/room→group
```

**`split.ts`:** `splitForLine(text, limit=5000)` — surrogate-safe via Intl.Segmenter (mesmo pattern de SMS).

#### Tasks
1. `reply-cache.ts` + tests (LRU + TTL + one-shot)
2. `normalize.ts` — event LINE → MessageEvent
3. `split.ts` — 5000 char split
4. `webhook-server.ts` — Express with signature middleware
5. `adapter.ts` — connect/disconnect/onInbound/sendMessage (reply→push fallback)
6. Tests ≥25

#### TDD

```
RED:     test_reply_cache_one_shot() — second take() returns undefined
RED:     test_reply_cache_expires_after_60s() — fake timer +61s → undefined
RED:     test_reply_cache_capacity_evicts_oldest()
RED:     test_normalize_user_source_to_dm()
RED:     test_normalize_group_source_to_group()
RED:     test_normalize_mentionees_extracted()
RED:     test_normalize_filters_follow_event_returns_undefined() — (EC-4) follow event → undefined, no dispatch
RED:     test_normalize_filters_non_text_message_returns_undefined() — (EC-4) image message → undefined
RED:     test_normalize_filters_postback_event() — (EC-4) postback → undefined
RED:     test_split_long_message_5000_safe()
RED:     test_adapter_send_uses_reply_token_first()
RED:     test_adapter_send_falls_back_to_push_after_expiry()
RED:     test_adapter_signature_invalid_rejects_401()
RED:     test_adapter_onInbound_replaces_handler()
GREEN:   Implementar
REFACTOR: None
VERIFY:  pnpm --filter @usetheo/gateway-line test
```

#### Acceptance Criteria
- [ ] Reply token cache LRU + TTL
- [ ] Mentionee extraction
- [ ] Push fallback automático
- [ ] ≥25 unit tests
- [ ] Build verde

#### DoD
- [ ] Tarefas 1-6 concluídas

---

### T3.3 — Example + live smoke + docs

#### Objective
`examples/line-bot/` + live smoke + concept page.

#### Files to edit
```
examples/line-bot/package.json (NEW)
examples/line-bot/.env.example (NEW)
examples/line-bot/src/index.ts (NEW)
examples/line-bot/README.md (NEW)
packages/gateway-line/tests/integration/live.test.ts (NEW)
theo-opendocs/content/theokit-sdk/concepts/gateway-line.mdx (NEW)
packages/gateway-line/CHANGELOG.md
CHANGELOG.md
```

#### Tasks
1. Example scaffold + README (LINE Console + Channel ID + Token walkthrough)
2. Live smoke (LINE_LIVE_SMOKE=1 + push-only API call)
3. Concept page
4. CHANGELOG entries

#### TDD
```
RED:     test_example_typechecks()
RED:     test_live_smoke_skipped_default()
GREEN:   Write
VERIFY:  pnpm typecheck
```

#### Acceptance Criteria
- [ ] Example funcional
- [ ] Live smoke env-gated
- [ ] Docs live

#### DoD
- [ ] Tarefas 1-4 concluídas

---

## Phase 4: Matrix — `@usetheo/gateway-matrix`

**Objective:** Shipar `@usetheo/gateway-matrix@0.1.0` com `matrix-js-sdk` sync loop, room state, DM detection via member count, alias resolution, E2EE deferred. Vertical: open-source federation.

### T4.1 — Scaffold + matrix-js-sdk client + sync loop

#### Objective
Workspace `packages/gateway-matrix/`, peer-dep `matrix-js-sdk@^32.0.0`, MatrixClient setup com `startClient`.

#### Files to edit
```
packages/gateway-matrix/package.json (NEW)
packages/gateway-matrix/tsconfig.json (NEW)
packages/gateway-matrix/tsup.config.ts (NEW)
packages/gateway-matrix/biome.json (NEW)
packages/gateway-matrix/CHANGELOG.md (NEW)
packages/gateway-matrix/README.md (NEW)
packages/gateway-matrix/src/index.ts (NEW)
packages/gateway-matrix/src/client.ts (NEW)
packages/gateway-matrix/src/sync.ts (NEW)
packages/gateway-matrix/src/room-state.ts (NEW)
packages/gateway-matrix/src/errors.ts (NEW)
packages/gateway-matrix/src/types.ts (NEW)
```

#### Deep Dives

**`client.ts` (D413, D414):**

```ts
import * as sdk from "matrix-js-sdk"; // lazy

export interface MatrixClientOptions {
  homeserverUrl: string;       // ex: "https://matrix.org"
  accessToken: string;          // syt_xxx
  userId: string;               // @bot:matrix.org
}

export class MatrixClientWrapper {
  private client: sdk.MatrixClient | undefined;
  async connect(opts: MatrixClientOptions): Promise<boolean> {
    this.client = sdk.createClient(opts);
    await this.client.startClient({ initialSyncLimit: 10 });
    return true;
  }
  async disconnect(): Promise<void> {
    this.client?.stopClient();
    this.client = undefined;
  }
  getClient(): sdk.MatrixClient { /* throws if !connected */ }
}
```

**`room-state.ts` (D416):**

```ts
export function detectChannelType(room: sdk.Room): "dm" | "group" {
  return room.getJoinedMemberCount() === 2 ? "dm" : "group";
}
```

**`sync.ts`** — wrapper de `client.on("Room.timeline", listener)` filtrando para `m.room.message` events:

```ts
// EC-3 absorbido — sync inicial entrega últimas N events POR ROOM. Bot em 50 rooms = 500 events
// no bootstrap → 500 LLM calls + custo. Filtrar eventos < 60s preserva apenas live mensagens.
const FRESHNESS_WINDOW_MS = 60_000;

export function subscribeToTimeline(client: sdk.MatrixClient, handler: (event: sdk.MatrixEvent, room: sdk.Room) => void): () => void {
  const wrapped = (event: sdk.MatrixEvent, room: sdk.Room) => {
    if (event.getType() !== "m.room.message") return;
    if (event.getSender() === client.getUserId()) return; // loop guard
    if (event.getTs() < Date.now() - FRESHNESS_WINDOW_MS) return; // EC-3 — skip sync flood
    handler(event, room);
  };
  client.on("Room.timeline", wrapped);
  return () => client.off("Room.timeline", wrapped);
}
```

#### Tasks
1. Package scaffold com peer-dep `matrix-js-sdk@^32.0.0`
2. `client.ts` — lazy import + connect/disconnect
3. `sync.ts` — timeline subscription
4. `room-state.ts` — channel type detection
5. `errors.ts` — ConnectionError, EncryptedRoomRejectedError
6. README + CHANGELOG skeleton

#### TDD
```
RED:     test_client_connect_starts_sync()
RED:     test_client_disconnect_stops_client()
RED:     test_sync_filters_non_message_events()
RED:     test_sync_ignores_own_messages()
RED:     test_sync_filters_events_older_than_60s() — (EC-3) event.getTs = now-90_000 → not dispatched
RED:     test_sync_dispatches_fresh_events() — (EC-3) event.getTs = now-5_000 → dispatched
RED:     test_detect_channel_type_dm_with_2_members()
RED:     test_detect_channel_type_group_with_3_members()
RED:     test_encrypted_room_rejected_with_warn() — D418
GREEN:   Implementar
VERIFY:  pnpm --filter @usetheo/gateway-matrix test
```

#### Acceptance Criteria
- [ ] Scaffold + client + sync + room-state
- [ ] ≥7 unit tests
- [ ] E2EE rejection com warn stderr

#### DoD
- [ ] Tarefas 1-6 concluídas

---

### T4.2 — Alias resolution + `MatrixAdapter` + normalize

#### Objective
`MatrixAdapter` com alias→room ID resolution na conexão, normalize `MatrixEvent → MatrixMessageEvent`, send via `client.sendTextMessage`.

#### Files to edit
```
packages/gateway-matrix/src/adapter.ts (NEW)
packages/gateway-matrix/src/normalize.ts (NEW)
packages/gateway-matrix/src/alias.ts (NEW)
packages/gateway-matrix/tests/adapter.test.ts (NEW)
packages/gateway-matrix/tests/normalize.test.ts (NEW)
packages/gateway-matrix/tests/alias.test.ts (NEW)
```

#### Deep Dives

**`alias.ts` (D419):**

```ts
export async function resolveRoomAlias(client: sdk.MatrixClient, aliasOrId: string): Promise<string> {
  if (aliasOrId.startsWith("!")) return aliasOrId; // já é room ID
  if (!aliasOrId.startsWith("#")) throw new ConfigurationError({ code: "invalid_room_ref" });
  const { room_id } = await client.getRoomIdForAlias(aliasOrId);
  return room_id;
}
```

**`normalize.ts` (D421):**

```ts
export function normalizeMatrixEvent(event: sdk.MatrixEvent, room: sdk.Room, client: sdk.MatrixClient): MatrixMessageEvent {
  const channelType = detectChannelType(room);
  return {
    id: event.getId() ?? "",
    platform: "matrix",
    sender: { id: event.getSender() ?? "", displayName: event.sender?.name },
    channel: { id: room.roomId, type: channelType },
    text: event.getContent().body ?? "",
    receivedAt: event.getTs(),
    matrix: {
      roomId: room.roomId,
      eventId: event.getId() ?? "",
      memberCount: room.getJoinedMemberCount(),
      raw: event,
    },
  };
}
```

**Edge case:** `event.getContent().body` pode ser undefined para event types não-text (image/file/audio). Skip ou retornar com text="".

#### Tasks
1. `alias.ts` — `resolveRoomAlias` + tests
2. `normalize.ts` — `normalizeMatrixEvent` + tests
3. `adapter.ts` — MatrixAdapter completo (connect/disconnect/sendMessage/onInbound)
4. Tests ≥20

#### TDD
```
RED:     test_alias_resolves_to_room_id()
RED:     test_alias_passthrough_if_already_room_id()
RED:     test_alias_invalid_throws()
RED:     test_normalize_dm_channel_type()
RED:     test_normalize_group_channel_type()
RED:     test_normalize_extracts_sender_displayName()
RED:     test_adapter_send_to_room_id()
RED:     test_adapter_send_to_alias_resolves_then_sends()
RED:     test_adapter_inbound_dispatch_filters_encrypted_room()
RED:     test_adapter_onInbound_replaces_handler()
GREEN:   Implementar
VERIFY:  pnpm --filter @usetheo/gateway-matrix test
```

#### Acceptance Criteria
- [ ] Alias resolution
- [ ] Normalize completo
- [ ] Adapter 100% interface
- [ ] ≥20 unit tests
- [ ] Build verde, publint+attw clean

#### DoD
- [ ] Tarefas 1-4 concluídas

---

### T4.3 — Example + live smoke + docs

#### Objective
`examples/matrix-bot/` + live smoke + concept page.

#### Files to edit
```
examples/matrix-bot/package.json (NEW)
examples/matrix-bot/.env.example (NEW)
examples/matrix-bot/src/index.ts (NEW)
examples/matrix-bot/README.md (NEW)
packages/gateway-matrix/tests/integration/live.test.ts (NEW)
theo-opendocs/content/theokit-sdk/concepts/gateway-matrix.mdx (NEW)
packages/gateway-matrix/CHANGELOG.md
CHANGELOG.md
```

#### Tasks
1. Example com README walkthrough (matrix.org account, gerar access token via Element)
2. Live smoke (`MATRIX_LIVE_SMOKE=1`)
3. Concept page MDX
4. CHANGELOG entries

#### TDD
```
RED:     test_example_typechecks()
RED:     test_live_smoke_skipped_default()
GREEN:   Write
VERIFY:  pnpm typecheck
```

#### Acceptance Criteria
- [ ] Example
- [ ] Live smoke env-gated
- [ ] Docs

#### DoD
- [ ] Tarefas 1-4 concluídas

---

## Phase 5: Cross-cutting — Workspace CHANGELOG + Dogfood Suite Update

**Objective:** Atualizar artefatos transversais que dependem dos 4 packages estarem prontos.

### T5.1 — Workspace CHANGELOG + CLAUDE.md roadmap close-out

#### Files to edit
```
CHANGELOG.md — entradas Added para os 4 packages
CLAUDE.md — fechar v1.5 "Gateway Expansion" no Adoption Roadmap, marcar 4 itens como DONE com data
```

#### Tasks
1. CHANGELOG workspace `[Unreleased]` — 4 entries `Added — @usetheo/gateway-{name}@0.1.0`
2. CLAUDE.md — adicionar seção "Adoption Roadmap v1.5 — Gateway Expansion" abaixo de v1.4, marcar 4 itens DONE com data 2026-XX-XX
3. Listar nos blocos "Não-Roadmap-v1.5" itens deferidos (Signal/iMessage/WeChat/Feishu/Dingtalk com motivo)

#### Acceptance Criteria
- [ ] CHANGELOG ship
- [ ] CLAUDE.md roadmap atualizado

#### DoD
- [ ] Tarefas 1-3 concluídas

---

### T5.2 — Dogfood suite update (telegram-pro regression sanity)

#### Files to edit
```
.claude/skills/dogfood/lib/dogfood.mjs — verificar que 44/44 ainda passa (regression sanity)
```

#### Tasks
1. Rodar `node .claude/skills/dogfood/lib/dogfood.mjs --user-id 7528967933` — esperar 44/44 PASS
2. Se regressão, investigar (mas com Phase 0 sendo backward-compat additive, não deve haver)

#### Acceptance Criteria
- [ ] 44/44 PASS no telegram-pro dogfood

#### DoD
- [ ] Run sucesso

---

## Phase 6: Dogfood QA (MANDATORY)

**Objective:** Validar fim-a-fim que os 4 novos gateways funcionam como library no mundo real.

### Execution

Este plano NÃO tem dogfood telegram-style (não há "matrix-pro" bot equivalente). Em vez disso:

1. **Live smoke env-gated** (4 testes): SMS_LIVE_SMOKE, MATTERMOST_LIVE_SMOKE, LINE_LIVE_SMOKE, MATRIX_LIVE_SMOKE rodados manualmente com creds reais antes de declarar PASS. Cada um envia 1 mensagem real e verifica delivery.

2. **telegram-pro regression sanity**: 44/44 PASS confirma que extensão do `PlatformName` union (Phase 0) não quebra os 6 gateways existentes.

3. **Build matrix**: `pnpm -r typecheck && pnpm -r build && pnpm -r test` workspace-wide tudo verde.

4. **Publint + attw**: 4 novos packages 100% verde.

### Acceptance Criteria

- [ ] Live smoke SMS via Twilio test creds: 1 SMS enviado e recebido
- [ ] Live smoke Mattermost: server (cloud trial OK), bot envia + recebe
- [ ] Live smoke LINE: 1 push API call sucesso
- [ ] Live smoke Matrix: matrix.org account, 1 room, bot envia + recebe
- [ ] `telegram-pro` dogfood 44/44 PASS (zero regressão)
- [ ] `pnpm -r typecheck` clean
- [ ] `pnpm -r build` clean
- [ ] `pnpm -r test` workspace ≥1900 tests verde (SDK ~1870 + ~60-80 novos por gateway × 4)
- [ ] 4 packages publint+attw 100% verde
- [ ] LoC check ≤400 todos arquivos novos

### If Dogfood Fails

1. Live smoke fail = bug no adapter — investigar log + ajustar
2. telegram-pro regressão = Phase 0 quebrou algo — revisar PlatformName union update
3. Build/test fail = lint/type — ajustar

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Vertical telecom/SMS ausente | T0.1, T1.1, T1.2, T1.3, T1.4 | `@usetheo/gateway-sms` shipado com 3 backends + multipart |
| 2 | Self-hosted enterprise sem option | T0.1, T2.1, T2.2, T2.3 | `@usetheo/gateway-mattermost` shipado com WebSocket + threads |
| 3 | APAC consumer (LINE) descoberto | T0.1, T3.1, T3.2, T3.3 | `@usetheo/gateway-line` shipado com reply-token cache + push fallback |
| 4 | Decentralized/federation sem option | T0.1, T4.1, T4.2, T4.3 | `@usetheo/gateway-matrix` shipado com sync loop + alias resolution |
| 5 | `PlatformName` união precisa estender | T0.1 | 10 platforms na união (era 6) |
| 6 | `MessageEvent` variants precisam compilar | T0.1 | 4 novas interfaces stub em gateway core |
| 7 | Caller precisa de exemplos | T1.4, T2.3, T3.3, T4.3 | 4 example apps com README walkthrough |
| 8 | Documentação navegável precisa atualizar | T1.4, T2.3, T3.3, T4.3 | 4 concept pages em `theo-opendocs` |
| 9 | Live smoke env-gated obrigatório por regra | T1.4, T2.3, T3.3, T4.3 | 4 live smoke env-gated |
| 10 | Telegram-pro regression sanity | T5.2 | dogfood 44/44 PASS confirmado |
| 11 | ADRs registrados | T1-T4 | D389-D421 (33 decisões) |
| 12 | CHANGELOG ship | T5.1 | Workspace + 4 package CHANGELOGs |
| 13 | CLAUDE.md roadmap fechado | T5.1 | v1.5 Gateway Expansion DONE entry |

**Coverage: 13/13 (100%)**

## Global Definition of Done

- [ ] Todas as Phases 0-6 concluídas
- [ ] Todos os tests workspace verde (`pnpm -r test`)
- [ ] Zero lint warnings (`pnpm check`)
- [ ] Backward compatibility preservada (6 gateways existentes continuam funcionais — telegram-pro 44/44 prova)
- [ ] `pnpm -r build` clean (4 novos packages produzem dist válidos)
- [ ] `pnpm -r publint && pnpm -r attw` clean
- [ ] `node tools/check-loc.mjs` G8 ≤400 LoC todos arquivos novos
- [ ] 4 example apps em `examples/{sms,mattermost,line,matrix}-bot/` funcionais
- [ ] 4 live smoke tests env-gated (skip default, opt-in via env)
- [ ] 4 concept pages em `theo-opendocs/content/theokit-sdk/concepts/`
- [ ] 33 ADRs (D389-D421) ship em `.claude/knowledge-base/adrs/`
- [ ] CHANGELOG workspace + 4 package CHANGELOGs com entries `Added`
- [ ] CLAUDE.md Adoption Roadmap v1.5 close-out
- [ ] **Dogfood QA PASS** — telegram-pro 44/44 + 4 live smokes opt-in confirmados (quando creds disponíveis)
- [ ] **Runtime-metric proof** — cada gateway: env-gated live smoke envia 1 mensagem real e confirma delivery via SDK return value (não apenas typecheck/test)

---

## Post-Plan Hooks

### Edge case review (mandatory)

Após salvar este plano, invocar:

```
/edge-case-plan gateway-tier-1-expansion
```

para análise pragmática de edge cases não previstos. Aplicar MUST FIX items ao plano antes de Phase 0.

### Cross-validation (após implementação)

Antes de `/dogfood`, invocar:

```
/cross-validation gateway-tier-1-expansion
```

para conferir que cada tarefa do plano tem código correspondente.

### Architecture diff (após dogfood PASS)

Após dogfood PASS, invocar:

```
/architecture-docs gateway --output-dir diff
```

para capturar novo C4 (10 platforms vs 6 anteriores) e confirmar com user antes de substituir docs principais.
