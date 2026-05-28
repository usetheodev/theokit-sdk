# Edge Case Review — gateway-tier-1-expansion

Data: 2026-05-28
Tasks analisadas: 14 (T0.1, T1.1–T1.4, T2.1–T2.3, T3.1–T3.3, T4.1–T4.3, T5.1–T5.2)
Edge cases encontrados: 22 (MUST FIX: 5, SHOULD TEST: 6, DOCUMENT: 11)

## MUST FIX (5)

### EC-1: Webhook público sem signing secret obrigatório
- **Task afetada:** T1.1 (SMS scaffold) — afeta também T2.1 (Mattermost) indiretamente, mas Mattermost usa WS+token (não webhook), portanto restrito a SMS.
- **Família:** Permission / Security
- **Cenário:** Caller chama `new SMSAdapter({ backend: "twilio" })` sem passar `authToken`/`signingSecret`. Webhook server inicia em porta pública aceitando QUALQUER POST como inbound autêntico — spoofing trivial.
- **Impacto:** Atacante pode injetar mensagens falsas (impersonação), gerar cost de outbound (caso bot dispare reply), poluir histórico do agente.
- **Fix sugerido:** Constructor valida explicitamente — `if (!opts.authToken) throw new ConfigurationError({ code: "signing_secret_required", message: "SMS webhook requires authToken; webhook would be unsigned" })`. D392 já menciona, mas precisa virar enforcement no construtor (não apenas no `connect()`).
- **Status:** ✅ Absorvido em T1.1 Task 0 + test `test_adapter_constructor_throws_without_signing_secret`.

### EC-2: Mention regex collision em Mattermost (substring match)
- **Task afetada:** T2.2 (Mattermost filter pipeline)
- **Família:** Format / Permission
- **Cenário:** Bot username `theo` + post `@theory_dept sync today` → regex `@theo` faz substring match → bot dispatch.
- **Impacto:** Bot responde a posts que não eram pra ele; cost explosion + UX confusa (bot intrometendo).
- **Fix sugerido:** Priorizar `post.metadata.mentions` array (Mattermost API entrega-o sem ambiguidade); apenas se vazio, cair em regex com word-boundary: `new RegExp(\`\\\\b@${botUsername}\\\\b\`).test(text)`.
- **Status:** ✅ Absorvido em T2.2 Deep Dives (filter pipeline reordenado) + 2 tests novos (`test_filter_word_boundary_no_substring_match`, `test_filter_prefers_metadata_mentions_over_text`).

### EC-3: Matrix initial sync flood
- **Task afetada:** T4.1 (Matrix sync.ts)
- **Família:** Resource / Boundary
- **Cenário:** `client.startClient({ initialSyncLimit: 10 })` entrega últimas 10 events POR ROOM no primeiro sync. Bot membro de 50 rooms → 500 events dispatch no bootstrap → 500 LLM calls em poucos segundos.
- **Impacto:** Cost explosion ($1-5 por boot em produção), rate limits do provider LLM, race conditions no agent loop (multiple concurrent sends).
- **Fix sugerido:** Filtrar em `sync.ts`: `if (event.getTs() < Date.now() - 60_000) return;` — apenas eventos < 60s ao vivo são dispatched. Eventos históricos são ignorados (caller pode rehidratar via Memory namespace se quiser).
- **Status:** ✅ Absorvido em T4.1 Deep Dives (sync.ts wrapper com `FRESHNESS_WINDOW_MS`) + 2 tests novos (`test_sync_filters_events_older_than_60s`, `test_sync_dispatches_fresh_events`).

### EC-4: LINE webhook entrega non-message events (crash em handler)
- **Task afetada:** T3.2 (LINE normalize.ts)
- **Família:** Input / Format
- **Cenário:** LINE webhook entrega 9 tipos de evento (`message`, `follow`, `unfollow`, `join`, `leave`, `postback`, `beacon`, `accountLink`, `things`). Adapter assume `message` e acessa `event.message.text` → `undefined.text` → TypeError.
- **Impacto:** Crash do handler ao primeiro `follow`/`unfollow`; webhook retorna 500 → LINE retry 7x → 7 crashes; bot fica inutilizável.
- **Fix sugerido:** Primeira linha de `normalize.ts`: `if (event.type !== "message") return undefined;` + `if (event.message.type !== "text") return undefined;` (v0.1 só texto; image/sticker/audio deferred para v0.2).
- **Status:** ✅ Absorvido em T3.2 Deep Dives (normalize.ts filter no topo) + 3 tests novos (`test_normalize_filters_follow_event`, `test_normalize_filters_non_text_message`, `test_normalize_filters_postback_event`).

