# Cross-Validation — runtime-gaps-fix

Data: 2026-05-15
Plano: `.claude/knowledge-base/plans/runtime-gaps-fix-plan.md`
Veredicto: **APROVADO**

## Escopo

Verificar que cada wiring fix do plano (5 phases) está implementado no código + coberto por teste + sem regressão na suite existente. Comparar pattern contra as referências em `referencia/`.

## Resultado por fase

| Phase | Task | Implementado | Testes | Regressão | Status |
|-------|------|--------------|--------|-----------|--------|
| 1 | T1.1 onStep/onDelta | `loop.ts` + `loop-types.ts` + `local-agent.ts` + `real-local-run.ts` | `tests/golden/agent-loop/callbacks.golden.test.ts` (5) | None | ✅ |
| 2 | T2.1 FallbackLlmClient | `internal/llm/fallback-client.ts` (NEW) + `real-local-run.ts` wraps when chain > 1 | `tests/golden/llm/fallback-client.golden.test.ts` (6) | None | ✅ |
| 3 | T3.1 Pipeline | 5 new files under `internal/runtime/system-prompt/` | `tests/golden/runtime/system-prompt/pipeline.golden.test.ts` (17) | None | ✅ |
| 3 | T3.2 ContextPromptProvider | `providers/context-provider.ts` + `pipeline.default()` + `LocalAgent.send` wiring + `internalAssemblySnapshot()` on `FileContextManager` | `context-provider.golden.test.ts` (7) + `agent/system-prompt.golden.test.ts` E2E | None | ✅ |
| 4 | T4.1 SkillsPromptProvider | `providers/skills-provider.ts` + always-on skills.list() + `SkillsSettings.autoInject` | `skills-provider.golden.test.ts` (6) + 2 new E2E in `agent/system-prompt.golden.test.ts` | None | ✅ |
| 5 | T5.1 MemoryPromptProvider | `providers/memory-provider.ts` + memory read lifted to `send()` + `safeCall` wrap (EC-4) + `MemorySettings.autoInject` + `SystemPromptContext.memory` appended | `memory-provider.golden.test.ts` (5) + 2 new E2E in `agent/system-prompt.golden.test.ts` | None | ✅ |

## Cobertura dos ADRs

| ADR | Resolução | Evidência |
|-----|-----------|-----------|
| D1 — callbacks at iteration boundary | `runIteration` + `collectLlmEvents` invoke via `safeCall` | callbacks.golden.test.ts |
| D2 — FallbackLlmClient handshake-only retry | `tryFirstEvent` catches `NetworkError` on first `.next()`, mid-stream errors propagate | fallback-client.golden.test.ts (incl. `primary_yields_then_fails_does_NOT_failover`) |
| D3 — `<context>` block | ContextPromptProvider priority 10 | context-provider.golden.test.ts + system-prompt E2E |
| D4 — `<skills>` block | SkillsPromptProvider priority 20 | skills-provider.golden.test.ts + system-prompt E2E |
| D5 — `<memory>` block + appended `SystemPromptContext.memory` | MemoryPromptProvider priority 30 | memory-provider.golden.test.ts + system-prompt E2E |
| D8 — Strategy + Pipeline pattern | `SystemPromptPipeline` + `SystemPromptProvider` interface; default factory wires 4 providers; constructor rejects duplicate keys | pipeline.golden.test.ts (incl. EC-2 duplicate-key, EC-5 sync throw) |
| D9 — escapeBlockBody | 5 LoC helper used by Context, Skills, Memory providers; round-trip golden per provider | pipeline.golden.test.ts `escapeBlockBody` + per-provider injection-defence tests |

## Cobertura dos edge cases

| EC | Descrição | Resolução | Teste |
|----|-----------|-----------|-------|
| EC-1 | XML injection nos blocks | `escapeBlockBody` aplicado em cada provider | 3 injection-defence tests (context/skills/memory) |
| EC-2 | Duplicate (priority, id) providers | Constructor throws ConfigurationError code `pipeline_duplicate_provider` | `pipeline_rejects_duplicate_provider_key` |
| EC-3 | Aborted signal entre fallback attempts | `signal.aborted` check before each attempt; throws abort reason | `aborted_signal_skips_fallback_attempt` |
| EC-4 | Corrupt memory file crashes send | `safeCall(() => readMemoryFacts(...), [])` em `LocalAgent.readMemoryForSend` | `recovers_from_corrupt_memory_file` |
| EC-5 | safeCall must catch sync throws | Implementação chama `await fn()` dentro de try, capturando throws sincronos antes do await | `pipeline_isolates_synchronous_provider_throws` + `safeCall_returns_fallback_when_fn_throws_synchronously` |
| EC-6 | onStep semantics em cancelamento | Documentado em `examples/streaming-callbacks/README.md` | Doc (nenhum código) |
| EC-7 | Sem cross-provider budget em v1 | Documentado em `examples/skills/README.md` + `examples/memory/README.md` | Doc (nenhum código) |

## Cross-validation contra referências

| Referência | Pattern relevante | Nosso match |
|------------|-------------------|-------------|
| `referencia/pi/packages/agent` (Anthropic SDK lineage) | Streaming callbacks ao redor de SSE event loop | Nosso `collectLlmEvents` + `safeCall` segue mesma semântica `await` por callback |
| `referencia/openai-agents-python` (OpenAI Agents Py) | Resolver-style system prompt + appended fields | Field-append em `SystemPromptContext` (`memory` appended ao final) honra a convenção |
| Mastra (público, leituras de docs em Phase 6) | `<system_context>` style XML-tagged blocks com escape | Nosso pipeline gera XML-tagged blocks (`<context>`, `<skills>`, `<memory>`) com escape de body — mesmo padrão |
| Anthropic Messages API docs | `system` field como string única | Pipeline concatena os blocks em uma única string passada via `LlmRequest.system` |

**Sem BLOCKERs.** Padrões alinhados com o que as três referências fazem para sistemas multi-block + injeção-segura.

## Suite

- 176/176 testes verdes (vitest `pnpm test:roadmap`)
- 94/94 testes verdes na `pnpm test` (gate default G4)
- `pnpm typecheck` exit 0
- `pnpm check` (Biome) exit 0
- `pnpm build` exit 0
- `pnpm run quality` exit 0:
  - knip (G6) — dead code limpo
  - depcruise (G7) — 78 modules, 0 cycle violations
  - LoC (G8) — 74 files ≤ 400 LoC
  - jscpd (G10) — 0 clones

## OCP guarantee

Adicionar um futuro provider (ex: `EnvironmentPromptProvider`, `PluginsPromptProvider`) é:
1. Novo arquivo sob `src/internal/runtime/system-prompt/providers/`.
2. Uma linha em `SystemPromptPipeline.default()`.

Zero edits em `pipeline.ts assemble()`, `types.ts`, ou nos providers existentes — proven by Phase 4 e Phase 5: cada uma adicionou apenas um provider novo + uma linha no factory.
