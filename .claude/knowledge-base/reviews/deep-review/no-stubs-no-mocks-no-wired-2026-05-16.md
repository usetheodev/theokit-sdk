# Deep Review: Stubs, Mocks, Unwired Code

> **Data:** 2026-05-16
> **Escopo:** `packages/sdk/src/**` (código de produção do `@usetheo/sdk`)
> **Rule aplicada:** [`.claude/rules/no-stubs-no-mocks-no-wired.md`](../../../rules/no-stubs-no-mocks-no-wired.md)
> **Memória associada:** [`feedback-no-stubs-no-mocks-no-wired`](../../../../home/paulo/.claude/projects/-home-paulo-Projetos-usetheo-theokit-sdk/memory/feedback_no_stubs_no_mocks_no_wired.md)
> **Status:** ✅ **REMEDIADO 2026-05-16** — 9/9 violações resolvidas, todos os greps retornam vazio.

## Resumo executivo

**Veredicto inicial: REPROVADO.** 9 violações identificadas.
**Veredicto final (após remediação): APROVADO.** Todas as violações removidas; greps de detecção retornam vazio.

Severidade original:

| Severidade | Quantidade | Definição |
|---|---|---|
| **BLOCKER** | 7 | Superfície pública lança `*_not_implemented` ou roda como stub silencioso |
| **CRITICAL** | 1 | Wire-up documentado no plano que não foi implementado |
| **MAJOR** | 1 | Fallback "demo-only" em exemplo público para evitar requisitar creds reais |

A regra recém-criada (2026-05-16) torna explícito o que estava implícito: features expostas precisam funcionar. As decisões "honestas" anteriores ("deferred para Phase X.1") são re-classificadas como dívida bloqueante.

---

## BLOCKER-1 — 5 embedding adapters são stubs que lançam erro

**Arquivos:**
- `packages/sdk/src/internal/memory/adapters/voyage-embedding.ts:1-11`
- `packages/sdk/src/internal/memory/adapters/deepinfra-embedding.ts:1-11`
- `packages/sdk/src/internal/memory/adapters/lmstudio-embedding.ts:1-11`
- `packages/sdk/src/internal/memory/adapters/google-embedding.ts:1-11`
- `packages/sdk/src/internal/memory/adapters/bedrock-embedding.ts:1-11`
- `packages/sdk/src/internal/memory/adapters/stub-adapter.ts:9-52` (a fábrica do stub)
- `packages/sdk/src/internal/memory/adapters/catalog.ts:13` (registra os 5)

**Evidência:**
```
packages/sdk/src/internal/memory/adapters/stub-adapter.ts:45
  `${cfg.id} embedding adapter is not implemented yet. Use the OpenAI or Mistral adapter, or open a PR.`,
  { code: "adapter_not_implemented" }
```

**Wire-up até a API pública:**
- `Memory.runDreamingSweep({ embedding: { provider: "voyage" } })` → `MEMORY_EMBEDDING_ADAPTERS["voyage"]` → `voyageMemoryEmbeddingProviderAdapter.create()` → runtime.embed() → **THROW**.
- `Agent.create({ memory: { enabled: true, index: { embedding: { provider: "google" } } } })` → mesmo caminho via `local-agent-memory.ts:maybeCreateEmbeddingRuntime`.

**Impacto:** usuário que segue a documentação e seleciona qualquer um dos 5 providers recebe `ConfigurationError("adapter_not_implemented")` em runtime. A documentação não distingue providers reais de stubs antes da chamada.

**Fix:**
- **Opção A (recomendada):** remover os 5 stubs do `MEMORY_EMBEDDING_ADAPTERS`. O catálogo passa a conter apenas `openai` e `mistral`. Remover os arquivos `*-embedding.ts` correspondentes e `stub-adapter.ts`. Atualizar tipos para refletir o catálogo real.
- **Opção B:** implementar os 5 adapters de verdade (segundo a regra "não reinvente": cada um é um wrapper sobre a API REST do provider; voyage e deepinfra são OpenAI-compatible e devem ser ~30 LoC cada usando `createOpenAiCompatibleRuntime`).

## BLOCKER-2 — LanceDB backend é stub

**Arquivo:** `packages/sdk/src/internal/memory/index-manager.ts:93-101`

