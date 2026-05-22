# Edge Case Review — eval-suite

Data: 2026-05-22
Tasks analisadas: 9 (T0.1, T1.1, T2.1, T3.1, T4.1, T5.1, T6.1, T7.1, T8.1)
Edge cases encontrados: 12 (MUST FIX: 4, SHOULD TEST: 5, DOCUMENT: 3)

## MUST FIX

### EC-1: `Scorers.containsExpected` com `expected === ""` retorna sempre score=1
- **Task afetada:** T3.1
- **Família:** Input
- **Cenário:** Dataset com `{ input: "...", expected: "" }` (descuido, csv vazio, ou expected ausente que vira "" por coerção upstream). `"".includes("")` é sempre `true` → toda linha PASS. Eval score inflado silenciosamente.
- **Impacto:** Falsos positivos numa eval de produção. Time deploy com confiança falsa.
- **Fix sugerido:** Em `containsExpected.score`, antes do `includes`: `if (e.length === 0) return { score: 0, reason: "expected_empty" };`. Mesma defesa em `exactMatch` (já tem `trim()` mas dois empties também passam).

### EC-2: `jsonShape` sem cap de tamanho do output
- **Task afetada:** T3.1
- **Família:** Resource
- **Cenário:** LLM retorna JSON gigante (e.g. um modelo que entra em loop produzindo array de strings) — `JSON.parse(10MB+ string)` aloca memória ~3x, depois Zod walka a árvore. Pode estourar memória do processo.
- **Impacto:** OOM no eval runner; uma linha ruim derruba todas as outras em paralelo (concurrency 4 × cada uma alocando).
- **Fix sugerido:** Em `jsonShape.score`: `if (output.length > 1_000_000) return { score: 0, reason: "output_too_large" };`. 1MB é generoso pra JSON estruturado real.

### EC-3: `EvalOptions.concurrency` sem validação aceita 0 / negativo / Infinity
- **Task afetada:** T2.1
- **Família:** Input
- **Cenário:** `Eval.create({ concurrency: 0 })` ou `-1`. O `Agent.batch` por D136 default 4 mas se receber 0, o async-semaphore (D135) nunca libera → deadlock infinito. `Infinity` cria fanout descontrolado → estoura cota OpenRouter / DOSa o provider.
- **Impacto:** Deadlock OU spam de requests.
- **Fix sugerido:** No Zod schema de `EvalOptions`: `concurrency: z.number().int().min(1).max(64).optional()`. 1 linha. Default 4 fica intacto.

### EC-4: Hook (`afterRow` / `beforeRun` / `afterRun`) lançando kill o run inteiro
- **Task afetada:** T2.1
- **Família:** State
- **Cenário:** User passa `hooks: { afterRow: (row) => writeFileSync(badPath, row) }` que lança ENOENT na linha 17. Loop `for` desenrola, `runEval` rejeita com erro de I/O alheio à eval, e as 16 linhas anteriores ficam órfãs (não persistidas, hook `afterRun` nunca chamado).
- **Impacto:** Run inteiro perdido por causa de bug do user code em telemetria. Comportamento surpreendente.
- **Fix sugerido:** Wrap cada chamada de hook em try/catch — `try { options.hooks?.afterRow?.(row, i); } catch (err) { console.warn("[eval] afterRow hook threw:", err); }`. Mesma defesa em `beforeRun` + `afterRun`. ≤9 linhas.

## SHOULD TEST

### EC-5: `Agent.batch` BatchResult fields assumidos (startedAt / finishedAt / usage)
- **Task afetada:** T2.1
- **Teste sugerido:** `test_eval_handles_batch_result_without_timing_fields` — mock `Agent.batch` retornar `BatchResult` sem `startedAt`/`finishedAt`; assert `durationMs` é 0 (não NaN) e não derruba o run. Verifica também `usage` ausente → `tokensIn/Out = 0`. Documenta o contrato esperado de `Agent.batch` D134.

### EC-6: Score inválido (`NaN` / `Infinity` / negativo / > 1)
- **Task afetada:** T2.1 + T3.1
- **Teste sugerido:** `test_eval_clamps_pathological_scores` — scorer retorna `{score: NaN}`, `{score: Infinity}`, `{score: -5}`, `{score: 2}`. Assert aggregate `meanScore` é finite + em [0,1]. Plan menciona clamp em D-ALG mas precisa de teste explícito por cenário.

### EC-7: Empty dataset (degenerate aggregate)
- **Task afetada:** T2.1
- **Teste sugerido:** `test_eval_empty_dataset_returns_zero_aggregate` — `dataset: []` → `totalRows: 0`, `meanScore: 0` (não NaN), `passRatio: 0`, `p50: 0`, `p95: 0`. Plan documenta a policy mas TDD não lista esse caso explicitamente.