### EC-5: PlatformName union expansion quebra exhaustive switches existentes
- **Task afetada:** T0.1 (Phase 0)
- **Família:** Format / Integration (compile-time)
- **Cenário:** Código existente faz `switch(event.platform) { ...6 cases...; default: const _: never = event.platform; }` para garantir exhaustiveness. Adicionar 4 strings novos no union → TypeScript erro `Type 'sms' is not assignable to type 'never'` em todos os switches.
- **Impacto:** Workspace `pnpm typecheck` quebra em fase de scaffolding; bloqueia TODO o resto do plano até resolver caso-a-caso.
- **Fix sugerido:** Pre-step antes de modificar union: `grep -rn "_exhaustive: never\\|: never = event" packages/ examples/ tools/`. Em cada hit, adicionar handling para 4 novos cases OU mudar default branch para retorno seguro (não-never). Executar antes da modificação da union.
- **Status:** ✅ Absorvido em T0.1 Tasks step 0.

## SHOULD TEST (6)

### EC-6: Toll-free US numbers rejected pela libphonenumber
- **Task afetada:** T1.1 (SMS phone.ts)
- **Teste sugerido:** `test_normalize_e164_toll_free_us_accepted` — asserta `+18001234567` parses sem throw. `libphonenumber-js/mobile` rejeita TOLL_FREE; usar `libphonenumber-js` (full) ou aceitar explicitamente `getType() === "TOLL_FREE"`.
- **Status:** ✅ Test adicionado ao TDD de T1.1.

### EC-7: Multipart SMS reordering at recipient
- **Task afetada:** T1.3 (split.ts)
- **Teste sugerido:** `test_split_for_sms_includes_part_index_prefix` — asserta prefix `(1/N)` está presente em CADA parte. Recipient pode receber chunks fora de ordem (protocolo SMS não garante); prefixo numerado é a única ferramenta de reordenação manual.
- **Status:** Test mencionado, adicionar ao TDD T1.3.

### EC-8: Mattermost WS reconnect backoff cap
- **Task afetada:** T2.1
- **Teste sugerido:** `test_ws_reconnect_backoff_caps_at_30s` — simular 5 disconnects consecutivos, assertar que último delay observado é ≥ 30s e ≤ 31s.

### EC-9: Mattermost permission_denied no sendMessage
- **Task afetada:** T2.2
- **Teste sugerido:** `test_send_message_returns_permission_denied_on_403` — mock 403 response do server → `SendResult.ok === false`, `error.code === "permission_denied"`. Bot pode ser member sem direito de post em canal privado restrito.
- **Status:** ✅ Test adicionado ao TDD de T2.2.

### EC-10: LINE reply token one-shot reuse
- **Task afetada:** T3.2 (reply-cache)
- **Teste sugerido:** `test_two_sequential_send_messages_first_uses_reply_second_uses_push` — caller chama `sendMessage` 2x no mesmo handler. Primeiro usa replyMessage, segundo automaticamente usa pushMessage (cache `take()` é one-shot).

### EC-11: Matrix encrypted content event (m.room.encrypted)
- **Task afetada:** T4.2 (normalize.ts)
- **Teste sugerido:** `test_normalize_encrypted_event_returns_empty_text` OU `test_normalize_filters_encrypted_events_returns_undefined` — `event.getType() === "m.room.encrypted"` (não `m.room.message`) → adapter não tenta ler body undefined.

## DOCUMENT (11)

### EC-12: Multipart SMS interleaving multi-sender
- **Risco aceito:** Dois callers enviando ao mesmo destinatário simultaneamente → recipient vê chunks intercalados de duas conversas. Throttling caller-side é responsabilidade do consumidor; documentar no README do SMS.

### EC-13: Twilio status callback (delivered/failed) post-200
- **Risco aceito:** v0.1 retorna `SendResult.ok=true` após 200 do API (= aceito para enfileiramento), sem aguardar webhook de delivery status. v0.2 pode adicionar `onMessageDelivered` callback. Documentar.

### EC-14: Mattermost channel-type lookup race (channel criado mid-sync)
- **Risco aceito:** Caso raríssimo (channel criado entre sync e dispatch); lookup falha → default `type="group"` + warn stderr. Caller pode rehidratar via raw.

