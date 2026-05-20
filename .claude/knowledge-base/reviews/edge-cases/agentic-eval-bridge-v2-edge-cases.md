# Edge Case Review — agentic-eval-bridge v2.0

Data: 2026-05-16
Plano: `agentic-eval-bridge-plan.md` v2.0 (1771 linhas)
Foco do review: Phases 1.1.b e 6-16 (as Phases 0-5 já foram revistas em `agentic-eval-bridge-edge-cases.md`)
Tasks analisadas: 13 (T1.1.b, T6.1, T6.2, T7.1, T8.1, T9.1, T10.1, T11.1, T12.1, T13.1, T14.1, T15.1, Phase 16)
Edge cases encontrados: 28 (MUST FIX: 5, SHOULD TEST: 17, DOCUMENT: 6)

---

## MUST FIX

### EC-18: Hooks-registry pattern não definido — `_theokit_hooks` como JSON não consegue carregar função
- **Task afetada:** T9.1 (Phase 9 — Hooks)
- **Família:** Format / Architecture
- **Cenário:** O plano diz que fixtures passam `_theokit_hooks: [...]` no body OpenAI (JSON). Mas hooks são **funções TypeScript** — não serializáveis. Sem mecanismo de registro, a bridge não tem como instanciar o hook que o fixture pede.
- **Impacto:** Phase 9 não pode ser implementada — gap conceitual. Suite hooks colapsa antes de rodar.
- **Fix sugerido:** No T9.1, adicionar sub-task: "criar `evals/bridge/hooks-registry.ts` exportando `REGISTERED_HOOKS: Record<string, HookConfig>` (hooks pré-cadastrados por nome). Fixture passa `_theokit_hooks: ["log-pre-tool", "block-on-keyword"]` (strings, não objetos). Bridge resolve cada nome contra o registry antes de chamar `Agent.create({ hooks })`." Pequena adição ao D14.

### EC-19: HumanEval executa código gerado pelo LLM sem sandbox declarado
- **Task afetada:** T11.1 (Phase 11 — Subagents)
- **Família:** Permission / Security
- **Cenário:** HumanEval = 164 problemas onde o agent gera código Python e o eval **executa o código gerado** para validar. Sem sandbox, código malicioso ou bugado (loop infinito, fork bomb, `os.system("rm")`) roda no host CI.
- **Impacto:** Risco de segurança em CI (improvável mas grave); travamento do runner (provável — loops infinitos acontecem em HumanEval com modelos pequenos); poluição do filesystem do runner.
- **Fix sugerido:** No T11.1, adicionar sub-task: "executar código gerado dentro de container Docker descartável (`python:3.11-slim` com timeout 10s e read-only `/`)" OU usar `humaneval-bench`'s built-in sandbox se disponível (verificar antes de implementar). Documentar a decisão como ADR D18 inline.

### EC-20: `Cron.create` em contract test cria recurso real sem cleanup
- **Task afetada:** T15.1 (Phase 15 — Contract tests)
- **Família:** State / Resource
- **Cenário:** Contract test cria cron job real via API. Sem `afterEach` cleanup, cada run do CI deixa um cron novo. Após N runs, workspace de eval acumula crons órfãos disparando indefinidamente.
- **Impacto:** Custo (crons executam → consomem tokens); ruído no monitoramento; possível rate limit no provider.
- **Fix sugerido:** No T15.1, adicionar ao test setup: `afterEach(async () => { for (const id of createdCronIds) await Cron.delete(id); })` ou usar namespace dedicado `eval-test-${uuid}` e bulk-delete ao final.

