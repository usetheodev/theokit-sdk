# Edge Case Review — agent-handoffs

Data: 2026-05-22
Tasks analisadas: 4 (T0.1, T1.1, T2.1 [contém Phase 3-6], T7.1, T8.1)
Edge cases encontrados: 14 (MUST FIX: 5, SHOULD TEST: 6, DOCUMENT: 3)

## MUST FIX

### EC-1: Handoff em paralelo na mesma resposta do LLM
- **Task afetada:** T2.1 (interceptor)
- **Família:** State / Concurrency
- **Cenário:** LLM com tool-calling moderno (Claude 3.5+, gpt-4o, Llama 3.1+) pode emitir múltiplos `tool_use` no mesmo turn. Se o LLM emitir `transfer_to_billing` E `transfer_to_support` na mesma resposta (ou `transfer_to_X` + um tool normal), o que acontece?
- **Impacto:** Sem guard, dispatch race: 2 receivers podem começar em paralelo, ou um wins arbitrariamente e o outro fica órfão. Histórico fica inconsistente.
- **Fix sugerido:** No interceptor, **primeiro handoff tool encontrado wins; demais tool_uses do mesmo turn são vetados com erro tipado** `multiple_handoff_in_turn`. Documentar comportamento. ≤8 linhas de código.

### EC-2: `inputFilter` throw kill o handoff inteiro silenciosamente
- **Task afetada:** T2.1 (filter application)
- **Família:** Error handling
- **Cenário:** Consumer escreve `inputFilter: (h) => { return processViaExternalAPI(h); }` que pode throw (network, etc). Plano fala "default = full history" mas não documenta o que acontece se o filter throw.
- **Impacto:** Receiver não recebe nada / sender's loop crasha sem explicação. Bug em código do user (filter) derruba run.
- **Fix sugerido:** Wrap o filter em try/catch igual `safeHook` (D204). Fallback = **full history** (default). Log warn "[handoff] inputFilter threw, falling back to full history". ≤5 linhas.

### EC-3: `onHandoff` async throw deveria abortar handoff (não silenciar)
- **Task afetada:** T2.1 (onHandoff invocation)
- **Família:** Error handling
- **Cenário:** Plano lista `onHandoff` como "side effect callback" mas NÃO especifica se throw aborta. Semanticamente: se o callback é validação/auditoria ("posso fazer este handoff?"), throw DEVE abortar. Se é só logging, deveria swallowar. O plano não decide.
- **Impacto:** Ambiguidade. Code deploy depende de comportamento; consumer não sabe se throw é "abort" ou "warn".
- **Fix sugerido:** **Throw aborta o handoff** (tool retorna `isError: true`, LLM vê o erro, decide próximo passo). Documentar explicitamente em ADR D222 docstring + tests. Side-effect-only consumers usam try/catch interno. ≤3 linhas de fix + 2 tests + docstring update.

### EC-4: `inputType` Zod schema com `inputJson` null / empty
- **Task afetada:** T2.1 (Zod parsing)
- **Família:** Input / Format
- **Cenário:** LLM invoca `transfer_to_X` sem JSON args (alguns providers fazem isso quando `inputJson_schema = z.object({}).optional()`). Atual `Zod.parse(null)` ou `Zod.parse(undefined)` throws — handoff vira tool-error em vez de transferir.
- **Impacto:** Handoff sem payload nunca funciona; especialmente quebra ao migrar usuários do OpenAI Agents (lá funciona).
- **Fix sugerido:** Quando `inputType === undefined`, **skip o parse inteiro**; quando definido E input vazio, tentar parsear `{}` ANTES de fallback pra erro. Pattern: `const parsed = inputType ? inputType.safeParse(input ?? {}) : { success: true, data: undefined }`. ≤6 linhas.

### EC-5: Receiver agent disposed entre `Agent.create` e primeiro handoff
- **Task afetada:** T2.1 (dispatcher)
- **Família:** Resource / Lifecycle
- **Cenário:** Consumer faz `await receiver.dispose()` enquanto `sender` ainda tem o `receiver` em `handoffs[]`. LLM invoca o handoff tool → dispatcher tenta `receiver.send()` → throw "agent disposed" (ou pior, silent corruption).
- **Impacto:** Crash difícil de debugar; user vê "agent disposed" sem entender qual.
- **Fix sugerido:** Em `dispatcher.ts`, **antes do `receiver.send()`, checar se receiver está disposed**. Se sim, throw `HandoffReceiverDisposedError(receiverAgentId)` com mensagem clara. ≤4 linhas + 1 error class.

## SHOULD TEST

### EC-6: Receiver tem ele mesmo nos seus `handoffs[]` (ciclo direto)
- **Task afetada:** T2.1
- **Teste sugerido:** `test_handoff_self_reference_at_create_time_throws` — `Agent.create({ name: "a", handoffs: [self_reference] })` deve throw na criação (não na primeira invocação). Idealmente: `HandoffSelfReferenceError`. Plano não cobre.

