# Edge Case Review — agentic-eval-bridge

Data: 2026-05-16
Tasks analisadas: 9 (T0.1, T0.2, T1.1, T2.1, T3.1, T4.1, T4.2, T5.1, T5.2)
Edge cases encontrados: 17 (MUST FIX: 2, SHOULD TEST: 10, DOCUMENT: 5)

---

## MUST FIX

### EC-1: Bridge concorrente + memória persistente compartilhada
- **Task afetada:** T1.1 (`agent-factory.ts`)
- **Família:** State / Concurrency
- **Cenário:** `node:http` atende requests em paralelo. T3.1 amplifica isso porque τ² usa o **mesmo bridge** para agent E user simulator (`--agent-api-base` e `--user-api-base` apontam ambos para `:9100`). Se `buildAgent()` instancia um `Agent` com `memory: { manager: "file", path: ".theokit/memory" }` (default do SDK), dois agents concorrentes escrevem no mesmo arquivo → corrupção, race, ou facts vazando entre tasks de BFCL/τ².
- **Impacto:** Scores não-reproduzíveis (variação > 1pp falsifica baseline da T4.2); memória de uma task vaza para outra (contaminação cross-task = comparação inválida).
- **Fix sugerido:** No `agent-factory.ts`, sempre passar `memory: undefined` e `context: undefined` no `Agent.create()`. Evals são stateless por definição — cada request começa do zero. Documentar isso no comentário do factory.

### EC-2: Translate.ts não cobre `role: "tool"` nem `tool_calls` em mensagens de INPUT
- **Task afetada:** T1.1 (`translate.ts`)
- **Família:** Format / Input
- **Cenário:** O plano descreve translate para `tools` (definições) e `tool_calls` no **output**. Mas BFCL categoria `multi_turn` e τ² mandam **histórico** com mensagens `{ role: "assistant", tool_calls: [...] }` seguidas de `{ role: "tool", tool_call_id: "...", content: "..." }`. Sem mapear isso para o formato do `Agent.send({ messages })`, o agent perde o contexto da turn anterior.
- **Impacto:** BFCL `multi_turn` colapsa para ~0% de pass rate. τ² inteiro falha. Score reportado seria sobre o LLM esquecendo todo o histórico — inútil.
- **Fix sugerido:** Adicionar caso no `translateRequest`: quando mensagem tem `tool_calls` ou `role === "tool"`, mapear para a shape correspondente do SDK (provavelmente `messages` com `toolResults` ou equivalente — checar `docs.md` e `types/agent.ts`). Adicionar 2 testes RED em `translate.test.ts` cobrindo esses dois casos.

---

## SHOULD TEST

### EC-3: `readJson` com body malformado ou truncado
- **Task afetada:** T1.1 (`server.ts`)
- **Teste sugerido:** `test_server_rejects_invalid_json` — POST com body `"{not valid"` retorna HTTP 400 (não 500), com payload `{ error: { message } }` no formato OpenAI.

### EC-4: `agent.dispose()` lança e perde o erro original
- **Task afetada:** T1.1 (`server.ts`)
- **Teste sugerido:** `test_server_preserves_error_when_dispose_fails` — mockar Agent cujo `send` lança erro A e `dispose` lança erro B; resposta HTTP deve conter erro A (não B). Padrão: `await agent.dispose().catch(() => {})`.

### EC-5: Concorrência amplificada — τ² agent + user no mesmo bridge
- **Task afetada:** T1.1 (`server.ts`) + T3.1
- **Teste sugerido:** `test_server_handles_concurrent_requests` — disparar 10 requests em paralelo, todos retornam 200 sem cross-contamination de tool calls. Reforça EC-1.

### EC-6: `compare.ts` com summary.json malformado
- **Task afetada:** T4.1
- **Teste sugerido:** `test_compare_handles_malformed_summary` — summary.json com JSON inválido → exit 3, mensagem clara identificando qual benchmark; NÃO mascarar como "sem regressão".

### EC-7: `compare.ts` com baseline schema incompleto
- **Task afetada:** T4.1
- **Teste sugerido:** `test_compare_validates_baseline_schema` — baseline sem `score.overall` (BFCL) ou `score.pass_rate` (τ²) → exit 3, log identificando key faltando. Evita comparação contra `undefined`.

### EC-8: `compare.ts` com timestamps inconsistentes entre benchmarks no run
- **Task afetada:** T4.1
- **Teste sugerido:** `test_compare_uses_consistent_timestamp` — `evals/results/` contém `t1/bfcl-v3/` e `t0/tau2-retail/` (t0 < t1); script DEVE usar `t1` para os dois e reportar τ² como "missing" (não comparar contra run antigo).

### EC-9: BFCL runner sem timeout
- **Task afetada:** T2.1 (`bfcl-v3.sh`)
- **Teste sugerido:** Adicionar `timeout 30m bfcl generate ...` no script. Não precisa teste — basta a flag. Se passar de 30min, script falha com exit code claro (124 = timeout). Senão CI 90min trava em uma categoria.