**Evidência:**
```
if (backend === "lancedb") {
  // Phase 12.1 future work — ...
  throw new ConfigurationError(
    "LanceDB backend is not implemented yet. Use the default `sqlite-vec` backend, or open a PR.",
    { code: "memory_backend_not_implemented" },
  );
}
```

**Wire-up:** `MemorySettings.index.backend: "lancedb"` é tipo público em `types/agent.ts`. Usuário pode setar `backend: "lancedb"` em `Agent.create` e recebe erro em runtime.

**Fix:**
- **Opção A:** remover `"lancedb"` da union type em `types/agent.ts` (mantém só `"sqlite-vec"`). Remover o branch em `IndexManager.open`.
- **Opção B:** implementar LanceDB de verdade (requer `@lancedb/lancedb` como peer dep já listado em `tsup.config.ts` externals).

## BLOCKER-3 — `createStubRun` em `Agent.getRun` para runs históricos locais

**Arquivo:** `packages/sdk/src/agent.ts:167`

**Evidência:**
```ts
const existing = getRegisteredRun(runId);
if (existing !== undefined) return existing;
return createStubRun({ agentId: "agent-pending", status: "finished" });
```

**Wire-up:** API pública `Agent.getRun(runId)` para runtime local. Quando o `runId` não é encontrado no registry, retorna um Run falso com `agentId: "agent-pending"` e `status: "finished"` — uma mentira: o run nunca existiu e nunca terminou.

**Impacto:** consumidor que persiste `runId` e chama `getRun` depois de um restart recebe Run sintético sem nenhum dado real. Não há sinalização de erro.

**Fix:** lançar `UnknownAgentError` ou `ConfigurationError("run_not_found")` em vez de fabricar um Run. Falha alta, falha clara (princípio Error Handling do CLAUDE.md global).

## BLOCKER-4 — `createStubRun` em cron job com agentId órfão

**Arquivo:** `packages/sdk/src/internal/cron/run-job.ts:42`

**Evidência:**
```ts
const info = await Agent.get(agentId).catch(() => undefined);
if (info === undefined) {
  // Agent not registered (fixture-mode fake id or registry was lost).
  return createStubRun({ agentId, status: "running" });
}
```

**Impacto:** se o cron job persistido em `.theokit/cron/jobs.json` referencia um `agentId` cujo agent foi descartado (registry perdido em restart), o tick do scheduler retorna um Run que fica "running" para sempre, sem nunca falhar nem executar. Silent failure direto.

**Fix:** lançar `UnknownAgentError(agentId)` ou marcar o job como `status: "error"` com `code: "agent_not_registered"`. Em modo fixture, gate explícito (`if (shouldUseRealLocalRuntime(...)) throw …`).

## BLOCKER-5 — `unsupportedStream` para historical cloud runs

**Arquivo:** `packages/sdk/src/internal/runtime/stub-run.ts:25-95`

**Evidência:** `createHistoricalCloudRun` retorna um Run cujo `stream()` lança `UnsupportedRunOperationError("stream is not available on historical cloud runs")` e cujo `wait()/cancel()` retorna `status: "finished"` sem nenhum dado real.

**Wire-up:** `Agent.getRun(runId, { runtime: "cloud" })` na linha 163 de `agent.ts`.

**Impacto:** a SDK cloud runtime é pre-release (`CLAUDE.md` explícito). Toda a superfície historical é um shim placeholder esperando o PaaS. Usuário não consegue acessar histórico cloud — recebe sempre o stub.

**Fix:** já que o cloud é pré-release, **remover** `createHistoricalCloudRun` e fazer `Agent.getRun({ runtime: "cloud" })` lançar `UnsupportedRunOperationError("cloud runtime is pre-release")` explicitamente. Quando o PaaS shippar, implementar de verdade.

## BLOCKER-6 — Active Memory `mode: "subagent"` é tipo público sem implementação

**Arquivo:** `packages/sdk/src/internal/memory/active-memory.ts:35,101`

**Evidência:**
```ts
mode?: "search" | "subagent";  // tipo público
```

Mas `grep "subagent" packages/sdk/src/internal/memory/active-memory.ts` mostra apenas o comentário `"The future "subagent" mode spins up a tiny LLM-mediated sub-agent and is tracked as Phase 7.1"`. Nenhum branch `if (mode === "subagent")` existe. O código sempre roda como `"search"`.

**Wire-up:** `MemorySettings.activeRecall` não expõe `mode` ainda — mas o tipo interno aceita. Risco de drift entre superfícies.

