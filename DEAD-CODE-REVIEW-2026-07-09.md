# Deep Review — Dead code no `theokit-sdk` (2026-07-09)

Evidência-based (knip configurado corretamente + 3 agentes de triagem adversarial cross-repo).
Escopo: `theokit-sdk/packages/*` (12 packages, ~68k LoC), cruzado com `theokit` e `theo-code-v2`.

## Método
- knip com config preciso (entry = 27 tsup entries + bins + testes). Zero-config dava 0 ou 625 (lixo);
  configurado → **6 files, 89 exports, 163 types** unused *dentro* do package.
- 3 camadas (knip só vê a 1): **(1)** dead in-package, **(2)** API pública sem consumidor, **(3)** packages órfãos.
- Exclusões: `node_modules`, `dist`, `.claude/knowledge-base/references/` (cópias de estudo — fonte de falso-positivo).

---

## Camada 1 — Dead code DENTRO do package `sdk`

### ✅ DELETE seguro agora — 6 barrels mortos (0 importadores; membros alcançados por path direto)
| Arquivo | Evidência |
|---|---|
| `src/internal/error-mappers/index.ts` | membros importados por path direto (anthropic.ts, openai.ts, …) |
| `src/internal/runtime/hooks/hooks-loader.ts` | `loadProjectHooks` tem **0 callers** (file inteiro morto) |
| `src/internal/tool-dispatch/index.ts` | membros por path direto / test-only |
| `src/internal/tool-registry/index.ts` | `ToolRegistry` tem 73 refs via `./registry.js` direto |
| `src/internal/workflow/index.ts` | `workflow.ts` faz `import("./internal/workflow/executor.js")` direto (bypassa o barrel) |
| `src/server/adapter/index.ts` | `@public` mas NÃO está em `exports` nem knip-entry; aliases com 0 refs |

⚠️ **Não** cascatear delete dos membros — eles vivem via import direto. Deletar só o barrel.

### ⚠️ Os "89 unused exports" NÃO são deletáveis em massa
O agente de verificação (adversarial) achou que a **maioria** é categoria B: `export` redundante num símbolo
**ainda usado no próprio arquivo** ou re-exportado por um barrel morto. Deletar o símbolo quebra a compilação.
Fix correto: **demote `export`→module-private** (ou remover a linha do barrel), não deletar o símbolo.

- **Categoria A — órfãos reais (delete candidato, ~9)**: `buildRequestId`, `resolveProviderChainAsync`
  (o irmão *sync* é usado!), `acquireAccessToken`, `deleteTokens`, `scanSubscriptions`, e os helpers
  `__*ForTests`/`createTestCtx` (cuidado: caller pode estar em teste futuro/excluído).
- **Categoria B — `export` redundante (NÃO deletar símbolo)**: `DEFAULT_BASE_URL`, `mapHttpStatusToError`,
  `buildAgentRef`, os 9 `DEFAULT_*_EMBEDDING_MODEL`, os re-exports `ANTHROPIC`/`OPENAI`, `validateBudgetName`,
  `packVector`, etc. (os hits "externos" são **cópias duplicadas** nos pacotes irmãos, fork do split SDK 2.0).
- **Categoria C — FALSO-POSITIVO knip (consumido!)**: `streamObjectImpl` (`agent.ts:253` dynamic-import
  destructure), `resolveSystemPromptWithMemoryAdditions` (usado + 3 testes), `mountSubscriptions` (teste).

### ✅ `jsonrepair` — FALSO-POSITIVO (NÃO remover)
Carregado via `req("jsonrepair")` lazy em `sanitize/coerce.ts:13` (string-keyed, intencional). Dep runtime real.

**Confiança:** os 6 barrels são delete seguro (alta). Os 89 exports **não** são bulk-delete — 2 do meu sample
estavam a um grep de uma deleção errada. Remediar 1-a-1 (demote export), não em lote.

---

## Camada 2 — API pública sem consumidor (evolve vs delete)

knip não vê isto (conta "alcançável de entry" = usado). Dos 26 subpaths não-`.`: **8 CONSUMED, 18 ZERO_CONSUMERS**.
"Zero consumidor nos NOSSOS repos" ≠ "zero consumidor npm externo" — só os `@internal` não-documentados são delete-safe já.