### EC-21: `nightly.ts` orquestra 11+ runners — uma falha quebra todos os subsequentes
- **Task afetada:** Phase 16 (Dogfood) e implicitamente T5.1 (CI nightly)
- **Família:** State / Resource
- **Cenário:** Atual `nightly.ts` (T5.1) usa `execSync` em sequência: bridge → bfcl → tau2 → compare. Se BFCL falha (exit ≠ 0), τ², LoCoMo, NIAH, suites etc. nunca rodam. Em v2.0 com 11+ runners, uma única falha apaga 10 sinais que poderiam estar verdes.
- **Impacto:** Relatório nightly fica vazio quando 1 de 11 falha; debug fica trabalhoso (qual fase realmente quebrou? as outras passariam?); custo já incorrido (tokens já consumidos no que rodou) sem benefício de relatório completo.
- **Fix sugerido:** No `nightly.ts`, trocar `execSync` por `try/catch` por runner, agregar erros em `evals/results/{ts}/FAILURES.json`, e exit 1 no final apenas se HOUVER falha — depois de rodar tudo. Mudança ≤ 20 linhas.

### EC-22: Active recall fixture multi-run não tem schema definido
- **Task afetada:** T6.2 (Phase 6 — Memory E2E)
- **Família:** Format / State
- **Cenário:** Plano diz "fixture active_recall: agent 1 fala fact X; agent 2 no mesmo workspace lembra do fact X". Mas cada fixture JSON do `suites/runner.ts` parece ser um único caso. Como expressar "rodar 2 vezes em sequência, com path de memória compartilhada"?
- **Impacto:** T6.2 não pode ser implementada sem definir o shape — gap conceitual igual ao EC-18.
- **Fix sugerido:** No T6.2, expandir o schema da fixture: cada caso pode ter `steps: [{ setup, prompt, assert }, ...]` em vez de `setup/prompt/assert` plano. Runner itera steps sequencialmente, mantendo `_theokit_memory.path` constante entre steps do mesmo caso. ≤ 30 linhas no runner.

---

## SHOULD TEST

### EC-23: `_theokit_*` mal-tipado bypassa validação
- **Task afetada:** T1.1.b
- **Teste sugerido:** `test_theokit_mcp_rejects_non_array` — body com `_theokit_mcp: "string"` → HTTP 400 com mensagem explícita.

### EC-24: SSE client desconecta no meio do stream
- **Task afetada:** T1.1.b
- **Teste sugerido:** `test_sse_cancels_on_client_disconnect` — abrir SSE, fechar conexão após 1º chunk; server NÃO deve continuar processando agent (`res.on('close', () => abortController.abort())`).

### EC-25: SSE keep-alive sem timeout server-side
- **Task afetada:** T1.1.b
- **Teste sugerido:** `test_sse_server_timeout_5min` — agent que demora > 5min é abortado pelo server (não fica conexão zumbi). Default sane: 5min.

### EC-26: UUID por case não garantidamente único em Phase 6
- **Task afetada:** T6.2
- **Teste sugerido:** `test_memory_path_unique_per_case` — runner gera 100 casos em paralelo; nenhum compartilha `_theokit_memory.path`.

### EC-27: LoCoMo precisa `_theokit_memory` ativo — runner não menciona
- **Task afetada:** T6.1
- **Teste sugerido:** `test_locomo_runner_sets_theokit_memory` — script `locomo.sh` injeta `--extra-body '_theokit_memory: { manager: "file", path: ... }'` no client LoCoMo (ou mecanismo equivalente). Sem isso, LoCoMo mede LLM cru, não a memory do SDK.

### EC-28: Memory dispose lança e contamina próximo caso
- **Task afetada:** T6.2
- **Teste sugerido:** `test_memory_dispose_failure_isolated` — caso A com dispose mockado para lançar; caso B subsequente roda do zero sem corrupção. Reforça EC-4 do review anterior, agora aplicado a Camada B.

### EC-29: NIAH com haystack gerado por RNG não-determinístico
- **Task afetada:** T7.1
- **Teste sugerido:** `test_niah_generator_seeded` — gerar haystack 2x com mesma seed → arquivo byte-idêntico. Suite usa seed fixo no Git para baseline reproduzível.

### EC-30: `npx -y` em CI sem cache pode falhar/atrasar
- **Task afetada:** T8.1
- **Teste sugerido:** `test_mcp_servers_install_in_ci_cache` — workflow YAML inclui `actions/cache@v4` para `~/.npm` antes de rodar suite MCP. Asserir tempo do 2º run < 1º run.