### EC-15: LINE webhook redelivery (7 retries em 1min se non-200)
- **Risco aceito:** Caller deve fazer idempotência por `event.id` para evitar dispatch duplicado em caso de timeout do handler. Documentar no README LINE.

### EC-16: Matrix sync token loss on process crash
- **Risco aceito:** v0.1 não persiste sync token entre crashes; restart = full re-sync (mitigado por EC-3 fix que filtra < 60s). v0.2 pode adicionar `syncTokenStorage` adapter.

### EC-17: Matrix alias rename invalida cache local
- **Risco aceito:** Cache TTL = "lifetime of process". Admin renomeia alias → send falha; documentar. v0.2 pode re-resolver alias on send error.

### EC-18: Matrix federation lag (remote homeserver delay)
- **Risco aceito:** Matrix é eventually consistent. `SendResult.ok=true` significa "homeserver local aceitou", não "remote entregou". Documentar.

### EC-19: CHANGELOG merge conflict em parallel PRs
- **Risco aceito:** Phases 1-4 podem ser PRs independentes; cada uma toca `[Unreleased]` no workspace CHANGELOG.md. Conflito trivial (4 sub-bullets); documentar política de "rebase, mantém todos".

### EC-20: Live smoke cost (~$0.05 por dogfood run)
- **Risco aceito:** Twilio test creds ainda cobram fração (US$0.01/SMS); LINE/Mattermost/Matrix free tier. Dev sabe o custo; live smoke é opt-in via env. Documentado.

### EC-21: Live smoke creds rotation (Twilio test creds têm validity)
- **Risco aceito:** Dev confirma creds atuais antes; falha = configurar novas. Não bloqueia plano.

### EC-22: Matrix `getContent().body` undefined para media events
- **Risco aceito:** v0.1 lê apenas `body` field (texto). Media events (image/file/audio) entregam `body` opcional ou caption. Quando undefined, normalize retorna `text=""`. Caller pode acessar via raw. Documentar.

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|---:|---:|---:|---:|
| T0.1 | 1 | 1 (EC-5) | 0 | 0 |
| T1.1 | 2 | 1 (EC-1) | 1 (EC-6) | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T1.3 | 3 | 0 | 1 (EC-7) | 2 (EC-12, EC-13) |
| T1.4 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 0 | 1 (EC-8) | 0 |
| T2.2 | 2 | 1 (EC-2) | 1 (EC-9) | 1 (EC-14) |
| T2.3 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 2 | 1 (EC-4) | 1 (EC-10) | 1 (EC-15) |
| T3.3 | 0 | 0 | 0 | 0 |
| T4.1 | 2 | 1 (EC-3) | 0 | 1 (EC-16) |
| T4.2 | 3 | 0 | 1 (EC-11) | 2 (EC-17, EC-18) |
| T4.3 | 0 | 0 | 0 | 0 |
| T5.1 | 1 | 0 | 0 | 1 (EC-19) |
| T5.2 | 0 | 0 | 0 | 0 |
| T6 (Dogfood) | 2 | 0 | 0 | 2 (EC-20, EC-21) |
| T4.2 (cont.) | 1 | 0 | 0 | 1 (EC-22) |
| **TOTAL** | **22** | **5** | **6** | **11** |

## Veredicto

**PLANO PRECISA DE AJUSTE → AJUSTADO**

Os 5 MUST FIX foram absorvidos no `gateway-tier-1-expansion-plan.md` no commit pós-edge-review:

- ✅ **EC-1** absorvido em T1.1 Task 0 (constructor validation + test)
- ✅ **EC-2** absorvido em T2.2 Deep Dives (mentions array priority + word-boundary regex) + 2 tests
- ✅ **EC-3** absorvido em T4.1 Deep Dives (sync filter < 60s) + 2 tests
- ✅ **EC-4** absorvido em T3.2 Deep Dives (event-type filter no topo) + 3 tests
- ✅ **EC-5** absorvido em T0.1 Task 0 (grep prévio + handling caso-a-caso)

SHOULD TEST: 4/6 incorporated diretamente no TDD; restantes 2 (EC-7, EC-8, EC-10, EC-11) ficam para o implementador adicionar conforme task em curso.

DOCUMENT: ficam como notas no README de cada package (EC-12 a EC-22).

**Status final:** Plano OK para implementação. Próximo passo: invocar `/cross-validation gateway-tier-1-expansion` após implementação, antes de `/dogfood`.