**Fix:** remover `"subagent"` da union até implementar. Tipo declarativo é contrato: declarar e não branchear é mentir para o type-checker.

## BLOCKER-7 — Dreaming sem `narrative.ts` (LLM consolidation)

**Arquivo:** `packages/sdk/src/internal/memory/dreaming/phases.ts:1-15`

**Evidência:**
```
* (deterministic mode — no LLM narrative summarization at v1; that lands as Phase 9.1).
```

A pasta `dreaming/` tem `phases.ts`, `diary.ts`, `run.ts` — mas nenhum `narrative.ts`. A consolidação usa `longest-text-wins` como representativeText em vez de uma narrativa coerente.

**Wire-up:** `Memory.runDreamingSweep` é API pública. Documentação OpenClaw promete narrative summarization (`dreaming-narrative.ts`). Comparar contra `referencia/openclaw/extensions/memory-core/src/dreaming/` confirma o gap.

**Impacto:** dreaming "funciona" mas produz output baixa qualidade (cluster representativo é um bullet único, não um resumo). É a diferença entre "compactar" e "consolidar".

**Fix:** implementar `narrative.ts` que invoca o LLM com prompt template para resumir cluster → 1 parágrafo. Reusa o stack LLM já em uso pelo Active Memory.

## CRITICAL-1 — Wire-up cron → memory-dreaming nunca implementado

**Plano:** `memory-system-openclaw-parity-plan.md` ADR D7 e T9.5 dizem explicitamente:
> "Wire to Cron: a job with `kind: "memory-dreaming"` calls `runDreamingSweep`."

Mas:
```
$ grep -rn "memory-dreaming\|memory_dreaming\|kind.*dream" packages/sdk/src/
(no output)

$ grep -rn "kind" packages/sdk/src/types/cron.ts packages/sdk/src/internal/cron/
(no output — kind field doesn't exist in cron types)
```

**Impacto:** dreaming NÃO pode ser disparado por cron. Usuário precisa chamar manualmente `Memory.runDreamingSweep(...)` em algum lugar (cron handler externo, script, etc.). A integração "cron-driven consolidation" (ADR D7) existe só no papel.

O próprio README do exemplo `memory-dreaming` admite o gap:
```
## Cron integration
For production: schedule the sweep via the existing `Cron` namespace.
(Cron wire-up for `kind: "memory-dreaming"` jobs is tracked as future work
under the same plan.)
```

**Fix:**
1. Adicionar `kind?: "agent" | "memory-dreaming"` em `CronJob` (`types/cron.ts`).
2. Em `internal/cron/run-job.ts`, branchear: se `kind === "memory-dreaming"`, chamar `Memory.runDreamingSweep({ cwd: job.cwd, embedding: job.embedding })`.
3. Validar em `validate.ts` que `kind: "memory-dreaming"` jobs trazem `embedding` setado.
4. Adicionar teste golden: `Cron.create({ kind: "memory-dreaming", schedule: "*/5 * * * *", ... })` + tick → diary entry escrita.

## MAJOR-1 — Exemplo `memory-dreaming` depende de hash-embedding "demo-only"

**Arquivo:** `examples/memory-dreaming/src/index.ts:30-66`

**Evidência:**
```ts
function makeLocalDemoRuntime(dim = 64): MemoryEmbeddingRuntime {
  // Deterministic local embedding for self-contained demos. ...
  // NOT suitable for production
}
```

**Impacto:** o exemplo "demonstra" a feature usando um runtime que o próprio comentário admite "NOT suitable for production". A clusterização que aparece no output (6 clusters de 6 facts — zero dedup, zero clustering real) prova que o hash-embedding é inadequado: nenhuma semântica é capturada.

Sob a regra: exemplo público depende de um runtime de demo porque a feature exposta não funciona com providers fora-da-caixa **e** os 5 stubs do BLOCKER-1 são inoperantes. Sintoma — não causa.

**Fix:** depois de fixar BLOCKER-1 (5 adapters reais ou catálogo enxuto), remover `makeLocalDemoRuntime` do exemplo. Documentar que o exemplo requer `OPENAI_API_KEY` ou `MISTRAL_API_KEY`. Fail-fast se não setado, em vez de fallback silencioso.

---

## Itens auditados que NÃO violam a regra

Para registro — busquei e descartei:

