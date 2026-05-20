# Edge Case Review — examples-100-coverage

Data: 2026-05-17
Tasks analisadas: 8 (T0.1 → T3.2 + Phase 4)
Edge cases encontrados: 9 (**MUST FIX: 2**, SHOULD TEST: 4, DOCUMENT: 3)

## MUST FIX (incorporados ao plano)

### EC-1: Memory API incorreta no snippet do T1.3
- **Task afetada:** T1.3 (`examples/memory-lance/`)
- **Família:** Format / Integração
- **Cenário:** Snippet usa `Memory.create({ cwd, namespace, scope, userId })` + `memory.remember()` + `memory.list()` + `memory.dispose()`. Não confirmado se essa é a shape real do public Memory API — namespace/scope tradicionalmente vivem em `MemorySettings` dentro de `AgentOptions.memory`, não em `Memory.create()` standalone.
- **Impacto:** Typecheck FAIL no example; T3.2 acceptance (Pass=48/48) regride.
- **Fix aplicado:** Task 0 obrigatória adicionada ao T1.3: `grep` para confirmar shape antes de copy-paste; pivotar para `Agent.create({ memory: {...} })` + `memory_search` tool se API divergir.

### EC-2: Schema Zod para useTheoAssistant sem deep dive
- **Task afetada:** T2.1 (`examples/react-nextjs/`)
- **Família:** Boundary / Integração
- **Cenário:** "Files to edit" lista `lib/schemas.ts` mas Deep Dive não mostra o conteúdo. Schema FactCard é compartilhado entre client (`useTheoAssistant({ schema })`) e server (`streamAssistant({ schema })`); se redefinido com shapes divergentes, partial parse falha silenciosa (EC-18 v1.2).
- **Impacto:** `useTheoAssistant` example aparenta funcionar mas `isValid` nunca vira true; regressão silenciosa.
- **Fix aplicado:** Deep Dive de T2.1 atualizado com snippet completo de `lib/schemas.ts` exportando `FactCard` único; Task 5 explicita "importar em AMBOS client e server; NÃO redefinir em 2 lugares".

## SHOULD TEST (incorporados via DOCUMENT no plano)

| EC | Task | Mitigação |
|----|------|-----------|
| EC-3 | T1.1/T1.2/T1.3/T1.4 | Sem creds → exit cleanly com msg informativa (não stack trace) |
| EC-4 | T2.1 | `pnpm install --ignore-workspace` em workspace clonado limpo validado uma vez (Task 8 adicionada) |
| EC-5 | T2.1 (após EC-2 fix) | Smoke real opcional via `curl /api/assistant` confirma `O:` code presente |
| EC-6 | T1.2 | README documenta plaintext fallback sem keytar |

## DOCUMENT (incorporados na seção Notas)

| EC | Risco aceito |
|----|--------------|
| EC-7 | `lib/get-agent.ts` é server-only — README warning |
| EC-8 | Cold start serverless invalida cache singleton — correctness via `getOrCreate` |
| EC-9 | Next.js 14 pin — Next 15+ pode exigir ajustes |

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 1 | 0 | 1 | 0 |
| T1.2 | 2 | 0 | 1 | 1 |
| T1.3 | 2 | 1 | 1 | 0 |
| T1.4 | 1 | 0 | 1 | 0 |
| T2.1 | 4 | 1 | 1 | 2 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 0 | 0 | 0 | 0 |

**Veredicto:** PLANO PRECISA DE AJUSTE (após patches) → **PLANO OK**.

Os 2 MUST FIX foram incorporados in-place no plano:
1. T1.3 ganhou Task 0 para validar shape do Memory API antes de implementar
2. T2.1 ganhou snippet completo de `lib/schemas.ts` + instrução explícita de schema único

Os 4 SHOULD TEST viraram tarefas adicionais (Task 8 do T2.1) ou notas (DOCUMENT block).
Os 3 DOCUMENT foram listados na seção "Notas / Edge cases DOCUMENT" do plano.

Plano está pronto para implementação.