### EC-31: MCP servidor crash mid-test → comportamento indefinido
- **Task afetada:** T8.1
- **Teste sugerido:** `test_mcp_server_crash_marks_case_as_fail` — mock servidor que sai com exit 1; case correspondente é marcado `fail` (não `skip`); suite continua com próximos cases.

### EC-32: MCP filesystem precisa de root path com cleanup
- **Task afetada:** T8.1
- **Teste sugerido:** `test_mcp_filesystem_uses_isolated_tmpdir` — cada caso recebe `mktemp -d`, com cleanup pós-caso. Sem cleanup, lixo acumula entre runs.

### EC-33: Hook async lento bloqueia agent
- **Task afetada:** T9.1
- **Teste sugerido:** `test_hooks_have_timeout` — registry só aceita hooks com timeout interno ≤ 1s. Hook que excede é abortado e case marcado `fail`.

### EC-34: Skill frontmatter inválido não tem erro tipado
- **Task afetada:** T10.1
- **Teste sugerido:** `test_skill_invalid_frontmatter_throws_typed` — SKILL.md com YAML mal-formado → erro `SkillFrontmatterError` (ou equivalente do SDK), não exception genérica.

### EC-35: HumanEval com timeout por problema
- **Task afetada:** T11.1
- **Teste sugerido:** `test_humaneval_problem_timeout_30s` — problema individual com timeout 30s; loop infinito em código gerado vira `fail` (não trava o runner).

### EC-36: TTFT/TPOT são estatísticas, exigem múltiplas medições
- **Task afetada:** T12.1
- **Teste sugerido:** `test_streaming_perf_runs_n_warmups` — `measure.ts` faz 1 warmup descartado + 3 medições; reporta p50/p95 com IC. Single-shot mede ruído, não performance.

### EC-37: Mock primary fallback usa porta fixa → conflito em jobs paralelos
- **Task afetada:** T13.1
- **Teste sugerido:** `test_mock_primary_uses_dynamic_port` — server espera em `:0` (kernel atribui porta livre) e expõe via env var; suite usa essa env. Permite N jobs CI simultâneos.

### EC-38: Mock primary não termina → orphan process em CI
- **Task afetada:** T13.1
- **Teste sugerido:** `test_mock_primary_cleanup_on_exit` — script trap SIGINT/EXIT + kill PID. Asserir via `pgrep` que zero processos remanescentes após suite.

### EC-39: Contract test precisa `EVAL_CONTRACT=1` gate
- **Task afetada:** T15.1
- **Teste sugerido:** `test_contract_skipped_without_env_flag` — sem `EVAL_CONTRACT=1`, vitest skips testes que requerem API key real (`Theokit.me()`, `Cron.create()`). Mantém `pnpm test` rápido e barato.

---

## DOCUMENT

### EC-40: `_theokit_memory.path` permite path arbitrário (bridge eval-only)
- **Risco aceito:** Bridge roda só em localhost para evals; caller é confiável (BFCL/τ²/suites do próprio repo). Path traversal só seria problema se bridge fosse exposta publicamente — não é. Adicionar nota em `evals/README.md`: "bridge é localhost-only, não expor."

### EC-41: HumanEval custo US$ 25 é estimativa otimista
- **Risco aceito:** 164 problemas × 2 rodadas × multi-turn pode estourar para US$ 50+ em modelos lentos/verbosos. Documentar em Risks & Mitigations como R6 — orçamento ajustável via flag.

### EC-42: TTFT depende de latência externa do provider
- **Risco aceito:** OpenRouter latência variável pode falsificar regressão (TTFT subiu pela network, não pelo SDK). Mitigação: warmup descartado + mediana de 3 medições (EC-36). Aceitar variância 10-15% como ruído. Documentar em Risks.