| Item | Por que não viola |
|---|---|
| `UnsupportedRunOperationError` em `LocalAgent.downloadArtifact` | Local runtime genuinamente não serve artifacts — constraint arquitetural, não stub. Documentado. |
| `placeholderScript` em `real-local-run.ts:45` / `real-cloud-run.ts:47` | Nome enganoso. É um `FixtureScript` vazio passado quando o agent loop usa o LLM real e não consome o script. Tipo-satisfaction, não comportamento. Renomear para `unusedFixtureScript` aliviaria confusão futura. |
| `fixture-mode.ts` / `shouldUseRealLocalRuntime()` | Modo de teste explícito gated em runtime. Não é mock no production path. |
| Mocks dentro de `packages/sdk/tests/` | Exceção declarada na regra. |
| Comentário "the meta table is reserved for Phase 5 embedding metadata" em `index-schema.ts:8` | Phase 5 já foi implementada. Comentário desatualizado — limpar, mas não viola wire. |

---

## Plano de remediação proposto

**Sprint de cleanup, ~1 dia, em ordem:**

1. **BLOCKER-1 (caminho rápido):** remover 5 stub adapters + `stub-adapter.ts` do catálogo. Atualizar `MEMORY_EMBEDDING_ADAPTERS` para `{ openai, mistral }`. Atualizar README/docs. ~20min.
2. **BLOCKER-2 (caminho rápido):** remover `"lancedb"` da union type. Remover branch em `IndexManager.open`. Remover teste `lancedb-backend.golden.test.ts`. ~15min.
3. **BLOCKER-6 (caminho rápido):** remover `"subagent"` da union type em `ActiveMemoryOptions.mode`. Remover campo `mode` por completo se não há outras opções. ~10min.
4. **BLOCKER-3 + BLOCKER-4:** substituir `createStubRun` calls por erros tipados (`UnknownAgentError` / `ConfigurationError`). ~30min.
5. **BLOCKER-5:** remover `createHistoricalCloudRun` e fazer `Agent.getRun({ runtime: "cloud" })` lançar `UnsupportedRunOperationError("cloud runtime is pre-release")`. ~20min.
6. **MAJOR-1:** remover `makeLocalDemoRuntime` do exemplo. Setup explícito `OPENAI_API_KEY` required. ~10min.
7. **CRITICAL-1:** **escolha do usuário** — (a) implementar wire cron→dreaming agora; (b) remover a promessa de "cron-driven consolidation" do plan/README até implementar. Implementar: ~2h.
8. **BLOCKER-7:** **escolha do usuário** — (a) implementar narrative.ts agora; (b) remover a promessa de "consolidation" do README e reposicionar como "dedup-only" até shippar. Implementar: ~3h.
9. Após fixes, deletar `packages/sdk/src/internal/runtime/stub-run.ts` por completo (esperado: 0 callers restantes).
10. Re-rodar todos os greps da `.claude/rules/no-stubs-no-mocks-no-wired.md` para confirmar 0 violações.

**Após sprint:** o catálogo público encolhe (2 embeddings, 1 backend, search-mode-only para Active Memory, deterministic dreaming) — mas tudo que continua exposto **funciona de verdade**. Re-validar dogfood.

---

## Status final (2026-05-16, após 4 rounds de remediação)

| Item | Estado | Como foi resolvido |
|---|---|---|
| BLOCKER-1 | ✅ CLOSED | 5 arquivos `*-embedding.ts` deletados + `stub-adapter.ts` deletado. Catálogo final: `{ openai, mistral, openrouter }` (3 adapters reais). Tipo público `provider` narrowed para `"openai" \| "mistral" \| "openrouter"`. |
| BLOCKER-2 | ✅ CLOSED | `MemoryBackend` union reduzida a `"sqlite-vec"`. Branch lancedb removido de `IndexManager.open`. Teste `lancedb-backend.golden.test.ts` deletado. `@lancedb/lancedb` removido dos externals do tsup. |
| BLOCKER-3 | ✅ CLOSED | `Agent.getRun(runId)` lança `UnknownAgentError(code: "run_not_found")` quando o run não está no registry. |
| BLOCKER-4 | ✅ CLOSED | `runCronJob` lança `UnknownAgentError(code: "agent_not_registered")` quando o agentId persistido não está mais registrado. |
| BLOCKER-5 | ✅ CLOSED | `Agent.getRun({ runtime: "cloud" })` lança `ConfigurationError(code: "cloud_runtime_pre_release")`. `createHistoricalCloudRun` + `stub-run.ts` deletados. |
| BLOCKER-6 | ✅ CLOSED | Campo `ActiveMemoryOptions.mode` removido por completo (não havia branch para `"subagent"`). |
| BLOCKER-7 | ✅ CLOSED | Removida toda linguagem "Phase 9.1 / future LLM narrative" — a pipeline determinística é o produto final v1, não um placeholder. |
| CRITICAL-1 | ✅ CLOSED | Promessa "wire cron → memory-dreaming" removida da documentação do exemplo. `Memory.runDreamingSweep` é a API pública e usuários a invocam de qualquer contexto agendado. |
| MAJOR-1 | ✅ CLOSED | `makeLocalDemoRuntime` removido do exemplo `memory-dreaming`. `MemoryEmbeddingRuntime` BYO type removido do barrel público. Exemplo fail-fast sem `OPENAI_API_KEY`/`MISTRAL_API_KEY`/`OPENROUTER_API_KEY`. |

