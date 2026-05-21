# Edge Case Review — usetheo-gateway-v01

Data: 2026-05-20
Tasks analisadas: 15 (T0.1–T9.2 + Phase 10)
Edge cases encontrados: 16 (MUST FIX: 7, SHOULD TEST: 5, DOCUMENT: 4)

## MUST FIX

### EC-A: Slash command boundary — `/skill` rouba `/skills`
- **Task afetada:** T7.1 (sugar `runner.command(name, handler)`)
- **Família:** Input / Format
- **Cenário:** O plano implementa `runner.command(name, handler)` como hook que faz `text.startsWith("/" + name)`. Telegram-pro tem tanto `/skill` quanto `/skills`. Quando o usuário manda `/skills`, `startsWith("/skill")` casa primeiro → o handler de `/skill` rouba a mensagem.
- **Impacto:** Comandos com prefixo compartilhado quebram silenciosamente. `/skills`, `/loop` vs `/loops`, `/stop_loop` vs `/stop_loops` (todos existem em telegram-pro).
- **Fix:** Matcher exato com word boundary — `text === "/" + name || text.startsWith("/" + name + " ") || text.startsWith("/" + name + "@" + botUsername)`. O `@botUsername` cobre grupos Telegram onde commands vêm com sufixo `@bot`.

### EC-B: `topicId` undefined num thread channel gera split-brain de sessão
- **Task afetada:** T2.1 (defaultStrategy)
- **Família:** State
- **Cenário:** `defaultStrategy` para `channel.type === "thread"` retorna `${platform}-tpc-${channel.id}-${channel.topicId}`. Se o adapter normaliza um thread event mas esquece `topicId` (Telegram forum topic pode aparecer sem `message_thread_id` em mensagens não-thread), o template emite `...-undefined`.
- **Impacto:** Sessão `tg-tpc-123-undefined` é criada; quando o `topicId` real chegar depois, nova sessão começa. Histórico fragmentado entre duas keys.
- **Fix:** Em `defaultStrategy`, assert `channel.topicId !== undefined` no case `"thread"`; senão fallback para `${platform}-grp-${channel.id}-${sender.id}` (trata como group).

### EC-C: Discord intents default — silent failure se vazio
- **Task afetada:** T6.1 (DiscordAdapter)
- **Família:** Format / Boundary
- **Cenário:** `DiscordAdapterOptions.intents?: GatewayIntentBits[]`. Default não especificado. discord.js exige intents explícitas — sem `MessageContent`, o `msg.content` chega vazio. Usuário cria adapter sem passar intents → bot logueia, conecta, mas NUNCA recebe `text` populado.
- **Impacto:** Silent failure — pior tipo. Bot parece OK no log mas não responde.
- **Fix:** Default = `[Guilds, GuildMessages, MessageContent, DirectMessages, DirectMessageReactions]`. Se user passar `intents: []` (explícito), log warn no `connect()`.

### EC-D: `block: true` com `message` é dead feature OU implementação faltando
- **Task afetada:** T4.1 (HookExecutor + GatewayRunner integration)
- **Família:** State
- **Cenário:** Plano define `HookDecision = { block?: boolean; message?: string }` e diz "the runner can optionally reply with that message (Phase 5 wires this)". Mas Phase 5 (Telegram adapter) não menciona auto-reply. Field órfão.
- **Impacto:** Field documentado mas nunca implementado → user passa `{ block: true, message: "rate-limited" }` e nada acontece. Confusing API.
- **Fix:** Adicionar 3 linhas em `GatewayRunner.start()`: quando `firePreInbound` retorna `{ block: true, message }`, chamar `ctx.reply(message)` antes de short-circuit. Documentar.

### EC-E: Handler in-flight durante `stop()` — comportamento não especificado
- **Task afetada:** T1.3 (GatewayRunner)
- **Família:** Timing / State
- **Cenário:** `stop()` desconecta adapters imediatamente. Se há handler executando (`agent.send` esperando LLM por 30s), ele vai tentar `ctx.reply()` num adapter desconectado → SendResult error perdido (ninguém checa).
- **Impacto:** Mensagens silenciosamente não enviadas em deploy/restart graceful. Em telegram-pro o `/stream` mode é especialmente sensível.
- **Fix:** `stop()` espera in-flight handlers terminarem (max 10s) antes de desconectar. Após timeout, força desconexão. Padrão "drain timeout" — 3 linhas em `stop()`.

### EC-F: Tokens vazam em logs de erro
- **Task afetada:** T1.3 + T5.1 + T6.1 (todos os adapters)
- **Família:** Permission / Security
- **Cenário:** grammy/discord.js erros em `connect()` podem incluir o token no error message ou stack trace. `console.error(err)` no GatewayRunner vaza pra stdout/stderr → docker logs → CI logs → secret leak.
- **Impacto:** Secret leak. ADR D68 (`Security.redact`) existe exatamente pra isso e não é usado.
- **Fix:** Importar `Security` do SDK e envolver TODOS os log paths: `console.error(Security.redact(String(err)))`. Reusa o pattern de D68.