### EC-8: `llmJudge` parser com JSON em code fence ou multi-linha
- **Task afetada:** T4.1
- **Teste sugerido:** `test_llm_judge_parses_json_in_markdown_fence` — fixture do judge retorna ` ```json\n{"score":0.8,"reason":"good"}\n``` `. SCORE_REGEX atual (`/\{"score"\s*:\s*([0-9]*\.?[0-9]+)\s*,\s*"reason"\s*:\s*"([^"]*)"\s*\}/`) deve achar mesmo com markdown ao redor — verifique. Se quebrar, relax o regex para `[\s\S]` na reason OU parse via `JSON.parse` no primeiro `{` até último `}`.

### EC-9: AbortSignal disparado ANTES de `agent.batch` começar
- **Task afetada:** T2.1
- **Teste sugerido:** `test_eval_run_returns_partial_when_aborted_before_start` — `signal.abort()` antes de `Eval.run({ signal })`. Assert resultado: `errorRows === totalRows` OU `rows.length === 0`; `single-flight` foi liberado (próximo run com mesmo name não joga `EvalAlreadyRunningError`).

## DOCUMENT

### EC-10: ReDoS em `Scorers.regex` com pattern do user vs output adversarial do LLM
- **Risco aceito:** `Scorers.regex(pattern)` aplica o RegExp do user em output do LLM. Se o pattern tem backtracking exponencial (ex.: `/(a+)+$/`) e o LLM produz string adversarial, o scorer pode travar. Não é eval bug; é user responsibility. Documentar em docstring do `Scorers.regex`: "Patterns vulneráveis a ReDoS travam o eval; teste seu pattern com strings adversariais antes de usar em produção."

### EC-11: Eager dataset materialization → OOM em milhões de rows
- **Risco aceito:** Plan já diz "acceptable for v1, streaming aggregate deferred to v2" no T2.1 algorithm step 7. Adicionar threshold prático no README do Phase 7: "v1 suporta datasets até ~10k rows; acima disso considere `Eval.runStream` v2 ou particionar manualmente."

### EC-12: `llmJudge` dobra custo por linha (N extra LLM calls)
- **Risco aceito:** Cada row vira: 1 chamada agent + 1 chamada judge. Cost = 2x a baseline. Para 1000 rows × gpt-4o-mini ≈ $3 ao invés de $1.5. Cost-per-row dashboard precisa explicar essa diferença. Adicionar nota em `Scorers.llmJudge` docstring + na seção de cost forecasting em `docs.md` §Eval Suite.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 6 | 2 (EC-3, EC-4) | 3 (EC-5, EC-6, EC-7, EC-9) | 1 (EC-11) |
| T3.1 | 3 | 2 (EC-1, EC-2) | 0 | 1 (EC-10) |
| T4.1 | 2 | 0 | 1 (EC-8) | 1 (EC-12) |
| T5.1 | 0 | 0 | 0 | 0 |
| T6.1 | 0 | 0 | 0 | 0 |
| T7.1 | 0 | 0 | 0 | 0 |
| T8.1 | 0 | 0 | 0 | 0 |
| **TOTAL** | **12** | **4** | **5** | **3** |

(Note: T2.1 has 4 SHOULD TEST entries listed; sum reflects unique edges.)

**Veredicto: PLANO PRECISA DE AJUSTE**

4 MUST FIX precisam ser absorvidos antes de implementar:

- **EC-1** (`containsExpected` empty-expected loophole) — silent false positive em production evals
- **EC-2** (`jsonShape` sem size cap) — OOM trivial
- **EC-3** (`concurrency` validation) — deadlock (0) ou DoS (Infinity)
- **EC-4** (hooks throw kill run) — bug em user logger derruba run inteiro

Os 5 SHOULD TEST entram como tests RED na fase respectiva. Os 3 DOCUMENT viram notas em docstrings + docs.md.

## Próximos passos

1. Atualizar `eval-suite-plan.md`:
   - T2.1: Zod refinement `concurrency` (EC-3) + hook try/catch (EC-4) + RED tests EC-5/EC-6/EC-7/EC-9
   - T3.1: empty-expected guard em `containsExpected` (EC-1) + size cap em `jsonShape` (EC-2) + RED tests + docstring ReDoS (EC-10)
   - T4.1: parser tolerante a markdown fence (EC-8) + docstring cost-doubling (EC-12)
   - T7.1 README: nota "≤10k rows" (EC-11)
2. Apresentar plano final ao user (pré-implementação).
