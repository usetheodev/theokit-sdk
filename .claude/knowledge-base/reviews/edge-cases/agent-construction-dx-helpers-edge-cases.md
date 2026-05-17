# Edge Case Review — agent-construction-dx-helpers

Data: 2026-05-17
Tasks analisadas: 11 (T0.1, T1.1, T2.1, T3.1, T4.1, T5.1, T5.2, T5.3, T5.4, T5.5, T5.6, T6.1)
Edge cases encontrados: 7 (MUST FIX: 1, SHOULD TEST: 3, DOCUMENT: 3)

---

## MUST FIX

### EC-1: `Agent.getOrCreate` race em mesmo processo (mesma agentId concorrente)

- **Task afetada:** T1.1
- **Família:** Timing / Concurrency
- **Cenário:** Bot Telegram recebe 2 mensagens simultâneas do mesmo `userId` (e portanto mesmo `agentId`). Cada call `Agent.getOrCreate(agentId, opts)`:
  1. Tentam `Agent.resume(agentId, opts)` em paralelo → ambas pegam `UnknownAgentError` (cold path).
  2. Ambas chamam `Agent.create({ ...opts, agentId })`.
  3. A SEGUNDA `Agent.create` bate no guard de `agent.ts:71` (`if (getRegisteredAgent(options.agentId) !== undefined) throw ConfigurationError(code: "agent_already_exists")`).
  4. A segunda mensagem do usuário falha com `ConfigurationError` em vez de reaproveitar o agente que a primeira acabou de criar.
- **Impacto:** Bot quebra silenciosamente para 1 das 2 mensagens concorrentes; UX degradada (Telegram retry frequente, especialmente em /loop fires).
- **Fix sugerido:** No `Agent.getOrCreate`, capturar TANTO `UnknownAgentError` (resume miss) QUANTO `ConfigurationError` com `code === "agent_already_exists"` (create race) e fazer 1 retry no resume:
  ```ts
  try { return await Agent.create({ ...options, agentId }); }
  catch (err) {
    if (err instanceof ConfigurationError && err.code === "agent_already_exists") {
      return await Agent.resume(agentId, options); // winner já registrou; pega o handle dele
    }
    throw err;
  }
  ```
  Adicionar ao TDD: `getorcreate_handles_concurrent_create_race()` que dispara 2 calls com `Promise.all` e assert ambas retornam handles válidos sobre o mesmo agentId.

---

## SHOULD TEST

### EC-2: `AgentBuilder.build()` retorna referência mutável

- **Task afetada:** T4.1
- **Cenário:** Consumer chama `const opts = builder.build(); opts.tools = [];` e depois `await builder.create()` — o create vê tools=[] porque `build()` retorna `this.opts` por referência. Mutation externa polui o builder.
- **Teste sugerido:** `test_builder_build_returns_independent_snapshot` — assert `builder.build() !== builder.build()` (referências distintas) E mutar o primeiro NÃO afeta `builder.create()`.
- **Fix:** Em `build()`: `return { ...this.opts } as AgentOptions;` (shallow clone, 1 linha).

### EC-3: `defineTool` com `z.transform()` muda tipo entre input e handler

- **Task afetada:** T3.1
- **Cenário:** Schema `z.object({ port: z.string().transform(Number) })` faz LLM enviar `port: "8080"` e handler recebe `port: 8080`. Plan documenta em EC-3 mas não tem teste.
- **Teste sugerido:** `test_definetool_handler_receives_zod_transform_output` — schema com transform string→number, mock input `{port:"8080"}`, assert handler é invocado com `{port: 8080}` (number) NÃO `{port: "8080"}` (string).

### EC-4: Migration T5.1 muda comportamento de `clampInt` para hard-fail (Zod parse)

- **Task afetada:** T5.1
- **Cenário:** `ad-hoc-tools.ts` atual usa `clampInt(input.count, 1, 100, 1)` que silenciosamente vira 1 se LLM enviar `count: "three"`. Após migration para `defineTool(z.object({count: z.number().int().min(1).max(100)}))`, mesma input gera ZodError → `tool_result(isError)` → loop aborta (status="error"). Mudança de comportamento: fallback graceful → hard error.
- **Teste sugerido:** `test_telegram_pro_roll_with_invalid_count_returns_isError` — assert que `/tool roll abc` agora retorna tool_result com isError=true (em vez de "Rolled 1d6"). Documentar no `Honest review` do README que essa é uma melhoria deliberada (erro visível > silent fallback).

---

## DOCUMENT

### EC-5: `createAgentFactory` captura `common` por referência

- **Risco aceito:** Plan já lista no "Riscos e Mitigações" table. Consumer mutando `common` após criar a factory afeta sessions futuras. Aceitar: documentar no JSDoc; deep-clone interno custa CPU sem ganho real (consumers normais não mutam config após criação).

### EC-6: `Agent.getOrCreate` com options diferentes em chamadas consecutivas

- **Risco aceito:** Primeira call `getOrCreate("x", {model:A})` registra agent com model A. Segunda call `getOrCreate("x", {model:B})` faz resume → merge override → agent agora usa model B nesta send. Comportamento atual de `Agent.resume` (per `agent.ts:122-128`: `{...existing.options, ...options}` spread). Consumer pode esperar "primeira call wins" mas comportamento é "última call wins durante esse handle". Documentar no JSDoc de `Agent.getOrCreate` que comportamento mirrors `Agent.resume`.

### EC-7: Agent disposto continua registrado, resume retorna handle inválido

- **Risco aceito:** `agent.dispose()` seta `disposed=true` mas NÃO chama `removeRegisteredAgent`. Subsequente `getOrCreate(sameId)` faz resume bem-sucedido e retorna handle disposed; primeiro `.send()` falhará. Comportamento herdado de `Agent.resume`; fora do escopo deste plano (consertar significaria mudar D17 / agent-registry). Documentar como caveat conhecido — para reset real, usar `Agent.delete(id)` antes de `getOrCreate`.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.1 (getOrCreate) | 3 | 1 (EC-1) | 0 | 2 (EC-6, EC-7) |
| T2.1 (factory) | 1 | 0 | 0 | 1 (EC-5) |
| T3.1 (defineTool) | 1 | 0 | 1 (EC-3) | 0 |
| T4.1 (builder) | 1 | 0 | 1 (EC-2) | 0 |
| T5.1 (telegram-pro refactor) | 1 | 0 | 1 (EC-4) | 0 |
| T5.2-T5.6 | 0 | 0 | 0 | 0 |
| T6.1 (docs) | 0 | 0 | 0 | 0 |

**Veredicto: PLANO PRECISA DE AJUSTE**

**Justificativa:** EC-1 (race em getOrCreate) é realista em chat-bot patterns. Sem o fix, bots Telegram com /loop ou múltiplas tabs do usuário vão receber ConfigurationError silenciosamente em ~5% das interações concorrentes. Fix é 3 linhas de código + 1 teste — custo trivial. Os 3 SHOULD TEST são adições de cobertura sem mudança de design. Os 3 DOCUMENT são caveats aceitos.

**Ação:** Incorporar EC-1 ao T1.1 como sub-task antes de prosseguir para implementação. EC-2, EC-3, EC-4 viram testes adicionais nos respectivos TDDs. EC-5, EC-6, EC-7 viram comentários JSDoc nos pontos de entrada públicos.