### EC-G: `ctx.reply` precisa rotear via `event.platform` — não documentado
- **Task afetada:** T1.3 (GatewayContext)
- **Família:** Integração
- **Cenário:** `GatewayContext.reply()` no plano não especifica COMO escolhe o adapter. Em multi-adapter setup (Telegram + Discord rodando juntos), reply do evento Telegram deve ir via TelegramAdapter.
- **Impacto:** Implementação ambígua → bug na primeira execução com 2 adapters.
- **Fix:** No `GatewayRunner.start()`, criar `ctx` por evento: `ctx = { event, reply: (text, opts) => adaptersByPlatform.get(event.platform).sendMessage({ channel: event.channel, text, ...opts }) }`. 4 linhas, mas tem que estar no plano.

## SHOULD TEST

### EC-H: `onInbound(handler)` chamado 2x — substitui ou empilha?
- **Task afetada:** T1.2 (BasePlatformAdapter)
- **Teste sugerido:** `test_mock_adapter_inbound_replaces_previous_handler` — chamar `onInbound(h1)`, então `onInbound(h2)`, emitir evento; assertar que SÓ `h2` foi chamado.
- **Por quê:** Comportamento mais previsível para o runner (que registra uma vez). Empilhar handlers cria dispatching duplicado se `start()` for chamado 2x.

### EC-I: Telegram token inválido — `connect()` deve retornar `false`, não throw
- **Task afetada:** T5.1 (TelegramAdapter)
- **Teste sugerido:** `test_telegram_adapter_connect_invalid_token_returns_false` — token fake, assertar que `connect()` resolve para `false` (não rejeita).
- **Por quê:** Contrato T1.2 invariante "connect retorna bool, não throw". grammy `bot.start()` pode rejeitar em token bad — adapter precisa do try/catch.

### EC-J: `splitForTelegram` em markdown crossing boundary
- **Task afetada:** T5.1 (TelegramAdapter — splitForTelegram migrado)
- **Teste sugerido:** `test_split_preserves_markdown_pairs` — input `**bold ` repetido até passar 4096 chars cruzando um `**` — assertar que cada chunk tem markdown válido OU o split degrada para parse_mode plain.
- **Por quê:** Telegram retorna 400 markdown_parse_error se tags ficam quebradas. Já vimos esse modo de falha na dogfood suite (skill notes).

### EC-K: Telegram bot recebendo mensagem de outro bot
- **Task afetada:** T5.1 (TelegramAdapter normalizeEvent)
- **Teste sugerido:** `test_telegram_adapter_ignores_messages_from_other_bots` — `ctx.from.is_bot === true` → adapter NÃO emite o evento.
- **Por quê:** Discord adapter já filtra (`msg.author.bot`). Telegram não menciona. Bot-to-bot loops em grupos é real (improvável, mas o fix é uma linha).

### EC-L: Hook execution order preservada na migração
- **Task afetada:** T7.1 (telegram-pro migration — bot.use → pre_inbound)
- **Teste sugerido:** `test_telegram_pro_hook_order_allowlist_before_handler` — registrar mock allowlist + mock handler hooks; mandar evento; assertar allowlist roda PRIMEIRO.
- **Por quê:** O `bot.use(...)` middleware atual no telegram-pro tem 2 stages (redact logger → allowlist). Se a migration troca a ordem, allowlist passa a logar antes de filtrar, vazando IDs de usuários não-autorizados.

## DOCUMENT

### EC-M: `DeliveryRouter.register()` sem `adapter.connect()` resulta em send falhar
- **Risco aceito:** User errors são responsabilidade do user. Adapter já retorna `{ ok: false, error: { code: "disconnected" } }`. Doc no README diz "register adapters BEFORE start, start BEFORE send".

### EC-N: Hook timeout não previsto — hook lento bloqueia handler
- **Risco aceito:** Hooks são in-process user code. Timeout configurável aumenta API surface. Por ora documentar "keep hooks under 200ms" no README. Se virar problema real (3+ relatos), adicionar `hookTimeoutMs` option.

### EC-O: `startTyping` em chat inexistente — Telegram retorna 400
- **Risco aceito:** Adapter pega o erro e segue silenciosamente. Typing é cosmetic — se falhar, nada quebra. Documentar inline no JSDoc.

### EC-P: Voice/photo handlers via escape hatch — ergonomia ruim mas funcional
- **Risco aceito:** v0.1 é portable-first (D180). Voice handler em telegram-pro vira `runner.onInbound(e => if (e.telegram?.raw.message?.voice) ...)`. Roda em toda mensagem só pra checar. Documentar; v0.2 considera `runner.onMediaType("voice", handler)`.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.2 | 1 | 0 | 1 | 0 |
| T1.3 | 3 | 3 | 0 | 0 |
| T2.1 | 1 | 1 | 0 | 0 |
| T3.1 | 1 | 0 | 0 | 1 |
| T4.1 | 2 | 1 | 0 | 1 |
| T5.1 | 4 | 1 (transversal F) | 3 | 1 |
| T6.1 | 1 | 1 | 0 | 0 |
| T7.1 | 2 | 1 | 1 | 1 |
| **Total** | **16** | **7** | **5** | **4** |

**Veredicto:** PLANO PRECISA DE AJUSTE

**Prioridade de incorporação:** as 7 MUST FIX são reais e baratas (cada uma é ≤5 linhas de código ou ≤1 frase no plano). EC-A (slash boundary) e EC-C (Discord intents) são silent failures — os piores. EC-F (token redaction) é security. Os 3 restantes (EC-B topicId, EC-D dead feature, EC-E drain timeout, EC-G ctx.reply routing) são contract clarity.

As 5 SHOULD TEST viram entries no TDD block das respectivas tasks.

Os 4 DOCUMENT viram notas inline no plano (não geram código).