### EC-43: Tokenizer aproximado em NIAH (chars/4)
- **Risco aceito:** Tamanhos "1K/4K/16K tokens" usam aproximação 4 chars/token. Tokenizer real (BPE) varia por modelo. Margem suficiente para o sinal pretendido (recall em haystacks pequenos ≥ 0.9). Não vale precisar via tiktoken — adicionaria dep só para isso.

### EC-44: Matriz multi-modelo custo US$ 240 é otimista
- **Risco aceito:** Preço por token varia até 10x entre modelos (Gemini Flash vs Claude Opus). US$ 240 é mediana plausível. Documentar como R7 e usar `--limit 50` (subset) na primeira execução para calibrar.

### EC-45: Matriz 4h perto do limite GH Actions free 6h
- **Risco aceito:** Se um benchmark ficar lento (rate limit), matriz pode estourar. Aceitar manual `workflow_dispatch` em vez de cron para esse workflow (já é o caso em D15). Documentar como R8.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.1.b | 3 | 0 | 3 | 0 |
| T6.1 | 1 | 0 | 1 | 0 |
| T6.2 | 3 | 1 | 2 | 0 |
| T7.1 | 2 | 0 | 1 | 1 |
| T8.1 | 4 | 0 | 3 | 1 |
| T9.1 | 2 | 1 | 1 | 0 |
| T10.1 | 1 | 0 | 1 | 0 |
| T11.1 | 3 | 1 | 1 | 1 |
| T12.1 | 2 | 0 | 1 | 1 |
| T13.1 | 2 | 0 | 2 | 0 |
| T14.1 | 0 | 0 | 0 | 2 |
| T15.1 | 2 | 1 | 1 | 0 |
| Phase 16 | 1 | 1 | 0 | 0 |
| Global (path traversal) | 1 | 0 | 0 | 1 |
| **Total** | **28** | **5** | **17** | **6** |

**Veredicto:** PLANO PRECISA DE AJUSTE

Os 5 MUST FIX são gaps conceituais ou de segurança que travam a implementação:

1. **EC-18 (hooks-registry)** — sem definir como `_theokit_hooks` JSON resolve para funções TS, T9.1 não decola.
2. **EC-19 (HumanEval sandbox)** — executar código LLM no host CI é problema real (loop infinito é cenário comum em HumanEval com modelos médios).
3. **EC-20 (Cron cleanup)** — leak de recursos cresce a cada run de CI; vira incident.
4. **EC-21 (nightly continue-on-error)** — uma falha apaga 10 sinais que poderiam estar verdes; mata o valor do dogfood.
5. **EC-22 (multi-run fixture schema)** — sem schema com `steps[]`, casos active-recall (core da Phase 6) não conseguem ser expressos.

Dos 17 SHOULD TEST, 5 são testes de robustez do bridge (T1.1.b: SSE timeout, client disconnect, tipagem) que devem ser RED já na implementação da fase. Os outros 12 são testes específicos por suite (memory dispose, NIAH determinístico, MCP cleanup, mock primary cleanup, etc.) — incorporados ao TDD de cada fase.

Os 6 DOCUMENT viram R6-R11 no Risks & Mitigations da T5.2 — todos têm fix-on-demand documentado.

**Próximas ações sugeridas para incorporar ao plano:**

1. **T9.1**: adicionar sub-task `hooks-registry.ts` + ADR inline; fixture passa nome (string), não objeto.
2. **T11.1**: adicionar sub-task "executar código HumanEval em Docker sandbox com timeout 30s" + ADR D18.
3. **T15.1**: adicionar `afterEach` cleanup para Cron + namespace isolado.
4. **T5.1 / Phase 16 / `nightly.ts`**: refatorar para `try/catch` por runner + agregação de falhas + exit 1 só no final.
5. **T6.2**: redefinir schema da fixture com `steps: [...]`; runner itera mantendo `_theokit_memory.path` consistente.
6. **T1.1.b**: adicionar 3 testes RED (tipagem, disconnect, timeout SSE).
7. **T5.2 (README runbook)**: estender Risks & Mitigations com R6-R11.
