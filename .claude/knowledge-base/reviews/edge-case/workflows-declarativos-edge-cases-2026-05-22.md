# Edge Case Review — workflows-declarativos

Data: 2026-05-22
Tasks analisadas: 13 (T0.1, T0.2, T1.1, T1.2, T2.1, T3.1, T3.2, T3.3, T4.1, T5.1, T5.2, T6.1, T7.1)
Edge cases encontrados: 13 (MUST FIX: 5, SHOULD TEST: 5, DOCUMENT: 3)

---

## MUST FIX

### EC-1: `AbortSignal` já abortado em `.run()` entry não é detectado

- **Task afetada:** T2.1 (executor core)
- **Família:** State / Cancellation
- **Cenário:** Caller passa um signal já abortado: `wf.run(input, { signal: abortedSignal })`. O executor entra no `for (const step of steps)` e a primeira checagem `if (signal.aborted) throw` só dispara DEPOIS do primeiro `dispatchStep`. Se o primeiro step é síncrono e completa rápido, ele roda quando não deveria — gasta cota LLM / produz side-effect indesejado.
- **Impacto:** Cancellation guarantee quebrada. Inconsistente com `Agent.batch` (D140) que checa o signal antes de despachar.
- **Fix sugerido:** Adicionar uma linha logo após criar `signal`:
  ```typescript
  if (signal.aborted) throw new DOMException(signal.reason ?? "Aborted", "AbortError");
  ```

### EC-2: Predicate em `.branch()` que joga exceção corrompe o run

- **Task afetada:** T3.1 (step-branch.ts)
- **Família:** Input / Boundary
- **Cenário:** Usuário passa `(input) => input.foo.bar` e `input.foo` é `undefined` — `TypeError: Cannot read properties of undefined`. O plano hoje usa `await Promise.resolve(predicate(input))` que propaga o throw sem distinguir "predicate bug" de "branch step error".
- **Impacto:** Workflow falha com erro confuso (TypeError do user code, sem contexto de qual predicate quebrou). Em prod, isso é debugging hell.
- **Fix sugerido:** Wrap cada predicate em try/catch e tratar como "no match" + warn (3 linhas):
  ```typescript
  let matched = false;
  try { matched = await Promise.resolve(predicate(input)); }
  catch (err) { console.warn(`[workflow] branch predicate ${i} threw, treating as no-match:`, err); }
  if (matched) { /* run branch */ }
  ```

### EC-3: `withRetry` com `maxAttempts: 0` ou negativo entra em comportamento indefinido

- **Task afetada:** T4.1 (retry-policy.ts)
- **Família:** Input
- **Cenário:** Caller passa `retry: { maxAttempts: 0 }` (typo, ou refactor que removeu o `+1`). Loop `for (let attempt = 1; attempt <= 0; ...)` nunca entra; `throw lastErr` no fim joga `undefined`. Caller recebe `Error: undefined`.
- **Impacto:** Bug silencioso — caller pensa que retry funcionou. Pode mascarar falha real.
- **Fix sugerido:** Validar em T1.1 no `RetryPolicy` Zod schema (1 linha):
  ```typescript
  maxAttempts: z.number().int().min(1).max(20),
  ```

### EC-4: `await ctx.suspend()` com payload não-serializável quebra snapshot

- **Task afetada:** T5.2 (suspend mechanism)
- **Família:** State / Format
- **Cenário:** Step.fn faz `await ctx.suspend({ db: dbConnection })` — passa uma instância com circular refs ou `BigInt`. O executor tenta `atomicWriteJson(snapshot)` que internamente faz `JSON.stringify` e joga `TypeError`. Estado parcialmente corrompido (snapshot file pode ter sido criado vazio) + erro confuso ao caller.
- **Impacto:** Resume impossível pra essa run; user descobre só na hora errada. Em ambientes com persistência JSON ligada, isso é silent data loss.
- **Fix sugerido:** Em T5.2, validar serializabilidade ANTES de escrever snapshot, com erro tipado (3 linhas):
  ```typescript
  let json: string;
  try { json = JSON.stringify(snapshot); }
  catch (err) { throw new WorkflowNotSerializableError(snapshot.currentStepId, err); }
  // then pass `json` (already-serialized) to atomicWriteText
  ```

### EC-5: Duas instâncias de `Workflow` com mesmo `name` colidem no single-flight global

- **Task afetada:** T1.2 / T2.1 (single-flight)
- **Família:** State / Concurrency
- **Cenário:** Caller cria `Workflow.create({ name: "ingest" })` em dois lugares diferentes do código (módulo A e módulo B). Ambos chamam `.run()` simultaneamente. O single-flight registry usa `${name}:${runId}` como key — mas `runId` é mintado por cada `.run()` call, então as duas runs têm runIds diferentes e o lock NÃO colide. Mas se ambas chamam `.run(input, { runId: "fixed" })` com runId explícito, colidem mesmo que sejam workflows distintos.
- **Impacto:** A segunda run recebe `WorkflowAlreadyRunningError` confuso ("já rodando" — mas é OUTRO workflow). Debug difícil.
- **Fix sugerido:** Adicionar um identifier interno (uuid) ao Workflow em `.commit()` e incluir no lock key (1 linha no T1.2 + 1 no T2.1):
  ```typescript
  // T1.2: this.workflowId = crypto.randomUUID().slice(0,8);
  // T2.1: const flightKey = `${options.workflowId}:${runId}`;
  ```

