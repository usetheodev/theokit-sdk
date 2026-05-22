# Edge Case Review — gateway-slack

Data: 2026-05-22
Tasks analisadas: 11 (T0.1, T1.1, T1.2, T2.1, T3.1, T3.2, T4.1, T4.2, T4.3, T5.1, T5.2)
Edge cases encontrados: 9 (MUST FIX: 4, SHOULD TEST: 3, DOCUMENT: 2)

---

## MUST FIX

### EC-1: `auth.test` throw após `app.start()` deixa app órfão escutando sem `botUserId`

- **Task afetada:** T2.1 (connect)
- **Família:** Lifecycle / Resource
- **Cenário:** `await this.app.start()` succede (Socket Mode conecta), mas a chamada subsequente `await app.client.auth.test()` falha (network glitch transitório, ou Slack retorna `{ ok: false }`). O catch block atualmente faz `this.app = undefined` mas **não chama `app.stop()`**. O Bolt App original continua rodando em background, escutando eventos, sem ter `botUserId` cacheado — o bot loop guard (D275) falha porque `botUserId` é `undefined`. Resultado: bot pode entrar em loop infinito respondendo a si mesmo.
- **Impacto:** Memory leak (App órfão) + loop catastrófico se algum evento chegar no App órfão antes do GC. Pior na próxima tentativa de `connect()` que cria SEGUNDO App → 2 handlers ativos.
- **Fix sugerido:** Adicionar `app.stop()` no catch (3 linhas):
  ```typescript
  } catch (err) {
    process.stderr.write(`[slack-adapter] connect failed: ${...}\n`);
    if (this.app !== undefined) {
      await this.app.stop().catch(() => undefined); // best-effort cleanup
    }
    this.app = undefined;
    return false;
  }
  ```

### EC-2: `connect()` chamado concorrentemente registra handlers duplicados

- **Task afetada:** T2.1 (connect)
- **Família:** Concurrency / State
- **Cenário:** `Promise.all([adapter.connect(), adapter.connect()])` (caller buggy OR SessionRouter race). Ambas as chamadas veem `connected === false`, ambas criam novos `App`, ambas chamam `app.start()`. Resultado: dois App instances + dois `app.event("message", ...)` registrados → cada mensagem inbound dispara o handler 2x.
- **Impacto:** Cada user message gera 2 agent.send calls + duplo custo LLM + possíveis duplicate replies ao usuário.
- **Fix sugerido:** Serializar via `connectingPromise` field (3 linhas):
  ```typescript
  private connectingPromise?: Promise<boolean>;
  override async connect(): Promise<boolean> {
    if (this.connectingPromise !== undefined) return this.connectingPromise;
    this.connectingPromise = this._doConnect().finally(() => { this.connectingPromise = undefined; });
    return this.connectingPromise;
  }
  ```

### EC-3: Bot em canal recebe TODA mensagem (não só `@mentions`) → cost explosion silenciosa

- **Task afetada:** T3.1 (normalize) + T2.1 (connect)
- **Família:** Boundary / Permission
- **Cenário:** Slack default: quando o bot é adicionado a um canal público (não DM), o event handler `message` recebe TODAS as mensagens do canal, não só as que mencionam o bot. Telegram/Discord têm proteções nativas (privacy mode / MessageContent intent), Slack não — silent firehose. Sem filter, todo evento chega ao caller, que provavelmente passa pro LLM. Bill explode.
- **Impacto:** Cost explosion + spam aos usuários do canal (bot responde a mensagens que não foram pra ele) + rate-limit Slack-side.
- **Fix sugerido:** Adicionar opção `requireMention?: boolean` (default `true` para canais, `false` para DM/mpim). Em normalize, se `channelType === "group"` (channel) e `requireMention === true` e text não contém `<@${botUserId}>`, retornar undefined. 3 linhas + nova ADR D285:
  ```typescript
  if (channelType === "group" && opts.requireMention && botUserId !== undefined) {
    if (!e.text?.includes(`<@${botUserId}>`)) return undefined;
  }
  ```

### EC-4: `splitForSlack` corta no meio de surrogate pair (emoji) → string inválida