### EC-7: Receiver com personalidade ativa diferente do sender
- **Task afetada:** T2.1
- **Teste sugerido:** `test_handoff_preserves_receiver_personality` — sender com `coder` personality, receiver com `poet`. Após handoff, receiver responde com voz `poet`, NÃO `coder`. Aliado a D162 + D164 (personalidade switch preserva history + re-injeta). Não regressão.

### EC-8: `maxHandoffDepth: 0` (consumer desabilita inteiro)
- **Task afetada:** T2.1
- **Teste sugerido:** `test_max_handoff_depth_zero_disables_handoffs` — `Agent.create({ handoffs: [...], maxHandoffDepth: 0 })`. Expected: tools NÃO injetados (ou injetados mas qualquer invocação rejeita imediatamente). Decidir comportamento + lock no test.

### EC-9: `handoffs: []` (array vazio)
- **Task afetada:** T2.1
- **Teste sugerido:** `test_handoffs_empty_array_is_noop` — Zod schema deve aceitar `[]`; nenhum tool injetado; agent behavior idêntico a `handoffs: undefined`.

### EC-10: `inputFilter` retorna history vazio
- **Task afetada:** T2.1
- **Teste sugerido:** `test_input_filter_empty_history_handoff_still_works` — filter retorna `{ messages: [] }`. Receiver começa nova conversa sem contexto. Verificar que receiver.send() funciona (pode ser intencional pra reset).

### EC-11: Histórico do sender tem tool_use sem tool_result pareado
- **Task afetada:** T2.1
- **Teste sugerido:** `test_handoff_history_pairs_tool_use_with_synthetic_result` — quando o handoff tool é o ÚLTIMO ato do sender, o history que vai pro receiver tem `tool_use` (do handoff) SEM `tool_result`. LangGraph documenta isso explicitamente (search result). Se não inserir um synthetic `tool_result` ack, receiver pode crashar no primeiro turn. Crítico para Anthropic/Claude.

## DOCUMENT

### EC-12: Tokens explodem em chain de handoffs com full history
- **Risco aceito:** A chain triage→billing→escalation com full history (D216 default) duplica o context window a cada hop. 3 hops = 3× tokens. Mitigation já listada em "Risks & Mitigation": `inputFilter` é o cost-control. Adicionar nota em §Handoffs do docs.md: "rule of thumb: depths >2 deveriam usar `inputFilter` para summarize/truncate ou aceitar cost."

### EC-13: LLM ignora handoff tool quando system prompt não menciona
- **Risco aceito:** Plano JÁ documenta isso ("RECOMMENDED_PROMPT_PREFIX" + "system prompt should mention handoff options"). Reinforce: adicionar `Handoff.RECOMMENDED_SYSTEM_PROMPT_PREFIX` constante exportada igual OpenAI faz.

### EC-14: Provider local (Ollama llama3.2:3b) inconsistente em tool calling
- **Risco aceito:** Já no plano via "Risks" — Provider tool-calling weak (Ollama small models). Reforçar no example README: handoffs precisam de Llama 3.1 8B+ OU Mistral 7B+ OU cloud (gpt-4o-mini works).

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 11 | 5 (EC-1..5) | 6 (EC-6..11) | 0 |
| T7.1 | 2 | 0 | 0 | 2 (EC-12, EC-13) |
| T8.1 | 1 | 0 | 0 | 1 (EC-14) |
| **TOTAL** | **14** | **5** | **6** | **3** |

**Veredicto: PLANO PRECISA DE AJUSTE**

5 MUST FIX precisam ser absorvidos antes da implementação:

- **EC-1** (paralelo handoff) — comportamento ambíguo em LLMs modernos; precisa decisão de design
- **EC-2** (inputFilter throw) — bug user-code derruba run inteiro
- **EC-3** (onHandoff semantics) — semântica ambígua entre validação vs side-effect
- **EC-4** (Zod null input) — quebra interop com OpenAI Agents convention
- **EC-5** (disposed receiver) — crash difícil de debugar

6 SHOULD TEST viram RED tests em T2.1. 3 DOCUMENT viram notas no docs.md + exemplos.

## Próximos passos

1. Atualizar `agent-handoffs-plan.md`:
   - ADR D222 `onHandoff` docstring: throw → abort handoff
   - T2.1 acceptance criteria: EC-1 winner-takes-all + diagnostic tool_error pros perdedores
   - T2.1 `safeFilter` wrapper (EC-2)
   - T2.1 Zod null/undefined input handling (EC-4)
   - T2.1 disposed-receiver check + error class `HandoffReceiverDisposedError` (EC-5)
   - +6 RED tests pros SHOULD TEST
   - 3 notas DOCUMENT no docs.md §Handoffs / README
2. Apresentar plan final.
