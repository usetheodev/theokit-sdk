# Edge Case Review — telegram-pro-v1.2-evolution

Data: 2026-05-17
Tasks analisadas: 13 (T0.1 → T4.3 + Phase 5)
Edge cases encontrados: 10 (**MUST FIX: 3**, SHOULD TEST: 4, DOCUMENT: 3)

## MUST FIX (incorporados ao plano in-place)

### EC-1: `ctx.reply` pode falhar antes de criar placeholder
- **Task afetada:** T1.1 (`streamIntoTelegram`)
- **Família:** Resource / I/O
- **Cenário:** Telegram retorna 502/timeout no `ctx.reply` inicial → `placeholder` undefined → subsequent `editMessageText(chatId, undefined, ...)` crash.
- **Impacto:** Stream falha silenciosamente OU crasha handler.
- **Fix aplicado:** try/catch wrap + guard `placeholder?.message_id === undefined`; retorna early com `console.error`.

### EC-2: `editMessageText` falha "message to edit not found" se user deletar msg mid-stream
- **Task afetada:** T1.1
- **Família:** State / Timing
- **Cenário:** User deleta a msg "..." mid-stream → próximo edit propaga erro Telegram 400 não capturado.
- **Impacto:** Stream aborta sem feedback ao user; potencial agent.dispose race.
- **Fix aplicado:** Regex broader em `flushEdit` catch: `/not modified|message to edit not found|message can't be edited/i` → set `cancelled = true` e retorna.

### EC-3: `setTimeout` leak no error path
- **Task afetada:** T1.1
- **Família:** Resource / State
- **Cenário:** Stream throws mid-loop; `clearTimeout(pendingEdit)` no plano original estava SÓ no happy path → pending timer dispara depois da error msg edit, causando race "not modified" loop.
- **Impacto:** UI oscila entre erro e estado parcial; potencial loop de errors.
- **Fix aplicado:** Mover `clearTimeout` para `finally` block.

## SHOULD TEST (incorporados ao plano)

| EC | Task | Mitigação aplicada |
|----|------|--------------------|
| EC-4 | T1.1 | Zero-deltas fallback: após for-await, se `buffer === ""`, chama `run.wait()` + edit msg com `result.result`. |
| EC-5 | T2.1 (/factstream) | Preview partial DROP `parse_mode: "Markdown"` (texto cru no preview; markdown só no final reply). |
| EC-6 | T2.4 (/notion) | Detect `oauth_timeout`/`oauth_state_mismatch` no `result.error.code` → reply explícito sobre rodar `--setup` localmente. |
| EC-7 | T2.2 (/migrate_memory) | `mkdtempSync` em try/catch → reply amigável "Could not create demo workspace: {err}. Skipping demo." |

## DOCUMENT (incorporados na seção Notas + reply do /stream)

| EC | Risco aceito |
|----|--------------|
| EC-8 | `/stream on` reply explicita "inline buttons NÃO suportados em stream mode (D58)" |
| EC-9 | Throttle 500ms é best-effort em rede lenta — ADR D52 nota |
| EC-10 | Vendor SDK versão incompatível (Langfuse v4+ não testado) — README documenta versões testadas |

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 4 | 3 | 1 | 1 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 0 | 1 | 0 |
| T2.2 | 1 | 0 | 1 | 0 |
| T2.3 | 0 | 0 | 0 | 0 |
| T2.4 | 1 | 0 | 1 | 0 |
| T2.5 | 1 | 0 | 0 | 1 |
| T2.6 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 0 | 0 | 1 |
| T4.1 | 1 | 0 | 0 | 1 |
| T4.2 | 0 | 0 | 0 | 0 |
| T4.3 | 0 | 0 | 0 | 0 |

**Veredicto:** PLANO PRECISA DE AJUSTE (após patches) → **PLANO OK**.

Os 3 MUST FIX foram incorporados in-place no snippet de `streamIntoTelegram` em T1.1:
1. Initial `ctx.reply` em try/catch + guard
2. Broader regex em flushEdit catch
3. clearTimeout em `finally` block

Os 4 SHOULD TEST viraram código adicional nos snippets:
1. Zero-deltas fallback em T1.1
2. Drop parse_mode no preview de /factstream
3. EACCES handling em /migrate_memory
4. oauth_timeout detection em /notion

Os 3 DOCUMENT entraram na seção "Notas / Edge cases DOCUMENT" + reply do `/stream on`.

Plano pronto para implementação.