**CONSUMED (manter):** `./errors`, `./compaction`, `./project`, `./path-safety`, `./retry`, `./task-store`,
`./eval`, `./internal/persistence` (18 refs — o mais usado).

**Recomendação priorizada (ZERO_CONSUMERS):**
| # | Subpath | Recomendação | Racional |
|---|---|---|---|
| 1 | `./client` (`TheoKitClient`) | **DELETE (ciclo deprecation, 1 minor)** | contrato HTTP legado `/agent/send`, superado pelo `/api/agents/<name>` UIMessageStream do framework |
| 2 | `./internal/plugins` | **DELETE já** | `@internal`, sem doc, semver-exempt, 0 consumidor |
| 3 | `./internal/observability` | **DELETE já** | idem |
| 4 | `./internal/security` (subpath) | **remover subpath do exports, manter módulo** | módulo usado por path relativo; o *subpath* tem 0 uso |
| 5 | `./workflow` | **EVOLVE/decidir** | 385 LoC, tags `@internal`+`@public` conflitantes, sem adopter |
| 6 | `./subscription` | **EVOLVE (dogfood ou deprecate)** | feature `@public` completa, zero uptake |
| 7 | `./cron` | **EVOLVE (verificar bootstrap)** | tem side-effect de registro — investigar antes de tocar |
| 8 | `./a2a`, `./sandbox`, `./server/auth`, `./server/errors-envelope` | **KEEP (grace period)** | `@public` genuíno, não superado |
| 9 | `./models`, `./skills`, `./messages`, `./subagents`, `./concurrency`, `./sanitize` | **KEEP** | utils pequenos, puros, baratos |
| 10 | `./persistence` | **KEEP (documentado no README)** | contrato público documentado; nunca deletar sem ciclo |

---

## Camada 3 — Packages irmãos (12)

**Nenhum é ORPHANED-DELETE limpo** — todos publicados no npm. Achado-chave: `@theokit/sdk-handoff` e
`@theokit/sdk-memory` como "unused devDep" é **falso-positivo do padrão lazy optional-peer** (carregados via
`import("@theokit/sdk-memory")` runtime para quebrar ciclo de dep). Feature viva — NÃO deletar.

| Package | Verdict | Racional |
|---|---|---|
| acp, cli, sdk-budget, sdk-cache, sdk-handoff, sdk-memory, sdk-tools | **KEEP** | consumidos (sdk-tools tem consumidor cross-repo no framework; sdk-memory tem 43 testes) |
| memory-honcho, memory-mem0, memory-supermemory | **NEEDS-DECISION** | plugins opt-in externos (0 uso in-repo por design); decidir via `npm downloads`, não grep |
| codemod-sdk-2-0 | **ARCHIVE** | migra p/ `@theokit/sdk-core` — rename que **nunca aconteceu**; artefato de migração finalizado |

---

## Resposta à pergunta original (evoluir vs deletar `TheoKitClient`)
**DELETE via ciclo de deprecation.** É contrato HTTP legado (`/agent/send`+`/agent/stream`) superado pelo
`/api/agents/<name>` UIMessageStream. `@public` + publicado → 1 release de deprecation, depois remover o subpath `./client`.

## Plano de ação sugerido (ordem de risco crescente)
1. **DELETE já (sem risco):** 6 barrels mortos + subpaths `./internal/plugins`, `./internal/observability` + remover subpath `./internal/security`.
2. **Config knip:** `ignoreDependencies` p/ `sdk-handoff`/`sdk-memory` (documentar o lazy-peer) — silencia o falso-positivo sem quebrar.
3. **Demote export (1-a-1, com TDD):** os ~85 `export` redundantes internos → module-private; deletar só os ~9 órfãos reais da Categoria A após re-grep individual.
4. **Deprecation cycle:** `./client` (o TheoKitClient), + decidir `./workflow`/`./subscription`/`./cron`.
5. **Archive:** `codemod-sdk-2-0` (deprecate no npm).
6. **NEEDS-DECISION (maintainer):** os 3 `memory-*` plugins — via métricas de download npm.

> Nada aqui foi deletado. Este é o relatório de decisão; a execução é uma sessão separada (é o repo sibling
> `theokit-sdk`, com publish train próprio). Regra 3 (honestidade): "0 consumidor nos nossos repos" não prova
> "0 consumidor npm" para nada publicado.
