# Cross-Validation — v1-completeness

Data: 2026-05-15
Plano: `.claude/knowledge-base/plans/v1-completeness-plan.md`
Veredicto: **APROVADO**

## Escopo

Verificar que cada wiring fix do plano (4 phases, 5 tasks) está implementado no código + coberto por teste + sem regressão na suite existente.

## Resultado por task

| Task | Implementado | Testes | Regressão | Status |
|------|--------------|--------|-----------|--------|
| T1.1 — Memory auto-write | `memory-store.ts` (helpers exportados) + `fixture-scripts.ts` (re-exporta) + `local-agent.ts maybePersistMemoryFactFromUserMessage` + `createFixtureRun` sem `persistMemoryFact` + example revertido | `memory-auto-write.golden.test.ts` (10 testes) | None — 188/188 verdes | ✅ |
| T2.1 — Provider inspector example | `examples/provider-inspector/{package.json,tsconfig.json,.env.example,.gitignore,src/index.ts,README.md}` + linha nova em `examples/README.md` | smoke-only (live dogfood) | None | ✅ |
| T3.0 — Agent.resume fix | `agent.ts:84-103` agora faz `await agent.initialize()` em ambos branches LocalAgent | `agent-resume.golden.test.ts` (2 testes) | None | ✅ |
| T3.1 — Resume example | `examples/resume-agent/{package.json,tsconfig.json,.env.example,.gitignore,src/index.ts,README.md}` + linha nova em `examples/README.md` | smoke-only (live dogfood) | None | ✅ |
| T4.1 — Cross-validation | Este relatório | N/A | N/A | ✅ |

## Cobertura dos ADRs

| ADR | Resolução | Evidência |
|-----|-----------|-----------|
| D1 — Detecta no user message | `LocalAgent.maybePersistMemoryFactFromUserMessage` chama `isMemoryWritePrompt(userText)` em `local-agent.ts` | `memory-auto-write.golden.test.ts` tests de pattern matching |
| D2 — Persist BEFORE LLM call | Chamada está em `send()` antes de `readMemoryForSend()` + `dispatchRun` | Test `localAgent_persists_remember_fact_on_real_send` |
| D3 — Layout de examples | `examples/provider-inspector` e `examples/resume-agent` espelham layout de `examples/quickstart` | Inspeção dos diretórios criados |
| D4 — Resume in-process | `examples/resume-agent` documenta limitação cross-process; README v1 limitation callout | README content |
| D5 — Inspector mostra ambas as APIs | `src/index.ts` chama `Theokit.providers.list()` + `agent.providers.routes()` | Inspeção do src |
| D6 — Resume awaits initialize() | `agent.ts:99-100` e `agent.ts:107-108` agora chamam `await agent.initialize()` para LocalAgent | Test `resume_loads_hooks_skills_context_just_like_create` |

## Cobertura dos edge cases

| EC | Descrição | Resolução | Teste |
|----|-----------|-----------|-------|
| EC-1 | `Agent.resume` missing `initialize()` | `agent.ts` fix em ambos branches | `agent-resume.golden.test.ts` |
| EC-2 | Double-write em fixture mode | `createFixtureRun` sem `persistMemoryFact` | Test `writes the fact exactly once in fixture mode` |
| EC-3 | Empty fact skip | Guard `if (fact.length === 0) return` em `maybePersistMemoryFactFromUserMessage` | Test `skips persistence when the extracted fact is empty` |
| EC-4 | memory.enabled gate | Top-level `if (memoryConfig?.enabled !== true) return` | Test `skips persistence when memory is not enabled` |
| EC-5 | provider-inspector requer THEOKIT_API_KEY | `.env.example` inclui `THEOKIT_API_KEY=theo_test_inspector` + README documenta | Inspeção do `.env.example` |
| EC-6 | Memory write concurrency limitation | Nota explícita em `examples/memory/README.md` "v1 limitations" | README content |

## Suite

- 188/188 testes verdes (`pnpm test:roadmap`)
- `pnpm typecheck` exit 0
- `pnpm check` (Biome) exit 0
- `pnpm run quality`:
  - knip — sem dead code
  - depcruise — 78 modules, 0 cycle violations
  - LoC — 74 files ≤ 400 LoC
  - jscpd — 0 clones, 8475 lines analisadas

## Observações

- O fix do `Agent.resume` (T3.0) é **monotônico** — callers que dependiam de comportamento errado (silenciosamente) agora ficam corretos; callers que não dependiam veem zero mudança. Cron's `runCronJob` agora também resolve com agentes corretamente inicializados.
- A remoção do `persistMemoryFact` redundante em `createFixtureRun` significa que o fixture path delega 100% da persistência ao código compartilhado em `send()`. Não há mais drift entre fixture e real-runtime para "Remember:" — ambos chamam o mesmo helper na mesma ordem.
- O guard `memoryConfig?.enabled !== true` em `maybePersistMemoryFactFromUserMessage` evita o crash do `this.options.memory!` non-null assertion (caso o usuário escreva "Remember:" sem ter habilitado memory).

**Sem BLOCKERs.** Implementação alinhada com cada ADR e EC do plano. Pronto para dogfood.