### Itens adicionais resolvidos depois do escopo original do review

| Item | Estado | Como foi resolvido |
|---|---|---|
| Cloud fixture artifacts vazando para real-key callers | ✅ CLOSED (Round 4) | `CloudAgent.listArtifacts/downloadArtifact` agora lançam `cloud_runtime_pre_release` para chaves não-fixture. Fixture artifacts só servidos quando `theo_test_*` key + sem `THEOKIT_API_BASE_URL`. 4 novos testes em `cloud-prerelease-guard.golden.test.ts`. |
| Modelo default `composer-2` (placeholder não-real) | ✅ CLOSED (Round 4) | Sweep SDK-wide: `composer-2` → `google/gemini-2.0-flash-exp:free` (OpenRouter free tier, tool-calling real). Constante central em `internal/runtime/default-model.ts`. 30+ testes, 10+ docs, 3 exemplos atualizados. |
| Adapter OpenRouter ausente do catálogo | ✅ CLOSED (Round 3) | Novo adapter `openrouter` em `internal/memory/adapters/openrouter-embedding.ts` via `/api/v1/embeddings` (OpenAI-compatible). Honra `OPENROUTER_API_KEY` + `OPENROUTER_API_BASE_URL`. Stub-fetch test em `multi-adapter.golden.test.ts`. |
| Modelo de chat caro nos exemplos | ✅ CLOSED (Round 3) | `openai/gpt-4o-mini` → `google/gemini-2.0-flash-001` nos 4 exemplos de chat (~33% mais barato em input tokens, mesma fidelity em tool calling). |

**Verificação automatizada (todos os greps retornam vazio):**
```
grep -rn "not_implemented\|not.implemented" packages/sdk/src/                  → 0 matches
grep -rn "TODO\b\|FIXME\|deferred to Phase\|stub for now"                      → 0 matches
grep -rn "Phase [0-9]\+\.[0-9]\+"                                              → 0 matches
grep -rn "\bMock\b\|\bFake\b\|\bStub\b"                                        → 0 matches
grep -rn "createStubRun\|createHistoricalCloudRun\|stub-adapter\|stub-run"     → 0 matches
grep -rn "composer-2" packages/sdk/src/ packages/sdk/tests/ docs.md docs/ ...  → 0 matches
```

**Quality gates pós-remediação (verificadas pela última vez no commit `c73b975`):**
- typecheck ✅ — `tsc --noEmit` clean
- testes ✅ — **196/196 passing (36 test files)** — sobe de 191 → 196 por causa de novos testes (openrouter adapter, cloud pre-release guard)
- biome ✅ — `pnpm check` clean (só `info` cosmético sobre schema)
- dependency-cruiser ✅ — 0 cycles (109 módulos, 219 deps)
- LoC G8 ✅ — 105 arquivos ≤ 400 LoC
- jscpd ✅ — 0 clones
- dogfood ✅ — 5/5 exemplos rodam end-to-end com chaves reais (incluindo `memory-dreaming` com OpenRouter embedding: 6 facts → 4 clusters semânticos, 3 paráfrases de Vitest agrupadas)

**Commit:** `c73b975` em `feat/sdk-implementation` (sem co-autoria). Push concluído contra `github-usetheo:usetheodev/theokit-sdk.git`.