---

## SHOULD TEST

### EC-6: `.parallel([])` com branches vazio retorna `output: []` silenciosamente

- **Task afetada:** T2.1 (step-parallel.ts)
- **Teste sugerido:** `parallel_empty_branches_returns_empty_array` — `Workflow.create({...}).parallel([]).commit().run(input)` deve completar com `output: []` e status `completed`. Documenta que isso NÃO é erro (pode acontecer em programmatic step generation com filter resultando em zero branches).

### EC-7: `foreach.iterableFrom` aponta para step dentro de `.parallel`

- **Task afetada:** T3.2 (step-foreach.ts)
- **Teste sugerido:** `foreach_iterableFrom_inside_parallel_branch_throws_helpful_error` — `prevStepResults` é flat array de top-level steps. Steps DENTRO de parallel branches NÃO aparecem lá. Teste verifica que o erro mensagem cita "step ID 'X' is inside a parallel branch and not reachable from foreach.iterableFrom".

### EC-8: Resume com workflow cujos steps diferem do snapshot original

- **Task afetada:** T5.2 (Workflow.resume)
- **Teste sugerido:** `resume_step_id_not_in_workflow_throws` — snapshot tem `currentStepId: "validate"`, mas o `Workflow` passado para `resume` não tem mais um step com esse id (rename ou delete). Teste verifica `WorkflowResumeStepNotFoundError` com mensagem citando o ID faltante.

### EC-9: `WorkflowBuilder.commit()` chamado duas vezes

- **Task afetada:** T1.2 (workflow.ts)
- **Teste sugerido:** `builder_commit_twice_throws` — `const b = Workflow.create({...}); b.commit(); b.commit();` — segundo commit deve throw com mensagem clara. Já está no plano via `assertNotCommitted` mas precisa de teste explícito.

### EC-10: Telemetry span não termina se step.fn joga exceção síncrona

- **Task afetada:** T6.1 (telemetry.ts)
- **Teste sugerido:** `step_span_ends_in_finally_on_sync_throw` — wrap mock tracer, executar workflow onde step.fn faz `throw new Error()` sincronamente (não Promise reject). Verificar que `span.end()` foi chamado. Edge fácil de escapar ao usar `try { return await fn() } catch {}` sem `finally`.

---

## DOCUMENT

### EC-11: Step.fn retornando `undefined` propaga `undefined` como input do próximo step

- **Risco aceito:** Comportamento intencional (D234: explicit input/output state). Mas surpreende quem vem de Mastra (que tem `outputSchema` quase-obrigatório). Documentar em `docs.md` seção Workflows: "Se step.fn retorna `undefined`, o próximo step recebe `undefined` como input — defina `outputSchema` para validar."

### EC-12: Persistência JSON suporta apenas valores JSON-serializáveis

- **Risco aceito:** Snapshot via `atomicWriteJson` é JSON. `Date` vira ISO string, `BigInt` joga, `Map`/`Set` viram objetos vazios, funções não persistem. Para v1, documentar limitação explicitamente em `docs.md` + adicionar nota no ADR D235.

### EC-13: `dowhile.maxIterations: 100` default pode ser baixo para polling de status

- **Risco aceito:** Caso típico (polling job status a cada 30s por 1h) precisa de 120 iterations. Default 100 é deliberado conservador para pegar bugs cedo. Documentar em `docs.md` que para polling longos o caller DEVE passar `maxIterations` explícito (ex: `dowhile(step, cond, { maxIterations: 1000 })`).

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T0.2 | 0 | 0 | 0 | 0 |
| T1.1 | 1 | 1 (EC-3) | 0 | 0 |
| T1.2 | 2 | 1 (EC-5) | 1 (EC-9) | 0 |
| T2.1 | 2 | 1 (EC-1) | 1 (EC-6) | 0 |
| T3.1 | 1 | 1 (EC-2) | 0 | 0 |
| T3.2 | 1 | 0 | 1 (EC-7) | 0 |
| T3.3 | 1 | 0 | 0 | 1 (EC-13) |
| T4.1 | 0 | 0 (já contado em T1.1) | 0 | 0 |
| T5.1 | 1 | 0 | 0 | 1 (EC-12) |
| T5.2 | 2 | 1 (EC-4) | 1 (EC-8) | 0 |
| T6.1 | 1 | 0 | 1 (EC-10) | 0 |
| T7.1 | 0 | 0 | 0 | 0 |
| (doc) | 1 | 0 | 0 | 1 (EC-11) |
| **Total** | **13** | **5** | **5** | **3** |

**Veredicto:** PLANO OK COM AJUSTES — incorporar 5 MUST FIX como sub-tasks ANTES de iniciar implementação. SHOULD TEST adicionados aos TDD blocks existentes. DOCUMENT integrados no docs.md durante T8.3.

**Nenhum corner case combinado realista identificado** (parallel + suspend, retry + abort mid-backoff já cobertos no plano).

**Nenhum MUST FIX exige novo módulo ou camada de abstração** — todos são 1-3 linhas de código ou 1 linha de validação Zod adicional. KISS preservado.