### EC-10: `.venv-setup.sh` detecta venv corrompido
- **Task afetada:** T2.1 (`.venv-setup.sh`)
- **Teste sugerido:** `test_venv_setup_recreates_corrupted` — apagar `evals/.venv/bin/python` manualmente e re-rodar setup; deve recriar venv do zero (não usar cache parcial). Implementação: `[ -x evals/.venv/bin/python ] || rm -rf evals/.venv && python3 -m venv ...`.

### EC-11: `OPENROUTER_API_KEY` ausente — fail fast no startup
- **Task afetada:** T1.1 (`server.ts`)
- **Teste sugerido:** `test_server_fails_fast_on_missing_api_key` — sem env var, server NÃO inicia (exit 1 com mensagem clara). Hoje o erro vem na 1ª request (500 com erro do Agent) → debug ruim.

### EC-12: Port 9100 já em uso
- **Task afetada:** T1.1 (`server.ts`)
- **Teste sugerido:** `test_server_reports_port_conflict` — `EADDRINUSE` deve ser capturado e logado claramente ("port 9100 in use, set EVAL_BRIDGE_PORT to override"), não stack trace cru.

---

## DOCUMENT

### EC-13: Pin `bfcl-eval==3.0.x` permite minor changes
- **Risco aceito:** Berkeley pode mudar formato do `--result-dir` em minor. Fix completo seria pin exato (`==3.0.5`), mas isso impede pegar bugfixes. Comprommise: pin exato no `requirements.txt` e atualizar via PR explícito.

### EC-14: `tau2-summarize.py` depende do shape do output raw do tau2
- **Risco aceito:** Sierra Research pode mudar schema entre versões. Mitigação: pin exato + teste de parsing que falha rapidamente se shape mudar.

### EC-15: Baselines com variação > 1pp entre 3 runs
- **Risco aceito:** O plano (T4.2) exige ≤ 1pp de variação. Se não atingir, decidir caso a caso: rodar mais 3 (n=6 mediana), trocar `temperature` para 0, ou aceitar variação maior documentando. Não pré-decidir no plano para evitar over-engineering.

### EC-16: GitHub Actions `timeout-minutes: 90` pode ser apertado
- **Risco aceito:** Plano estima 75 min. Margem de 15 min é pequena se OpenRouter tiver lentidão. Mitigação: medir primeira execução real e ajustar para 120 min se necessário (não pré-otimizar).

### EC-17: OpenRouter rate limit em burst do BFCL
- **Risco aceito:** BFCL pode disparar 200+ requests rápido. Plano não controla concorrência client-side. Se aparecer, adicionar flag `--max-workers 4` ao `bfcl generate` (suportado pela CLI). Não pré-implementar — esperar evidência de throttle.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T0.2 | 0 | 0 | 0 | 0 |
| T1.1 | 6 | 2 | 4 | 0 |
| T2.1 | 4 | 0 | 2 | 2 |
| T3.1 | 1 | 0 | 1 | 0 |
| T4.1 | 3 | 0 | 3 | 0 |
| T4.2 | 1 | 0 | 0 | 1 |
| T5.1 | 2 | 0 | 0 | 2 |
| T5.2 | 0 | 0 | 0 | 0 |
| **Total** | **17** | **2** | **10** | **5** |

**Veredicto:** PLANO PRECISA DE AJUSTE

Dois itens MUST FIX são bloqueadores para o plano entregar valor real:

1. **EC-1** (memória compartilhada) — sem fix, baselines da Phase 4 são inválidos (cross-contamination falsifica scores).
2. **EC-2** (tool history) — sem fix, BFCL `multi_turn` e τ² inteiro colapsam para ~0%, tornando esses runners inúteis. Isso é o coração do que o plano se propõe a medir.

Os 10 SHOULD TEST devem ser incorporados ao TDD das tasks correspondentes (especialmente T1.1 que ganha 4 testes adicionais). Os 5 DOCUMENT são notas que cabem em uma seção "## Risks & Mitigations" no `evals/README.md` da T5.2.

**Próximas ações sugeridas para incorporar ao plano:**

1. T1.1 — adicionar EC-1 fix (`memory: undefined` no factory) como sub-task explícita; adicionar 6 testes do EC-2/3/4/5/11/12 ao TDD.
2. T1.1 — adicionar EC-2 fix (translate de `role: "tool"` e `tool_calls` em INPUT) como sub-task; 2 testes correspondentes.
3. T2.1 — adicionar `timeout 30m` no script; adicionar test_venv_setup_recreates_corrupted.
4. T4.1 — adicionar os 3 testes (EC-6, EC-7, EC-8).
5. T5.2 — incluir seção "Risks & Mitigations" cobrindo EC-13 a EC-17.