- **Task afetada:** T4.1 (splitForSlack)
- **Família:** Format / Boundary
- **Cenário:** Mensagem com emoji em UTF-16 surrogate pair (🎉 = `🎉`, ocupa 2 code units). `text.lastIndexOf(" ", 4000)` pode parar dentro de um surrogate. `text.slice(0, cut)` retorna string com half-surrogate → Slack `chat.postMessage` rejeita ou exibe ` ` placeholder.
- **Impacto:** Resposta truncada incorretamente. Pior se o usuário usa emoji frequente.
- **Fix sugerido:** Antes de cortar, ajustar `cut` se cair em surrogate. 3 linhas:
  ```typescript
  if (cut < remaining.length) {
    const cp = remaining.charCodeAt(cut);
    if (cp >= 0xDC00 && cp <= 0xDFFF) cut -= 1; // low surrogate; back up to before high
  }
  ```

---

## SHOULD TEST

### EC-5: `disconnect()` chamado enquanto `connect()` está in-flight

- **Task afetada:** T2.1
- **Teste sugerido:** `disconnect_while_connect_in_flight_does_not_leave_app_running` — start `connect()` mas não await, chama `disconnect()` antes do connect resolver, então await ambos. Verifica que após ambos resolverem: `connected === false`, `app === undefined`, nenhum listener Bolt ativo (verificável via spy).

### EC-6: `sendMessage` quando app ainda está conectando (race state)

- **Task afetada:** T4.3
- **Teste sugerido:** `send_during_connect_returns_not_connected` — chama `connect()` (não await) e `sendMessage()` imediatamente. Verifica que send retorna `{ ok: false, error: { code: "not_connected" } }` se app ainda undefined.

### EC-7: Empty text event (file-only upload) chega como `text: ""`

- **Task afetada:** T3.1 (normalize) + T3.2 (onInbound)
- **Teste sugerido:** `normalize_keeps_file_only_message_as_empty_text` — confirma que mensagem só com files (sem text) NÃO é descartada (returna evento com `text: ""`); caller decide o que fazer. Adicionar nota em docs sobre o comportamento.

---

## DOCUMENT

### EC-8: Slack interpreta `<!channel>` / `<!here>` no output do bot como broadcasts

- **Risco aceito:** Se o agent LLM gerar literal `<!channel>` no output (improvável, mas possível em prompts adversariais), Slack vai pingar o canal inteiro. Caller responsibility: sanitizar output via regex se necessário. Plain `@channel` (sem `< >` e `!`) é texto literal — não vira broadcast. Documentar no `docs.md` seção security/notes.

### EC-9: Bolt auto-reconnect em network blip é transparente; longa outage Slack-side não é sinalizada

- **Risco aceito:** Socket Mode reconecta automaticamente em network blip (Bolt SDK). Outage prolongado (>5min) é raro mas pode acontecer; nossa API não expõe sinal "desconectado mas tentando" — caller monitora via heartbeats próprios. Documentar como limitation. v1.x pode adicionar callback `onConnectionStateChange`.

---

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 3 | 2 (EC-1, EC-2) | 1 (EC-5) | 1 (EC-9) |
| T3.1 | 2 | 1 (EC-3) | 1 (EC-7) | 0 |
| T3.2 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 1 (EC-4) | 0 | 0 |
| T4.2 | 0 | 0 | 0 | 0 |
| T4.3 | 1 | 0 | 1 (EC-6) | 1 (EC-8) |
| T5.1 | 0 | 0 | 0 | 0 |
| T5.2 | 0 | 0 | 0 | 0 |
| **Total** | **9** | **4** | **3** | **2** |

**Veredicto:** PLANO OK COM AJUSTES — absorver 4 MUST FIX no plano (todos são 1-3 linhas de código ou 1 opção). Acrescentar **D285** (requireMention default) ao set de ADRs (totalizando 19 ADRs em vez de 18). SHOULD TEST adicionados aos TDD blocks. DOCUMENT integrados no docs.md.

**Nenhum MUST FIX requer nova camada/módulo** — todos são guards/early-returns/options dentro dos arquivos já planejados. KISS preservado.

**Notas pragmáticas:**

- **EC-3 (channel spam) é o mais crítico** — sem mention guard default-true, qualquer usuário que adicionar o bot a um canal causa cost explosion. ADR D285 + opção `requireMention: boolean` resolve com 3 linhas.
- **EC-1 + EC-2 (lifecycle)** são clássicos de adapters de plataforma; Telegram/Discord podem ter os mesmos bugs latentes mas testes anteriores não cobriram concurrent connect. Aproveitar para shippar o pattern correto desde o início.
- **EC-4 (surrogate split)** é o tipo de bug que aparece em produção com emojis comuns — Slack workplaces usam emoji *muito*. Fix mínimo, valor alto.
- **EC-7 (file-only msg)** mantido como SHOULD TEST porque a decisão "passar evento empty-text adiante OU descartar" é caller-policy, não adapter-policy.
