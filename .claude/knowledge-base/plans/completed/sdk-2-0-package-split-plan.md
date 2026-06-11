---
slug: sdk-2-0-package-split
created_at: 2026-06-07
goal: Quebrar @theokit/sdk em 6 packages dedicados + reorganizar 22 packages em famílias documentadas, eliminando o barrel de 138 KB gzipped sem manter retro-compatibilidade
---

# Plan: SDK 2.0.0 — Package Split + Family Reorganization

> **Version 1.1** — Quebrar o god-package `@theokit/sdk` (138 KB gzipped no barrel, 361 arquivos .ts, 17 subsystems agrupados) em 6 packages cleanly extractable (`sdk-core`, `sdk-memory`, `sdk-budget`, `sdk-cache`, `sdk-handoff`, `sdk-tools`), reorganizar os 22 packages do monorepo `theokit-sdk` em 5 famílias documentadas (core / channels / memory-adapters / data / integrations / react), e shippar tudo como SDK **2.0.0** com codemod jscodeshift e migration guide. **Sem retro-compatibilidade** — re-exports legacy removidos, peer-deps de todos os 21 packages dependentes bumpados em sincronia. Outcome esperado: `import { Agent } from '@theokit/sdk-core'` ≤ 30 KB gzipped (vs 138 KB hoje, redução de **78%**).
>
> **v1.1 changes (2026-06-07 — edge-case absorption):**
> - **EC-1 absorbed (T1.1):** sub-path `./internal/persistence` declarado em `packages/sdk-core/package.json` exports field (sem isso ESM bloqueia com `ERR_PACKAGE_PATH_NOT_EXPORTED`).
> - **EC-2 absorbed (T1.1-T5.1):** cada `tsup.config.ts` de package extraído declara `external: [/^@theokit\//]` (sem isso tsup bundla cópia de sdk-core dentro de cada package, defeating o split).
> - **EC-3 absorbed (T2.1, T8.1):** `Agent.create()` sem `budgetTracker` emite `console.warn` ONCE-per-process (promovido de BDD para Acceptance Criterion); codemod T8.1 detecta `Agent.create({...})` sem `budgetTracker` e insere `// CODEMOD-WARN` comment.
> - **EC-4 absorbed (T4.1, T8.1):** `Agent.create` tipo `exact` (sem index signature/rest) → `handoffs?: ...` removido pega TS2353; codemod T8.1 adiciona transform CallExpression para `Agent.create({ handoffs })` insertando `// CODEMOD` comment.
> - **EC-5 absorbed (T2.1, T3.1, T4.1, T5.1):** cada Tasks list de Phase 2-5 termina com `pnpm install -w` no root antes do commit (workspace registra novo membro).

## Context

### O problema empírico (medido 2026-06-07)

| Métrica | Valor atual | Evidência |
|---|---|---|
| `dist/index.js` (barrel principal) | **559 KB raw / 138 KB gzipped** | `ls -la packages/sdk/dist/index.js && gzip -c packages/sdk/dist/index.js \| wc -c` |
| `dist/eval.js` (sub-path isolado) | 489 KB raw | `ls -la packages/sdk/dist/eval.js` |
| `dist/cron.js` (sub-path isolado) | 481 KB raw | `ls -la packages/sdk/dist/cron.js` |
| `dist/` total | **16 MB** | `du -sh packages/sdk/dist/` |
| `src/` count | **361 .ts files (não-test)** | `find packages/sdk/src -name "*.ts" -not -name "*.test.ts" \| wc -l` |
| Sub-paths exportados | 12 entry points | `jq '.exports \| keys' packages/sdk/package.json` |
| Subsystems mapeados | **17** (Subsystem Map produzido 2026-06-07) | Subsystem Map — Agent, Memory, Budget, Cache, Handoff, Registry, Plugins, Cron, Eval, Workflow, Task, Subscription, Tools, Server/Auth, Persistence, Misc, Types |

**Comparação que dói:** O scaffold default do TheoKit (app web completa: React 19 + router + SSR + devtools) é **193 KB gzipped**. O barrel do `@theokit/sdk` sozinho é **138 KB** — 71% do bundle de uma app inteira, só para criar um `Agent`.

### O que está bem (confirmado empiricamente)

1. **Direção de dependência correta.** `grep -rn "from '@theokit/(react|orm|gateway|di)'" packages/sdk/src/` retorna ZERO matches. O SDK não importa de irmãos.
2. **Sub-paths já isolados.** `eval`, `cron`, `workflow`, `subscription`, `tools`, `server/auth` são chunks separados — quem não importa, não paga.
3. **Peer-deps corretos para libs grandes.** `ws`, `better-sqlite3`, `lancedb`, `sqlite-vec`, `proper-lockfile`, `zod` declarados como peer (consumidor escolhe versão).
4. **22 packages com peer-dep `@theokit/sdk` (não dependency).** Não bundla SDK 2x quando consumer instala `@theokit/gateway-telegram`.

### O que está ruim (root cause)

O barrel `src/index.ts` re-exporta **TUDO** dos subsystems "embedded":

- **Memory** subsystem (40 arquivos `internal/memory/**`, 4070 LOC) — adapters de embedding (OpenAI, Mistral, Voyage, Ollama, DeepInfra, OpenRouter, Anthropic), dreaming sweep, storage (Lance + SQLite-vec + markdown chunks), retrieval tools.
- **Budget** subsystem (8 arquivos `internal/budget/**`, 932 LOC) — compute-cost, enforcement, usage-accumulator, normalize-usage, pricing-registry, ledger, registry, calendar-window.
- **Cache** subsystem (9 arquivos `internal/cache/**`, 722 LOC) — semantic cache com lookup (vector/FTS), stores (in-memory + JSON file), embed-helper, cosine, ttl, telemetry.
- **Handoff** subsystem (4 arquivos `internal/handoff/**`, 491 LOC) — dispatcher, registry, tool-injector, telemetry.

Quem importa `{ Agent }` paga o transitive closure destes 4 subsystems via barrel re-export, mesmo sem usar nenhum deles.

### O escopo definido (sessão 2026-06-07 com o user)

1. **Plano vive em** `theokit-sdk/.claude/knowledge-base/plans/` (convenção real do repo, confirmada com `ls`).
2. **Escopo:** quebrar barrel + reorganizar 22 packages em famílias.
3. **Naming:** `@theokit/sdk-core` + `@theokit/sdk-*` (sufixo).
4. **Sem retro-compatibilidade** (autorização explícita do user). Permite bump major direto + codemod sem layer de compat.

## Objective

**Done = `import { Agent } from '@theokit/sdk-core'` produz bundle ≤ 30 KB gzipped, e os 4 subsystems extractable vivem em packages npm próprios consumíveis independente do core.**

Goals mensuráveis:

1. **Bundle:** `@theokit/sdk-core` barrel ≤ 30 KB gzipped (medido com `gzip -c dist/index.js | wc -c` + asserted em CI).
2. **Packages:** 6 packages npm publicados sob `@theokit/sdk-*` (`-core`, `-memory`, `-budget`, `-cache`, `-handoff`, `-tools`).
3. **Famílias:** `packages/README.md` documenta 5 famílias (core / channels / memory-adapters / data / integrations / react) com tabela package → família + status.
4. **Cross-cutting:** 21 packages dependentes (cli, react, orm, di-agent, acp, 9 gateways, 3 memory adapters, skills) com `peerDependencies` re-pinados para SDK 2.0.0.
5. **Codemod:** script jscodeshift em `scripts/migrations/1-x-to-2-0.mjs` reescreve `from '@theokit/sdk'` → `from '@theokit/sdk-core'` (+ moves para `-memory`/`-budget`/`-cache`/`-handoff`/`-tools` conforme imports), com dry-run default e `--write` opt-in.
6. **Migration guide:** `docs/migration/1-x-to-2-0.md` com before/after por surface + 1-comando upgrade snippet.
7. **CI gate:** `pnpm validate` falha se `dist/index.js` gzipped de qualquer `@theokit/sdk-*` package exceder threshold (configurado em `scripts/check-bundle-budget.mjs`).
8. **Dogfood QA PASS** em `dogfood-app` migrado para SDK 2.0 (real-LLM smoke + zero CRITICAL).

## ADRs

### D1 — Split por boundary acoplamento, não por feature

**Decisão:** O split segue o critério de **acoplamento real ao agent-loop**, não relevância semântica:

- **Stay in `sdk-core` (acoplamento forte):** Agent, AgentBuilder, AgentFactory, defineTool, errors, generate-object, stream-object, definePlugin (foundation), LiveAgentRegistry (kernel), agent-loop completo, persistence shared, types.
- **Sub-paths dentro de `sdk-core` (já isolados, mover = churn):** `/cron`, `/eval`, `/workflow`, `/subscription`, `/server/auth`.
- **Extract para packages dedicados (acoplamento moderado, integration via plugin/DI):** Memory, Budget, Cache, Handoff, Tools.

**Rationale:** O Subsystem Map (2026-06-07) provou empiricamente:
- Memory subsystem (4070 LOC) — barrel `src/memory.ts` re-exporta `Memory` namespace mas agent-loop não importa Memory diretamente; Memory é state observada por hooks. Extractable.
- Budget subsystem (932 LOC) — agent-loop importa `UsageAccumulator` E `IterationBudget` de `internal/budget/`. Cross-import existe mas pode ser invertido (agent-loop passa a depender de interface, sdk-budget implementa).
- Cache subsystem (722 LOC) — integração via `Cache.asPlugin()` retorna `Plugin`. Zero coupling direto com agent-loop além do plugin protocol. Extractable.
- Handoff subsystem (491 LOC) — tool-injector adiciona handoff como tool no registry. Moderately coupled mas extractable via mesmo plugin protocol.
- Tools (931 LOC `tools/`) — totalmente independente, já está em sub-path.

**Consequências:**
- ✅ `sdk-core` foca em kernel orchestration (Agent + Registry + Plugins + loop). Bundle dramaticamente menor.
- ✅ Memory/Budget/Cache/Handoff publicáveis independentes — versões próprias, breaking changes não exigem bump do core.
- ⚠️ Agent-loop precisa virar dependency-injected para Budget (interface `BudgetTracker` em sdk-core, implementação em sdk-budget). Refactor não-trivial.
- ⚠️ Registry NÃO extraído (kernel). Decisão deliberada — extrair geraria circular dep entre Agent e Registry.

### D2 — Naming: `@theokit/sdk-core` + `@theokit/sdk-{memory,budget,cache,handoff,tools}`

**Decisão:** Sufixo, não rename total. Continuidade visual com a linha SDK 1.x.

**Rationale:**
- Alternativa "agente" (`@theokit/agent-core`) considerada e rejeitada — quebraria mais drasticamente o branding npm + obrigaria atualizar 22 peer-deps com nome novo.
- Alternativa "1 pacote, vários entry-points" (`@theokit/runtime` com sub-paths) rejeitada pelo user no escopo (foi a opção explicitamente desautorizada na sessão de planning).
- Padrão "@scope/library-namespace" é canônico em ecossistemas comparáveis (@tanstack/query-core, @trpc/server, @vitejs/plugin-react).

**Consequências:**
- ✅ Reader vê `@theokit/sdk-*` e sabe que é família SDK.
- ✅ 21 peer-deps mudam só de `@theokit/sdk` para `@theokit/sdk-core` (ou múltiplos, dependendo de uso).
- ⚠️ `@theokit/sdk` (sem sufixo) será **deprecated em npm** com tombstone apontando para `@theokit/sdk-core`.

### D3 — Zero retro-compatibilidade

**Decisão:** SDK 2.0.0 não exporta nada com nome antigo. Nenhum re-export "transitional".

**Rationale:**
- User autorizou explicitamente ("nao tem problema e nao precisamos manter retro-compatibilidade").
- Pacote tem ~5 production consumers conhecidos (dogfood-app + TheoKit framework + 3 example apps). Migração feita 1x por código real.
- Re-exports transitional somam bundle (re-export ainda compila para `export * from`). Defeitaria parte do ganho.
- Codemod jscodeshift cobre 95% dos casos automatizado.

**Consequências:**
- ✅ Bundle limpo, sem dead code de compat layer.
- ✅ Tipo de migração binária — funciona ou quebra no `tsc --noEmit`, sem warning silencioso.
- ⚠️ Quebra qualquer external consumer não-listado. Migration guide + `@theokit/sdk@2.0.0` em npm com `deprecated: true` + tombstone pointing to codemod.

### D4 — Famílias declaradas em `packages/README.md`, NÃO movidas em pasta

**Decisão:** Os 22+ packages permanecem todos em `packages/<name>/` (flat layout). Famílias documentadas em tabela única em `packages/README.md`.

**Rationale:**
- Mover packages para `packages/{core,channels,memory-adapters,data,integrations}/<name>/` quebra:
  - `pnpm-workspace.yaml` paths
  - CI build paths
  - publishConfig glob patterns
  - git history (cada mv = rename, perde blame fino)
- Benefício de mover = puramente cognitivo (developer abre pasta core/ e vê core packages). Benefício real ≈ 0 quando há documentação em README.
- Cross-repo `theokit/` consome `../theokit-sdk/packages/sdk/` via workspace protocol — mover quebraria.

**Consequências:**
- ✅ Zero churn em git, CI, workspace config, cross-repo wiring.
- ✅ Famílias claramente comunicadas via tabela.
- ⚠️ Desenvolvedor precisa ler README para entender agrupamento (vs ver na árvore). Aceitável.

### D5 — Codemod jscodeshift (não regex)

**Decisão:** Migration codemod em `scripts/migrations/1-x-to-2-0.mjs` usa `jscodeshift` API.

**Rationale:**
- Imports com renames (`import { Memory as M } from '@theokit/sdk'`) quebram regex.
- Side-effect imports (`import '@theokit/sdk'`) precisam tratamento especial.
- Re-exports (`export { Memory } from '@theokit/sdk'`) precisam reescrita.
- jscodeshift é stable, usada em codemods canônicos (react-codemod, next-codemod).
- Pattern já provado em este monorepo: theokit/scripts/migrations/envelope-0-2-to-0-4.mjs usa regex porque ali são class-name swaps simples. Aqui é import-rewriter — domínio diferente, ferramenta diferente.

**Consequências:**
- ✅ Cobertura ~95% migração automática.
- ✅ Idempotent (rodar 2x = no-op na segunda).
- ✅ Dry-run default, `--write` opt-in.
- ⚠️ Adiciona devDep `jscodeshift` no monorepo (zero runtime impact — só script).

### D6 — Bump major sincronizado: SDK 2.0.0 + todos os 21 packages dependentes

**Decisão:** Quando SDK 2.0.0 publica, simultaneamente publicam:
- `@theokit/cli@0.2.0` (peerDep bumped)
- `@theokit/react@2.0.0` (peerDep bumped + breaking porque hooks importam de sdk-core)
- `@theokit/acp@0.2.0`
- `@theokit/gateway@1.0.0` (era 0.4.0)
- 10 `@theokit/gateway-*@0.2.0` (telegram, slack, whatsapp, teams, email, sms, mattermost, line, matrix, discord)
- 3 `@theokit/memory-{honcho,mem0,supermemory}@0.2.0`
- `@theokit/skills-google-workspace@3.0.0` (era 2.0.0)
- `@theokit/di@0.2.0`, `@theokit/di-agent@0.2.0`, `@theokit/orm@0.2.0-next.1`

**Rationale:**
- peerDep range `^1.0.0` em SDK 1.x não satisfaz `2.0.0`. Sem rebump, instalação falha com peer-conflict.
- Changesets permite cohort releases atomicamente.

**Consequências:**
- ✅ 1 release cohort, 1 migration window.
- ⚠️ 21 changelogs simultâneos (toleráveis pois cada um é "Updated peerDep to @theokit/sdk-core@2.0.0").

### D7 — `subscription`, `eval`, `cron`, `workflow`, `server/auth` continuam sub-paths dentro de `sdk-core`

**Decisão:** Esses 5 sub-paths NÃO viram packages npm separados.

**Rationale:**
- Já são isolados: importar `@theokit/sdk/cron` NÃO pulls barrel. Bundle problem é o **barrel principal**, não esses.
- Cada um é < 500 KB raw / cada bundle final < 200 KB gzipped via tsup chunk split.
- Mover causaria churn massivo (rebump cli/gateway/etc que importam de `/cron` ou `/eval`).
- Yagnnize: ganho de bundle = zero porque já tree-shaken. Custo = alto.

**Consequências:**
- ✅ Sub-paths permanecem como hoje: `@theokit/sdk-core/cron`, `@theokit/sdk-core/eval`, `@theokit/sdk-core/workflow`, `@theokit/sdk-core/subscription`, `@theokit/sdk-core/server/auth`.
- ✅ `@theokit/sdk-tools` SAI porque tools/ tem peer deps próprias (subprocess, git) que beneficiam de package separado.
- ⚠️ `Cron` exports são re-exportados no barrel principal de sdk-core? **NÃO.** Para usar Cron, importa explicitamente do sub-path. Quebra para qualquer consumer que fazia `import { Cron } from '@theokit/sdk'` — codemod cobre.

### D8 — Registry e Plugins permanecem em sdk-core (não extraídos)

**Decisão:** `LiveAgentRegistry`, `definePlugin`, plugin manager, plugin lifecycle ficam em `sdk-core`.

**Rationale:**
- Registry referenciado pela Agent class diretamente (singleton `Agent.registry`). Extrair = circular dep (sdk-core importa sdk-registry; sdk-registry tipa Agent que vive em sdk-core).
- Plugin protocol é a **foundation** que Cache/Handoff usam para se integrar com agent-loop. Sem ele, packages extracted não conseguem se hookar.

**Consequências:**
- ✅ Foundation estável no core; packages extracted dependem dela via peerDep `@theokit/sdk-core`.
- ✅ Zero circular deps.

### D9 — Bundle budget asserted em CI

**Decisão:** Novo script `scripts/check-bundle-budget.mjs` mede gzipped size de cada `packages/*/dist/index.js`, falha CI se exceder threshold declarado em `packages/<name>/.bundle-budget.json`.

**Rationale:**
- Sem assertion, ganho de hoje vira regressão amanhã (someone adds re-export, barrel volta a 150 KB).
- Pattern provado em `theokit/scripts/check-bundle-budget.sh` (assertion sobre default scaffold 350 KB).

**Consequências:**
- ✅ Bundle size = invariant. Tentativa de inflar barrel quebra CI antes do merge.
- ⚠️ Threshold inicial generoso (sdk-core ≤ 50 KB; aperta para 30 KB após Phase 6 estabilizar).

## Dependency Graph

```
Phase 0 (BEFORE map)
   │
   ▼
Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 5
(memory)   (budget)    (cache)     (handoff)    (tools)
   │           │           │           │           │
   └───────────┴───────────┴───────────┴───────────┘
                           │
                           ▼
                      Phase 6 (sdk → sdk-core rename + barrel strip)
                           │
                           ▼
                      Phase 7 (21 dependent packages bump cohort)
                           │
                           ▼
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        Phase 8       Phase 9      Phase 10
        (codemod)   (docs + fam)  (CI bundle gate)
              └────────────┼────────────┘
                           ▼
                  Phase Final: Dogfood QA
```

**Ordering rationale:**
- Phases 1-5 são extractions independentes — poderiam paralelizar, MAS Phase 2 (budget) é a única com cross-import real do agent-loop (`UsageAccumulator` consumido por `internal/agent-loop/loop.ts`). Sequência sequencial reduz merge conflicts.
- Phase 6 (rename `@theokit/sdk` → `@theokit/sdk-core`) DEPOIS de 1-5 porque o rename precisa que o barrel strip já tenha acontecido (caso contrário rename de package com barrel ainda pesado = trabalho 2x).
- Phase 7 (21 deps) depois de 6 porque peerDep target name muda (era `@theokit/sdk`, vira `@theokit/sdk-core`).
- Phases 8, 9, 10 paralelas após 7 — não compartilham arquivos.
- Phase Final (dogfood) é gate final, único bloqueio é ALL anteriores PASS.

---

## Phase 0: Current state snapshot

**Objective:** Documentar o estado atual antes de qualquer mudança, sem rodar `/architecture-docs` (skill requer worktree no repo target).

### T0.1 — Subsystem Map persistido como baseline

#### Objective
Salvar o Subsystem Map produzido pelo Explore agent (2026-06-07) como artifact baseline, para diff comparação após implementação.

#### Evidence
Sem baseline persistido, não há comparação possível "antes vs depois". O Subsystem Map detalhado já existe na sessão de planning mas precisa ser arquivado em arquivo versionado.

#### Files to edit
```
.claude/knowledge-base/baselines/sdk-2-0-baseline-subsystems-2026-06-07.md — (NEW) Subsystem Map completo
.claude/knowledge-base/baselines/sdk-2-0-baseline-bundle-2026-06-07.md — (NEW) métricas atuais (bytes raw/gzipped por dist file)
```

#### Deep file dependency analysis
- **Subsystem Map (NEW):** documento auto-contido. Listará 17 subsystems mapeados, files-in-scope por subsystem, public surface, internal/external dependencies, extractability verdict.
- **Bundle baseline (NEW):** snapshot textual de `ls -la dist/*.js *.cjs | awk '...'` + `gzip -c | wc -c` para 12 sub-paths.
- Zero downstream impact — arquivos de documentação somente.

#### Deep Dives
**Convenção de naming do baseline:** `{slug}-baseline-{topic}-{YYYY-MM-DD}.md` para permitir múltiplos snapshots (ex: rerun no fim do projeto produz `-baseline-after-2026-XX-YY.md`).

**Conteúdo do bundle baseline:** tabela com colunas | entry | raw bytes | gzipped bytes | top 5 imports | tree-shake notes |. Tree-shake notes preenchido manualmente via inspeção do source map (`tsup` gera `.map` files; usar `source-map-explorer` se necessário).

#### Tasks
1. Criar `.claude/knowledge-base/baselines/` se não existir.
2. Salvar Subsystem Map em `sdk-2-0-baseline-subsystems-2026-06-07.md`.
3. Executar `for f in packages/sdk/dist/*.js packages/sdk/dist/*.cjs; do size=$(wc -c < "$f"); gz=$(gzip -c "$f" | wc -c); echo "$f $size $gz"; done > /tmp/baseline.txt` e formatar como tabela markdown em `sdk-2-0-baseline-bundle-2026-06-07.md`.
4. Commit `docs(baseline): SDK 2.0 split — subsystem map + bundle snapshot pre-split`.

#### TDD + BDD

```
RED:     test_baseline_subsystems_md_exists() — Given the planned work begins, When a reader looks up the baseline, Then file .claude/knowledge-base/baselines/sdk-2-0-baseline-subsystems-2026-06-07.md MUST exist (test asserts fs.existsSync)
RED:     test_baseline_bundle_md_has_all_subpaths() — Given the bundle baseline is required for comparison, When parsing the markdown table, Then all 12 sub-paths from package.json exports MUST appear as rows
RED:     test_baseline_subsystems_has_17_sections() — Given the Subsystem Map identified 17 subsystems, When parsing the markdown, Then exactly 17 ## sections MUST exist (matching heading pattern ^## \d+\.)
RED:     test_baseline_locked_dates() — Given baselines are time-anchored, When parsing filename, Then date suffix MUST match ^2026-06-07$
GREEN:   Create both .md files with the prescribed structure; populate from session transcript and measured commands
REFACTOR: None expected — pure documentation artifact
VERIFY:  npx vitest run tests/unit/sdk-2-0-baseline.test.ts
```

BDD scenarios:
- **Happy path:** ambos arquivos existem, conteúdo válido, todas 17 sections + 12 sub-path rows presentes.
- **Validation error:** uma section faltando → test fails com mensagem nomeando o subsystem ausente.
- **Edge case:** arquivo vazio ou só com frontmatter → test falha (asserta length > 1000 chars).
- **Error scenario:** filename com data diferente de 2026-06-07 → test falha (data-locked filename).

#### Acceptance Criteria
- [ ] `.claude/knowledge-base/baselines/sdk-2-0-baseline-subsystems-2026-06-07.md` existe e contém ≥ 17 sections de subsystem
- [ ] `.claude/knowledge-base/baselines/sdk-2-0-baseline-bundle-2026-06-07.md` existe e contém tabela com 12 sub-paths
- [ ] 4 unit tests GREEN
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm biome check` exit 0 (não afetado — só .md)
- [ ] Commit com mensagem Convention Commits

#### DoD
- [ ] Todos os arquivos commitados em develop
- [ ] Test file passa
- [ ] Pre-push hooks limpos

---

## Phase 1: Extract `@theokit/sdk-memory`

**Objective:** Criar `packages/sdk-memory/` extraindo `Memory` namespace + 40 arquivos `internal/memory/**` + 5 helpers, deixando sdk-core sem essa surface.

### T1.1 — Scaffold `packages/sdk-memory/` + move source

#### Objective
Criar package npm dedicado para Memory subsystem com source movido (não duplicado) e build configurado.

#### Evidence
Subsystem Map confirmou: Memory tem **4305 LOC** (4070 internos + 235 públicos), zero cross-imports de cache/budget/handoff no barrel. Extraction limpa.

#### Files to edit
```
packages/sdk-memory/package.json — (NEW) name @theokit/sdk-memory, peerDep @theokit/sdk-core, deps better-sqlite3, sqlite-vec, @lancedb/lancedb (todos como peerDependencies pois libs grandes)
packages/sdk-memory/tsconfig.json — (NEW) estende tsconfig.base.json
packages/sdk-memory/tsup.config.ts — (NEW) entry src/index.ts + sub-paths se aplicável
packages/sdk-memory/src/index.ts — (NEW) barrel re-exportando Memory, helpers, types
packages/sdk-memory/src/memory.ts — (MOVED) era packages/sdk/src/memory.ts
packages/sdk-memory/src/memory-adapter-helpers.ts — (MOVED) era packages/sdk/src/memory-adapter-helpers.ts
packages/sdk-memory/src/adapters/** — (MOVED) era packages/sdk/src/internal/memory/adapters/** (8 embedder runtimes)
packages/sdk-memory/src/dreaming/** — (MOVED) era packages/sdk/src/internal/memory/dreaming/**
packages/sdk-memory/src/storage/** — (MOVED) era packages/sdk/src/internal/memory/storage/** (Lance + SQLite-vec + chunk)
packages/sdk-memory/src/tools/** — (MOVED) era packages/sdk/src/internal/memory/tools/** (retrieval operators)
packages/sdk-memory/CHANGELOG.md — (NEW) initial 0.1.0
packages/sdk-memory/README.md — (NEW) public-facing readme
packages/sdk-memory/LICENSE — (NEW) Apache-2.0 (copy from root)
packages/sdk/src/memory.ts — (DELETED)
packages/sdk/src/memory-adapter-helpers.ts — (DELETED)
packages/sdk/src/internal/memory/** — (DELETED) all 40 files
packages/sdk/src/internal/persistence/atomic-write.ts — (KEPT — shared util, still used by sdk-core)
packages/sdk/src/types/memory-adapter.ts — (DELETED, moved to sdk-memory/src/types/)
packages/sdk/package.json — UPDATE: declarar sub-path "./internal/persistence" em "exports" field (EC-1 absorbed; sem isso ESM bloqueia consumer com ERR_PACKAGE_PATH_NOT_EXPORTED)
pnpm-workspace.yaml — (no change — packages/* glob captures new package)
```

#### Deep file dependency analysis

**memory.ts (185 LOC) — Public Memory class:**
- Today: lives in `packages/sdk/src/memory.ts`, exports `Memory` namespace with static methods, `MemoryIndexHandle` interface, `DreamingSweepOptions`, `DreamingSweepResult`.
- Change: moves to `packages/sdk-memory/src/memory.ts`. Internal imports adjusted from `./internal/memory/...` to `./adapters/...` / `./dreaming/...` / `./storage/...` (no more `internal/memory/` indirection).
- Downstream: `packages/sdk/src/index.ts` removes `export { Memory, ... } from './memory.js'`. Consumers update to `import { Memory } from '@theokit/sdk-memory'`.

**internal/memory/adapters/** (8 files, ~50 LOC each):**
- Today: each adapter file exports `openai`, `mistral`, `voyage`, `ollama`, `deepinfra`, `openrouter`, `anthropic` embedder factories.
- Change: moves to `packages/sdk-memory/src/adapters/`. Catalog (`catalog.ts`) maintains registry.
- Downstream: tests in `packages/sdk/tests/memory*` also move to `packages/sdk-memory/tests/`.

**internal/persistence/atomic-write.ts (KEPT in sdk-core):**
- Reason: used by Memory storage AND conversation storage (sdk-core). If we move it, sdk-memory needs to re-export to sdk-core which is wrong direction. Keep in sdk-core, sdk-memory imports it via `@theokit/sdk-core/internal/persistence` (NEW sub-path).
- **EC-1 absorbed — sub-path DECLARADO em exports field (not just "convention"):**
  ```json
  // packages/sdk/package.json (será sdk-core após Phase 6)
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./internal/persistence": {
      "types": "./dist/internal/persistence/index.d.ts",
      "import": "./dist/internal/persistence/index.js"
    }
    // ... outros sub-paths existentes
  }
  ```
  Sem essa entrada, Node ESM bloqueia com `ERR_PACKAGE_PATH_NOT_EXPORTED` quando sdk-memory tenta importar. README do sdk-core sinaliza `./internal/persistence` como "internal API — semver-exempt; may break in patch releases".

#### Deep Dives

**Algoritmo de move (script `tools/move-memory-subsystem.mjs`):**
1. `mkdir -p packages/sdk-memory/{src,tests}`
2. `cp -r packages/sdk/src/internal/memory/* packages/sdk-memory/src/`
3. `cp packages/sdk/src/memory.ts packages/sdk-memory/src/memory.ts`
4. `cp packages/sdk/src/memory-adapter-helpers.ts packages/sdk-memory/src/memory-adapter-helpers.ts`
5. `cp packages/sdk/src/types/memory-adapter.ts packages/sdk-memory/src/types/memory-adapter.ts`
6. Rewrite imports in moved files: regex `from "../internal/memory/` → `from "./` (within sdk-memory).
7. Rewrite imports in moved files: regex `from "../types/` → `from "@theokit/sdk-core/types"` (cross-package).
8. `rm packages/sdk/src/{memory.ts,memory-adapter-helpers.ts}` + `rm -rf packages/sdk/src/internal/memory/`.
9. Strip `export { Memory, ... }` block from `packages/sdk/src/index.ts`.

**Invariants:**
- Após move, `packages/sdk-memory/src/**` MUST NOT importar `from '@theokit/sdk-memory'` (auto-import = circular).
- `packages/sdk-memory/src/**` MAY importar `from '@theokit/sdk-core'` mas SOMENTE types ou `definePlugin` foundation.
- `packages/sdk/src/**` MUST NOT importar `from '@theokit/sdk-memory'` (kernel não depende de extension).

**EC-2 absorbed — tsup `external` config OBRIGATÓRIO em sdk-memory/tsup.config.ts:**
```typescript
// packages/sdk-memory/tsup.config.ts
import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  external: [/^@theokit\//, 'better-sqlite3', 'sqlite-vec', '@lancedb/lancedb'],
  // ^^^ regex captura @theokit/sdk-core E qualquer @theokit/* peer.
  // Sem essa entrada, tsup bundla copia de Agent + Plugin foundation dentro de sdk-memory.dist,
  // inflando bundle e duplicando singletons (LiveAgentRegistry) em runtime.
});
```
Mesmo padrão aplicado em sdk-budget (Phase 2), sdk-cache (Phase 3), sdk-handoff (Phase 4), sdk-tools (Phase 5).

**Edge cases:**
- **Tests in sdk/ that imported Memory:** moved to sdk-memory/tests/ + `vitest.config.ts` em sdk-memory aponta para `packages/sdk-memory/tests/`.
- **Examples in examples/ that imported Memory:** updated em Phase 8 codemod (não nesta task).
- **Type-only imports:** ainda funcionam via `@theokit/sdk-core/types` (NEW sub-path).

#### Tasks

1. `mkdir -p packages/sdk-memory/{src,tests}` e criar `package.json`, `tsconfig.json`, `tsup.config.ts`, `LICENSE`, `README.md` (template stub).
2. Escrever `tools/move-memory-subsystem.mjs` (one-shot migration script).
3. Executar script com `--dry-run` primeiro para validar plan.
4. Executar com `--write`.
5. Adicionar `packages/sdk-memory/CHANGELOG.md` com entry `[0.1.0] - 2026-XX-XX — Extracted from @theokit/sdk@1.7.0`.
6. Atualizar `packages/sdk/src/index.ts` removendo block de exports memory.
7. Rodar `pnpm install` no root para registrar workspace.
8. Rodar `pnpm -F @theokit/sdk-memory build` — deve gerar `dist/`.
9. Rodar `pnpm -F @theokit/sdk-memory test` — testes movidos devem passar.
10. Commit `feat(sdk-memory): extract @theokit/sdk-memory 0.1.0 from @theokit/sdk@1.7.0`.

#### TDD + BDD

```
RED:     test_sdk_memory_package_json_valid() — Given the extraction is complete, When loading packages/sdk-memory/package.json, Then name MUST equal '@theokit/sdk-memory' AND peerDependencies MUST include '@theokit/sdk-core'
RED:     test_sdk_memory_barrel_exports_memory() — Given consumers want Memory, When parsing dist/index.d.ts, Then export 'Memory' MUST be declared
RED:     test_sdk_memory_no_internal_memory_in_sdk_core() — Given the extraction, When grepping packages/sdk/src/, Then 'internal/memory/' MUST NOT appear as a directory
RED:     test_sdk_memory_no_cyclic_import() — Given the design intent, When sdk-memory build runs, Then no file in src/ imports from '@theokit/sdk-memory' (self-import)
RED:     test_sdk_memory_can_import_from_sdk_core_types_only() — Given the dependency direction, When grepping sdk-memory src/, Then any import from '@theokit/sdk-core' MUST be type-only OR import from '/types' sub-path
RED:     test_sdk_memory_build_emits_dts() — Given consumers need types, When running tsup build, Then dist/index.d.ts AND dist/index.js MUST exist
RED:     test_memory_unit_tests_pass_in_sdk_memory_repo() — Given tests were moved, When running pnpm -F @theokit/sdk-memory test, Then all assertions pass
RED:     test_sdk_core_barrel_no_longer_exports_memory() — Given the barrel was stripped, When parsing packages/sdk/dist/index.d.ts, Then 'export { Memory' MUST NOT appear
GREEN:   Execute the move script; configure tsup/tsconfig; install workspace; build; pass tests
REFACTOR: Clean up any duplicate type imports introduced by the move
VERIFY:  pnpm -F @theokit/sdk-memory build && pnpm -F @theokit/sdk-memory test && pnpm tsc --noEmit
```

BDD scenarios:
- **Happy path:** consumer adds `pnpm add @theokit/sdk-memory @theokit/sdk-core` + `import { Memory } from '@theokit/sdk-memory'` → autocomplete funciona, build clean.
- **Validation error:** consumer importa Memory de `@theokit/sdk-core` (old API) → TypeScript error TS2305 "Module '@theokit/sdk-core' has no exported member 'Memory'".
- **Edge case:** consumer instala `@theokit/sdk-memory` sem `@theokit/sdk-core` → pnpm warning "Missing peer dependency".
- **Error scenario:** sdk-memory tries to import `Agent` from `@theokit/sdk-core` runtime → tests fail because `Agent` only available as type, not as runtime value (correto — kernel não compartilha runtime com extension).

#### Acceptance Criteria
- [ ] `packages/sdk-memory/package.json` validado por `npx publint packages/sdk-memory`
- [ ] `pnpm -F @theokit/sdk-memory build` exit 0
- [ ] `pnpm -F @theokit/sdk-memory test` GREEN (todos os tests movidos)
- [ ] `packages/sdk/src/internal/memory/` DELETADO (verificado por test)
- [ ] `packages/sdk/dist/index.js` NÃO contém string "DreamingSweep" (verificado por test)
- [ ] `dist/index.js` gzipped de `sdk-memory` standalone ≤ 60 KB
- [ ] **EC-1:** `packages/sdk/package.json` exports field declara `"./internal/persistence"` (test: `jq '.exports["./internal/persistence"]' packages/sdk/package.json` retorna objeto não-null)
- [ ] **EC-2:** `packages/sdk-memory/dist/index.js` NÃO contém string `class Agent` nem `function definePlugin` (test grep — prova que tsup external funcionou)
- [ ] **EC-2:** `packages/sdk-memory/tsup.config.ts` contém `external: [/^@theokit\//` (test grep)
- [ ] 8 unit tests acima GREEN
- [ ] `pnpm tsc --noEmit` em root: 0 errors
- [ ] `pnpm biome check packages/sdk packages/sdk-memory` exit 0

#### DoD
- [ ] Commit em develop com mensagem descritiva
- [ ] Pre-push hooks limpos
- [ ] CHANGELOG entry em ambos `packages/sdk-memory/CHANGELOG.md` (initial) e `packages/sdk/CHANGELOG.md` (Removed: Memory subsystem extracted)

---

## Phase 2: Extract `@theokit/sdk-budget`

**Objective:** Criar `packages/sdk-budget/` extraindo Budget subsystem, com refactor do agent-loop para depender de interface ao invés de implementação direta.

### T2.1 — Define `BudgetTracker` interface em sdk-core + scaffold sdk-budget

#### Objective
Inverter dependência: agent-loop deixa de importar `UsageAccumulator`/`IterationBudget` diretamente. Em vez disso depende de interface `BudgetTracker` que `@theokit/sdk-budget` implementa.

#### Evidence
Subsystem Map identificou: agent-loop em `internal/agent-loop/loop.ts` importa `UsageAccumulator` de `internal/budget/usage-accumulator.ts`. Sem interface, extract de budget = circular dep.

#### Files to edit
```
packages/sdk/src/internal/runtime/budget-tracker.ts — (NEW) interface BudgetTracker { track(usage), check(), getTotal() }
packages/sdk/src/internal/agent-loop/loop.ts — refactor para receber BudgetTracker via construct param (dep injection)
packages/sdk/src/agent.ts — refactor: Agent.create() recebe opcional budgetTracker?: BudgetTracker
packages/sdk-budget/package.json — (NEW) name @theokit/sdk-budget, peerDep @theokit/sdk-core
packages/sdk-budget/src/index.ts — (NEW) barrel: Budget, UsageAccumulator, computeCost, normalizeUsage, chargeAndCheckThresholds, preflightCheck, getPricingEntry, inferApiMode
packages/sdk-budget/src/budget.ts — (MOVED) era packages/sdk/src/budget.ts
packages/sdk-budget/src/internal/** — (MOVED) era packages/sdk/src/internal/budget/** (8 files: compute-cost, enforcement, usage-accumulator, normalize-usage, pricing-registry, ledger, registry, calendar-window)
packages/sdk-budget/src/budget-tracker-impl.ts — (NEW) implementação da interface BudgetTracker; consumer monta com `new BudgetTrackerImpl(budget)` e injeta no Agent
packages/sdk/src/internal/runtime/budget.ts — (DELETED) IterationBudget movido para sdk-budget como detalhe interno
packages/sdk/src/index.ts — remover exports Budget/UsageAccumulator/etc
packages/sdk/src/types/budget.ts — split: interface contracts ficam em sdk-core/types, runtime types em sdk-budget/src/types
```

#### Deep file dependency analysis

**internal/agent-loop/loop.ts (~600 LOC):**
- Today: `import { UsageAccumulator } from '../budget/usage-accumulator.js'` + `import { IterationBudget } from '../runtime/budget.js'`.
- Change: receive both via context: `function runAgentLoop(ctx: AgentLoopContext) { const { budgetTracker } = ctx; ... }`.
- Downstream: every caller of `runAgentLoop` (Agent class, AgentBuilder, AgentFactory) updates to pass `budgetTracker`.

**agent.ts (~700 LOC):**
- Today: `Agent.create({ ... })` internally constructs Budget if not provided.
- Change: `Agent.create({ budgetTracker?: BudgetTracker })` — optional, nullable. If null, agent runs without budget tracking (free-run mode).
- Downstream: consumers who want budget enforcement explicitly construct + inject.

**Critical: rever Agent default behavior:**
- Today: `Agent.create()` automatically creates Budget internally → user gets enforcement by default.
- Tomorrow: `Agent.create()` without `budgetTracker` → no enforcement (free-run).
- **Migration impact:** users who relied on default budget enforcement must explicitly `import { createBudgetTracker } from '@theokit/sdk-budget'`. Documented in migration guide.
- **Alternative considered:** Agent.create internally fallback to no-op tracker se `@theokit/sdk-budget` não instalado, opcional via try/import dynamic. **Rejeitado:** dynamic import quebra bundle analysis + complica trabalho de Agent.

**EC-3 absorbed — silent budget removal protection:**
1. **Runtime guard rail:** `Agent.create()` sem `budgetTracker` emite `console.warn` ONCE per Agent instance:
   ```typescript
   // packages/sdk/src/agent.ts
   if (!opts.budgetTracker) {
     warnOnce(
       `[theokit] Agent "${opts.name}" running without budgetTracker — costs are unbounded. ` +
       `Install @theokit/sdk-budget and pass createBudgetTracker(budget) to enable enforcement. ` +
       `See https://docs.theokit.dev/migration/1-x-to-2-0#budget-tracker`
     );
   }
   ```
   `warnOnce` deduplica por agent name + key `budget-tracker-missing` para evitar log spam em apps com muitos agents.

2. **Codemod warning (cross-ref T8.1):** transform detecta `Agent.create({...})` sem property `budgetTracker` e insere comentário:
   ```typescript
   // CODEMOD-WARN: SDK 2.0 — Agent.create no longer auto-creates Budget.
   //   Add budgetTracker explicitly to keep enforcement, or accept free-run mode.
   //   See docs/migration/1-x-to-2-0.md#budget-tracker
   const agent = Agent.create({ name: 'x', model: '...' });
   ```

Combinação garante: (a) TS compila silenciosamente, (b) runtime warning aparece no console, (c) migration codemod marca cada call-site explicitamente.

#### Deep Dives

**Interface `BudgetTracker` (sdk-core):**
```typescript
export interface BudgetTracker {
  /** Records usage event for an agent run iteration. */
  track(input: { tokens: number; model: string; type: 'input' | 'output' }): void;
  /** Returns true if budget allows further iterations. */
  check(): { allowed: boolean; reason?: 'budget_exceeded' | 'iteration_limit' };
  /** Snapshot of accumulated usage. */
  getTotal(): { tokens: number; costUsd?: number };
}
```

**Strategy:** consumer code passes implementation:
```typescript
import { Agent } from '@theokit/sdk-core';
import { Budget, createBudgetTracker } from '@theokit/sdk-budget';

const budget = Budget.create({ maxUsd: 5.00, maxTokens: 100_000 });
const agent = Agent.create({
  budgetTracker: createBudgetTracker(budget),
  // ...
});
```

**Edge cases:**
- Agent without budgetTracker — runs unbounded (free-run). Logs WARN once per agent lifetime: "No budget tracker; agent runs unbounded".
- BudgetTracker.check() returns `{ allowed: false }` mid-loop — agent-loop aborts iteration, emits `AgentRunError({ code: 'budget_exceeded' })`.
- BudgetTracker throws — wrapped in `BudgetTrackerError` from sdk-core.

#### Tasks
1. Criar `packages/sdk-core/src/internal/runtime/budget-tracker.ts` com interface.
2. Refactor `internal/agent-loop/loop.ts` para receber `budgetTracker` via context param.
3. Refactor `agent.ts` para aceitar `budgetTracker?: BudgetTracker` em `Agent.create` + adicionar `warnOnce` quando ausente (EC-3).
4. Scaffold `packages/sdk-budget/` com mesmo pattern de Phase 1 — incluindo `tsup.config.ts` com `external: [/^@theokit\//]` (EC-2).
5. Mover `packages/sdk/src/budget.ts` + `packages/sdk/src/internal/budget/**` → `packages/sdk-budget/src/`.
6. Mover `packages/sdk/src/internal/runtime/budget.ts` (IterationBudget) → `packages/sdk-budget/src/internal/`.
7. Criar `packages/sdk-budget/src/budget-tracker-impl.ts` exportando `createBudgetTracker(budget): BudgetTracker`.
8. Atualizar `packages/sdk/src/index.ts`: remover exports Budget/UsageAccumulator/etc.
9. Atualizar tests que dependiam de implicit budget — pass explicit tracker.
10. **`pnpm install -w` no root** (EC-5 — registra sdk-budget no workspace antes do commit).
11. Commit.

#### TDD + BDD

```
RED:     test_budget_tracker_interface_exported() — Given sdk-core ships the interface, When importing 'BudgetTracker' from '@theokit/sdk-core', Then type MUST resolve
RED:     test_agent_create_without_tracker_warns() — Given Agent.create with no budgetTracker, When agent runs first iteration, Then console.warn MUST emit 'No budget tracker; agent runs unbounded'
RED:     test_agent_with_tracker_calls_track() — Given Agent.create({ budgetTracker }), When iteration completes, Then tracker.track MUST be called with positive tokens
RED:     test_agent_aborts_on_check_disallowed() — Given a tracker that returns allowed: false on check, When iteration runs, Then agent throws AgentRunError({ code: 'budget_exceeded' })
RED:     test_sdk_budget_factory_creates_tracker() — Given createBudgetTracker(budget), When invoked, Then returns object satisfying BudgetTracker interface (has track/check/getTotal)
RED:     test_sdk_budget_no_longer_in_sdk_core_barrel() — Given the extraction, When parsing sdk-core dist/index.d.ts, Then 'export { Budget' MUST NOT appear
RED:     test_sdk_budget_tracker_throws_wraps_in_budget_tracker_error() — Given a tracker that throws, When agent calls track, Then caught and wrapped as BudgetTrackerError (extends AgentRunError)
RED:     test_budget_cost_compute_pure_function() — Given Budget.compute({ tokens, model }), When called with known model, Then returns costUsd > 0 (deterministic)
GREEN:   Implement interface + impl factory + Agent refactor + cross-package wiring
REFACTOR: Extract budget-cost test fixture to shared helper if needed
VERIFY:  pnpm -F @theokit/sdk-core test && pnpm -F @theokit/sdk-budget test
```

BDD scenarios:
- **Happy path:** consumer wires Budget + createBudgetTracker + injects → agent runs, tokens tracked, costs reported, no warning.
- **Validation error:** consumer passes object missing `check` method → TypeScript error TS2741 "Property 'check' is missing".
- **Edge case:** budget exceeds mid-iteration → agent aborts cleanly, error propagates with code `budget_exceeded`, runId preserved.
- **Error scenario:** tracker.track throws (e.g., out-of-memory in pricing registry) → wrapped in BudgetTrackerError, agent emits error event but does NOT crash process.

#### Acceptance Criteria
- [ ] Interface `BudgetTracker` exportada de `@theokit/sdk-core`
- [ ] `Agent.create({ budgetTracker })` typed corretamente
- [ ] `packages/sdk-budget/` builda + tests GREEN
- [ ] `packages/sdk/src/internal/budget/` DELETADO
- [ ] `packages/sdk/dist/index.js` NÃO contém "UsageAccumulator"
- [ ] **EC-2:** `packages/sdk-budget/tsup.config.ts` declara `external: [/^@theokit\//]`; `dist/index.js` NÃO contém `class Agent`
- [ ] **EC-3:** `Agent.create()` sem `budgetTracker` emite `console.warn` ONCE per agent instance (test asserta `vi.spyOn(console, 'warn')` chamado exatamente 1x para o mesmo agent rodando 5 iterations)
- [ ] **EC-3:** `warnOnce` dedup-key key inclui agent name + 'budget-tracker-missing' (test asserta 2 agents diferentes geram 2 warns)
- [ ] **EC-5:** após Tasks step 10, `pnpm list -r --depth=0 @theokit/sdk-budget` retorna sucesso (workspace registrou)
- [ ] 8 unit tests GREEN
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm biome check packages/sdk packages/sdk-budget` exit 0
- [ ] Migration guide skeleton em `docs/migration/1-x-to-2-0.md` documenta breaking de budget default

#### DoD
- [ ] Commit em develop
- [ ] Pre-push hooks limpos
- [ ] CHANGELOG entry em sdk-budget e sdk-core

---

## Phase 3: Extract `@theokit/sdk-cache`

**Objective:** Criar `packages/sdk-cache/` extraindo semantic cache (722 LOC). Integration via plugin (Cache.asPlugin()).

### T3.1 — Move Cache subsystem, integration via Plugin protocol

#### Objective
Cache já se integra com agent-loop via `definePlugin()` (hook pre-tool-call / post-response). Extração limpa preserva o pattern existente.

#### Evidence
Subsystem Map: Cache depende apenas de `internal/plugins/types.js` (foundation que fica em sdk-core) + `internal/persistence/persistence-schema.js`. Zero coupling direto com agent-loop, budget ou memory.

#### Files to edit
```
packages/sdk-cache/package.json — (NEW) name @theokit/sdk-cache, peerDep @theokit/sdk-core, optional peer @lancedb/lancedb (semantic search)
packages/sdk-cache/src/index.ts — (NEW) barrel: Cache, CacheEmbedderError, CacheInvalidTtlError
packages/sdk-cache/src/cache.ts — (MOVED) era packages/sdk/src/cache.ts
packages/sdk-cache/src/internal/** — (MOVED) era packages/sdk/src/internal/cache/** (9 files)
packages/sdk-cache/src/cache-as-plugin.ts — (NEW) re-export Plugin factory
packages/sdk/src/cache.ts — (DELETED)
packages/sdk/src/internal/cache/** — (DELETED)
packages/sdk/src/index.ts — remover exports Cache/CacheEmbedderError/CacheInvalidTtlError
packages/sdk/src/types/cache.ts — interface CachePluginContract fica em sdk-core/types, runtime types em sdk-cache
```

#### Deep file dependency analysis

**cache.ts (247 LOC):**
- Today: `Cache.semantic({ embedder, store, ttl })` returns Cache instance with `.asPlugin()` method.
- Change: moves to sdk-cache. `Cache` class identical surface. `Cache.semantic` factory identical.
- Downstream: `import { Cache } from '@theokit/sdk-cache'` + `agent = Agent.create({ plugins: [cache.asPlugin()] })`.

**internal/cache/lookup.ts (~150 LOC):** vector + FTS search hybrid logic. Self-contained.

**internal/cache/store-json.ts (~120 LOC):** JSON file persistence using internal/persistence/atomic-write. Imports stay via sub-path `@theokit/sdk-core/internal/persistence`.

#### Deep Dives

**Plugin integration unchanged:**
```typescript
// Today (1.x):
import { Cache, Agent } from '@theokit/sdk';
const cache = Cache.semantic({ embedder, store: 'json', ttl: '1h' });
const agent = Agent.create({ plugins: [cache.asPlugin()] });

// Tomorrow (2.0):
import { Agent } from '@theokit/sdk-core';
import { Cache } from '@theokit/sdk-cache';
const cache = Cache.semantic({ embedder, store: 'json', ttl: '1h' });
const agent = Agent.create({ plugins: [cache.asPlugin()] });
```

**Edge cases:**
- Cache instantiated without sdk-core installed → fails at `import { definePlugin } from '@theokit/sdk-core'` line. Honest error from pnpm/npm.
- Cache TTL inválido (`'-5m'` ou `'abc'`) → `CacheInvalidTtlError` ANTES de retornar instance (current behavior preserved).
- Cache store full / disk error → caught, returns `{ hit: false, reason: 'store_error' }`, agent proceeds without cache (graceful degrade — current behavior).

#### Tasks
1. Scaffold `packages/sdk-cache/` mirroring sdk-memory pattern — `tsup.config.ts` com `external: [/^@theokit\//]` (EC-2).
2. Mover `packages/sdk/src/cache.ts` + `internal/cache/**`.
3. Reescrever imports relativos (regex `from "./internal/cache/...` → `from "./internal/...`).
4. Adicionar `@theokit/sdk-core` como peerDep.
5. Atualizar `packages/sdk/src/index.ts` removendo exports cache.
6. Mover tests em `packages/sdk/tests/cache*` → `packages/sdk-cache/tests/`.
7. Build + tests.
8. **`pnpm install -w` no root** (EC-5 — registra sdk-cache no workspace).
9. Commit.

#### TDD + BDD

```
RED:     test_cache_extracted_from_sdk_core() — Given the extraction, When grep sdk-core src/, Then 'src/cache.ts' MUST NOT exist
RED:     test_cache_factory_returns_plugin() — Given Cache.semantic({...}), When .asPlugin() invoked, Then returns Plugin satisfying definePlugin contract
RED:     test_cache_invalid_ttl_throws_pre_construction() — Given ttl '-5m', When Cache.semantic invoked, Then CacheInvalidTtlError thrown BEFORE returning instance
RED:     test_cache_store_error_degrades_gracefully() — Given store.get throws ENOENT, When cache.lookup called via plugin hook, Then returns { hit: false, reason: 'store_error' } NOT throw
RED:     test_cache_embedder_error_specific() — Given embedder throws (rate limit), When cache invoked, Then CacheEmbedderError thrown with embedder name
RED:     test_sdk_core_no_longer_exports_cache() — Given barrel stripped, When parsing sdk-core dist/index.d.ts, Then 'export { Cache' MUST NOT appear
RED:     test_cache_integrates_via_plugin_protocol_only() — Given separation, When grep packages/sdk-cache/src, Then no import from '@theokit/sdk-core/internal' EXCEPT '/internal/plugins/types' AND '/internal/persistence/atomic-write'
GREEN:   Move + reconfigure tsup/tsconfig + adjust imports
REFACTOR: Ensure persistence sub-path is documented as "internal-but-exposed"
VERIFY:  pnpm -F @theokit/sdk-cache build && pnpm -F @theokit/sdk-cache test
```

BDD scenarios:
- **Happy path:** Cache.semantic + asPlugin → agent reuses cached responses, observable via `cache.stats()`.
- **Validation error:** Invalid ttl string → CacheInvalidTtlError com mensagem útil.
- **Edge case:** Cache.semantic com `store: undefined` → fallback para in-memory store (default behavior).
- **Error scenario:** Embedder rate-limited → CacheEmbedderError emitido, agent continua sem cache (não trava o run).

#### Acceptance Criteria
- [ ] `packages/sdk-cache/` builda + tests GREEN
- [ ] `packages/sdk/dist/index.js` NÃO contém "CacheEmbedderError"
- [ ] **EC-2:** `packages/sdk-cache/tsup.config.ts` declara `external: [/^@theokit\//]`; `dist/index.js` NÃO contém `class Agent`
- [ ] **EC-5:** `pnpm list -r --depth=0 @theokit/sdk-cache` retorna sucesso
- [ ] 7 unit tests GREEN
- [ ] Integração agent + cache via plugin protocol funciona em fixture (test em sdk-cache/tests/integration/)
- [ ] `pnpm tsc --noEmit` exit 0

#### DoD
- [ ] Commit
- [ ] CHANGELOG entries em ambos packages

---

## Phase 4: Extract `@theokit/sdk-handoff`

**Objective:** Criar `packages/sdk-handoff/` extraindo Handoff subsystem (491 LOC). Moderately coupled mas extractable via mesmo plugin protocol.

### T4.1 — Move Handoff + refactor tool-injector via plugin hook

#### Objective
Handoff dispatcher hoje é injetado em agent's tool registry no `internal/runtime/agent-init.ts`. Extrair = refactorar para usar plugin protocol (cache pattern).

#### Evidence
Subsystem Map: Handoff tem 4 internos (dispatcher, registry, tool-injector, telemetry) + classe Handoff pública + 5 error classes + helper handoffTo.

#### Files to edit
```
packages/sdk-handoff/package.json — (NEW) name @theokit/sdk-handoff, peerDep @theokit/sdk-core, peerDep zod
packages/sdk-handoff/src/index.ts — (NEW) barrel: Handoff, handoffTo, 5 errors, RECOMMENDED_HANDOFF_PROMPT_PREFIX
packages/sdk-handoff/src/handoff.ts — (MOVED) era packages/sdk/src/handoff.ts
packages/sdk-handoff/src/internal/** — (MOVED) era packages/sdk/src/internal/handoff/**
packages/sdk-handoff/src/handoff-as-plugin.ts — (NEW) factory Handoff.asPlugin() — pattern espelha Cache
packages/sdk/src/handoff.ts — (DELETED)
packages/sdk/src/internal/handoff/** — (DELETED)
packages/sdk/src/internal/runtime/agent-init.ts — REMOVER auto-inject de handoff dispatcher; consumer agora wire explicitamente via plugin
packages/sdk/src/agent.ts — Agent.create({ handoff: HandoffDescriptor[] }) DEPRECATED — passe via `plugins: [handoff.asPlugin()]`
packages/sdk/src/index.ts — remover exports Handoff/handoffTo/error classes
```

#### Deep file dependency analysis

**handoff.ts + internal/handoff/dispatcher.ts:**
- Today: `Agent.create({ handoffs: [Handoff.to(otherAgent)] })` → init wires dispatcher into agent's tool registry.
- Change: `agent = Agent.create({ plugins: [Handoff.asPlugin({ targets: [otherAgent] })] })`.
- Downstream: codemod reescreve `handoffs:` → `plugins: [Handoff.asPlugin({ targets: ... })]`.

**Removed automatic behavior:**
- `Agent.create({ handoffs })` no longer auto-recognized. Pure breaking. Codemod cobre.

**EC-4 absorbed — type `exact` para garantir TS error:**
`AgentCreateOptions` type em `packages/sdk-core/src/types/agent-options.ts` MUST ser definido como literal object type sem index signature OU `extends Record<string, unknown>`:
```typescript
// CORRECT — TS pega { handoffs } com TS2353 "Object literal may only specify known properties"
export interface AgentCreateOptions {
  name: string;
  model: string;
  systemPrompt?: string;
  tools?: Tool[];
  plugins?: Plugin[];
  budgetTracker?: BudgetTracker;
  // ... 12 fields total, ALL declarados explicitamente
}
// NOT ALLOWED:
// export interface AgentCreateOptions extends Record<string, unknown> { ... }
// export type AgentCreateOptions = { [k: string]: unknown; name: string; ... }
```

Combinado com codemod CallExpression transform (T8.1), `Agent.create({ handoffs })` legacy code:
- Em TS strict: TS2353 erro imediato.
- Sem TS: codemod marca call-site com comentário `// CODEMOD: handoffs option removed in 2.0 — wrap with Handoff.asPlugin({ targets })`.

#### Deep Dives

**Handoff via plugin (NEW pattern):**
```typescript
import { Agent } from '@theokit/sdk-core';
import { Handoff } from '@theokit/sdk-handoff';

const billingAgent = Agent.create({ name: 'billing', ... });
const supportAgent = Agent.create({
  name: 'support',
  plugins: [Handoff.asPlugin({ targets: [billingAgent] })],
});
```

**Edge cases (current behaviors preserved):**
- Self-reference (agent handoffs to itself) → HandoffSelfReferenceError pre-construction.
- Loop A→B→A → HandoffPairLoopError no second call.
- Multi-hop loop A→B→C→A → HandoffLoopError em runtime (hop count tracker em PluginContext).
- Receiver disposed → HandoffReceiverDisposedError.

#### Tasks
1. Scaffold `packages/sdk-handoff/` — `tsup.config.ts` com `external: [/^@theokit\//, 'zod']` (EC-2).
2. Mover source.
3. Criar `Handoff.asPlugin()` factory wrapping dispatcher into Plugin shape.
4. Refactor `agent-init.ts` removendo auto-wire de handoff.
5. **Garantir `AgentCreateOptions` é interface explícita sem index signature** (EC-4) — remover `handoffs?:` field; adicionar type test `@ts-expect-error` asserting `Agent.create({ name, model, handoffs: [] })` falha com TS2353.
6. Atualizar tests para usar plugin pattern.
7. Build + test.
8. **`pnpm install -w` no root** (EC-5).
9. Commit.

#### TDD + BDD

```
RED:     test_handoff_as_plugin_returns_plugin() — Given Handoff.asPlugin({ targets }), When invoked, Then returns Plugin satisfying definePlugin contract
RED:     test_handoff_self_reference_throws_pre_construction() — Given Handoff.asPlugin({ targets: [self] }), When called from inside self, Then HandoffSelfReferenceError thrown
RED:     test_handoff_pair_loop_blocked() — Given A handoffs to B and B handoffs to A simultaneously, When second handoff invoked, Then HandoffPairLoopError
RED:     test_handoff_multi_hop_loop_caught_at_runtime() — Given A→B→C→A chain, When third handoff dispatched, Then HandoffLoopError
RED:     test_handoff_receiver_disposed_error() — Given handoff target was disposed, When attempt to dispatch, Then HandoffReceiverDisposedError
RED:     test_agent_create_handoffs_option_removed() — Given Agent.create({ handoffs: [...] }) (legacy API), When called, Then TypeScript error (option removed from type)
RED:     test_sdk_core_no_longer_exports_handoff() — Given barrel stripped, When parsing sdk-core dist/index.d.ts, Then 'export { Handoff' MUST NOT appear
GREEN:   Move + plugin refactor + agent-init cleanup
REFACTOR: Consolidate handoff hop tracker into a single context field
VERIFY:  pnpm -F @theokit/sdk-handoff build && pnpm -F @theokit/sdk-handoff test
```

BDD scenarios:
- **Happy path:** Agent A handoffs to Agent B → B's run inherits conversation, response returned to original caller.
- **Validation error:** Passing non-Agent as target → TypeScript error TS2322 (type mismatch).
- **Edge case:** Handoff target with same name as source → HandoffNameCollisionError.
- **Error scenario:** Target agent throws → wrapped in HandoffLoopError with original error chained via `cause`.

#### Acceptance Criteria
- [ ] `packages/sdk-handoff/` builda + tests GREEN
- [ ] 7 unit tests GREEN
- [ ] **EC-4:** `Agent.create({ handoffs })` removido — `AgentCreateOptions` é interface explícita sem index signature (type test `@ts-expect-error` asserta TS2353)
- [ ] **EC-2:** `packages/sdk-handoff/tsup.config.ts` declara `external: [/^@theokit\//, 'zod']`; `dist/index.js` NÃO contém `class Agent`
- [ ] **EC-5:** `pnpm list -r --depth=0 @theokit/sdk-handoff` retorna sucesso
- [ ] Integração agent-A → handoff → agent-B funcional em fixture
- [ ] `pnpm tsc --noEmit` exit 0

#### DoD
- [ ] Commit
- [ ] CHANGELOG entries

---

## Phase 5: Extract `@theokit/sdk-tools`

**Objective:** Criar `packages/sdk-tools/` extraindo a biblioteca de built-in tools (8 files, 931 LOC: read-file, list-dir, search-text, git-diff, subprocess, run-vitest, path-scope, index).

### T5.1 — Move tools/ + adjust peer-deps

#### Objective
Tools de FS / shell / git têm peer deps próprias (subprocess wants `node:child_process`, git-diff wants `simple-git` opcional). Package separado isola.

#### Evidence
`tools/` já está em sub-path `@theokit/sdk/tools` — tree-shaken hoje. Mas é o único sub-path com peer-dep próprio realístico. Extract package = explicit ownership de deps.

#### Files to edit
```
packages/sdk-tools/package.json — (NEW) name @theokit/sdk-tools, peerDep @theokit/sdk-core, optional peer simple-git
packages/sdk-tools/src/index.ts — (NEW) barrel: readFileTool, listDirTool, searchTextTool, gitDiffTool, subprocessTool, runVitestTool, pathScope
packages/sdk-tools/src/** — (MOVED) era packages/sdk/src/tools/** (8 files)
packages/sdk/src/tools/** — (DELETED)
packages/sdk/package.json — remover sub-path "./tools" do exports field
packages/sdk/src/index.ts — sem mudança (tools nunca foi exportado no barrel principal)
```

#### Deep file dependency analysis

**path-scope.ts:** valida que paths não escapam de `cwd` (security guard). Standalone, sem deps.

**subprocess.ts:** wrapper around `node:child_process.spawn` com timeout + abort. Sem deps externas.

**run-vitest.ts:** spawna `vitest run --reporter=json`. Peer: `vitest` (optional — só se consumer usa essa tool específica).

**git-diff.ts:** wraps `simple-git`. Peer: `simple-git` (optional).

#### Deep Dives

**Migration impact:**
- Old `import { readFileTool } from '@theokit/sdk/tools'` → `import { readFileTool } from '@theokit/sdk-tools'`. Codemod cobre.
- Old sub-path `./tools` deletado do exports field. Quem tentar importar do path antigo recebe "Module not found".

**Edge cases:**
- Consumer imports `gitDiffTool` mas não instala `simple-git` → runtime error com mensagem útil ("Install simple-git to use gitDiffTool: pnpm add simple-git").
- path-scope blocks `../../../etc/passwd` → security guard preserved.

#### Tasks
1. Scaffold `packages/sdk-tools/` — `tsup.config.ts` com `external: [/^@theokit\//, 'simple-git', 'vitest']` (EC-2).
2. Mover source `packages/sdk/src/tools/` → `packages/sdk-tools/src/`.
3. Remover sub-path `./tools` de `packages/sdk/package.json` exports.
4. Build + tests.
5. **`pnpm install -w` no root** (EC-5).
6. Commit.

#### TDD + BDD

```
RED:     test_sdk_tools_barrel_exports_all_tools() — Given the move, When importing { readFileTool, ... } from '@theokit/sdk-tools', Then all 7 named tools resolve
RED:     test_path_scope_blocks_escape() — Given pathScope('/safe'), When path '/safe/../../../etc/passwd' tested, Then returns false
RED:     test_subprocess_timeout_aborts() — Given subprocessTool with timeout 100ms, When sleep 1s runs, Then promise rejects with TimeoutError within 200ms
RED:     test_git_diff_missing_peer_returns_actionable_error() — Given simple-git not installed, When gitDiffTool invoked, Then thrown error contains 'pnpm add simple-git'
RED:     test_sdk_subpath_tools_removed() — Given the cleanup, When loading packages/sdk/package.json, Then exports['./tools'] MUST NOT exist
RED:     test_sdk_tools_no_circular_with_sdk_core() — Given the separation, When grep sdk-tools src/, Then no import from '@theokit/sdk-tools' AND any import from '@theokit/sdk-core' is type-only or from /types sub-path
GREEN:   Move + sub-path cleanup + peer config
REFACTOR: Consolidate tool error types if patterns repeat
VERIFY:  pnpm -F @theokit/sdk-tools build && pnpm -F @theokit/sdk-tools test
```

BDD scenarios:
- **Happy path:** consumer wires readFileTool → agent reads file under scope, returns content.
- **Validation error:** consumer passes non-string path → Zod schema rejects ZodError.
- **Edge case:** path-scope rejects `..` escape → returns false, agent receives `{ ok: false, reason: 'path_escape' }`.
- **Error scenario:** subprocess timeout → AbortError + cleanup spawned process (no zombie).

#### Acceptance Criteria
- [ ] `packages/sdk-tools/` builda + tests GREEN
- [ ] 6 unit tests GREEN
- [ ] Sub-path `./tools` removido de sdk/package.json
- [ ] **EC-2:** `packages/sdk-tools/tsup.config.ts` declara `external: [/^@theokit\//, 'simple-git', 'vitest']`; `dist/index.js` NÃO contém `class Agent`
- [ ] **EC-5:** `pnpm list -r --depth=0 @theokit/sdk-tools` retorna sucesso
- [ ] `pnpm tsc --noEmit` exit 0

#### DoD
- [ ] Commit
- [ ] CHANGELOG entries

---

## Phase 6: Rename `@theokit/sdk` → `@theokit/sdk-core` + barrel strip

**Objective:** Finalizar a renomeação. Package fica `@theokit/sdk-core` v2.0.0. Barrel só exporta kernel (Agent + Registry + Plugins + types).

### T6.1 — Rename package + strip barrel + version bump 2.0.0

#### Objective
Após Phases 1-5 removerem 4 subsystems do source, o restante (Agent + AgentBuilder + AgentFactory + defineTool + errors + generate-object + stream-object + Plugin foundation + Registry + cron + eval + workflow + subscription + server/auth + types + persistence + security + theokit) vira `@theokit/sdk-core` 2.0.0.

#### Evidence
Phases 1-5 já reduziram src/ para ~200 .ts files (era 361). Barrel deve refletir.

#### Files to edit
```
packages/sdk/package.json — name: '@theokit/sdk' → '@theokit/sdk-core', version: 1.7.0 → 2.0.0
packages/sdk → packages/sdk-core — rename via git mv (preserva history)
packages/sdk-core/src/index.ts — strip TODOS os exports removidos (Memory, Budget, Cache, Handoff, tool re-exports)
packages/sdk-core/CHANGELOG.md — nova entry [2.0.0] com BREAKING list completo
packages/sdk-core/README.md — atualizar para refletir surface reduzida
pnpm-workspace.yaml — atualizar path '../theokit-sdk/packages/sdk' → 'packages/sdk-core' (no theokit-sdk/) + cross-repo theokit/pnpm-workspace.yaml também
.changeset/sdk-2-0-major.md — (NEW) major changeset
```

#### Deep file dependency analysis

**Rename via `git mv packages/sdk packages/sdk-core`:**
- Git treats as rename if > 50% similarity, preserves blame.
- After rename, todas as referencias internas em scripts/ ainda apontam para `packages/sdk` → update via grep+sed.
- `pnpm-workspace.yaml` em theokit-tools/theokit/ aponta cross-repo para `../theokit-sdk/packages/sdk` → update para `../theokit-sdk/packages/sdk-core`.

**Barrel strip — explicit list of removed exports:**
```diff
- export { Memory, type DreamingSweepOptions, ... } from './memory.js';
- export { extractRawId, mkMemoryId } from './memory-adapter-helpers.js';
- export { Budget, chargeAndCheckThresholds, computeCost, ... } from './budget.js';
- export { Cache, CacheEmbedderError, CacheInvalidTtlError } from './cache.js';
- export { Handoff, handoffTo, HandoffLoopError, ... } from './handoff.js';
- (tools nunca foi no barrel principal, sem mudança)
```

#### Deep Dives

**Versioning para sdk-core:**
- Era 1.7.0. Novo nome (= new npm package). Vamos publicar como **2.0.0** (não 1.7.1) porque:
  - SemVer: rename é BREAKING.
  - Sinal claro pro ecossistema: SDK gen 2.
- `@theokit/sdk@1.7.0` permanece em npm com **deprecation message** apontando para `@theokit/sdk-core@2.0.0` (npm `deprecate` API).

**Changeset (`.changeset/sdk-2-0-major.md`):**
```markdown
---
"@theokit/sdk-core": major
---

Renamed from @theokit/sdk → @theokit/sdk-core. Bundle barrel reduced from 138 KB to ≤ 30 KB gzipped. Memory/Budget/Cache/Handoff/Tools extracted to @theokit/sdk-{memory,budget,cache,handoff,tools}.

Migration: see docs/migration/1-x-to-2-0.md.
Codemod: `npx jscodeshift -t scripts/migrations/1-x-to-2-0.mjs <src>`.
```

#### Tasks
1. `git mv packages/sdk packages/sdk-core` no repo theokit-sdk.
2. Update `packages/sdk-core/package.json`: name, version, repo.directory.
3. Strip barrel `src/index.ts` (remover 5 blocks de re-export).
4. Update cross-repo workspace paths.
5. Adicionar changeset major.
6. Build + tests.
7. Verificar bundle: `gzip -c packages/sdk-core/dist/index.js | wc -c` ≤ 30000 bytes.
8. Commit `feat(sdk-core)!: rename @theokit/sdk → @theokit/sdk-core 2.0.0 (BREAKING)`.

#### TDD + BDD

```
RED:     test_sdk_core_package_name() — Given the rename, When loading packages/sdk-core/package.json, Then name MUST equal '@theokit/sdk-core' AND version MUST start with '2.0'
RED:     test_sdk_core_barrel_no_memory_budget_cache_handoff() — Given the strip, When parsing dist/index.d.ts, Then strings 'Memory', 'Budget', 'Cache', 'Handoff' MUST NOT appear as top-level exports
RED:     test_sdk_core_barrel_under_budget() — Given the goal, When measuring gzip dist/index.js, Then size MUST be ≤ 30000 bytes
RED:     test_sdk_core_still_exports_agent() — Given the kernel preserved, When importing { Agent } from '@theokit/sdk-core', Then class resolves
RED:     test_sdk_core_still_exports_define_plugin() — Given the foundation preserved, When importing { definePlugin } from '@theokit/sdk-core', Then function resolves
RED:     test_sdk_core_still_exports_registry_type() — Given the kernel preserved, When importing type LiveAgentRegistry, Then type resolves
RED:     test_sdk_core_cron_subpath_works() — Given sub-paths preserved, When importing { Cron } from '@theokit/sdk-core/cron', Then class resolves
RED:     test_sdk_core_eval_subpath_works() — Given sub-paths preserved, When importing from '@theokit/sdk-core/eval', Then exports resolve
RED:     test_old_package_name_deprecated_in_npm() — manual gate; tracked outside test suite
GREEN:   Rename + strip + bump + verify
REFACTOR: Clean up internal type re-exports that became dead after subsystem moves
VERIFY:  pnpm -F @theokit/sdk-core build && pnpm -F @theokit/sdk-core test && bash -c '[ $(gzip -c packages/sdk-core/dist/index.js | wc -c) -le 30000 ]'
```

BDD scenarios:
- **Happy path:** consumer `pnpm add @theokit/sdk-core@2.0.0` → `import { Agent } from '@theokit/sdk-core'` works.
- **Validation error:** consumer tenta `import { Memory } from '@theokit/sdk-core'` → TypeScript TS2305.
- **Edge case:** bundle gzipped 30001 bytes → test fails (hard limit), force optimization.
- **Error scenario:** package consumer ainda usando `@theokit/sdk@1.7.0` (old name) → npm warning "deprecated, use @theokit/sdk-core@2.0.0".

#### Acceptance Criteria
- [ ] `packages/sdk-core/package.json` name = `@theokit/sdk-core`, version `^2.0.0-`
- [ ] `dist/index.js` gzipped ≤ 30 KB
- [ ] Barrel não exporta Memory/Budget/Cache/Handoff
- [ ] Sub-paths (cron, eval, workflow, subscription, server/auth) preservados
- [ ] 9 unit tests GREEN
- [ ] Cross-repo workspace paths atualizados
- [ ] Changeset criado

#### DoD
- [ ] Commit em theokit-sdk/develop
- [ ] Cross-repo PR em theokit/ atualizando pnpm-workspace.yaml + dep references
- [ ] CHANGELOG completo com BREAKING list

---

## Phase 7: Cohort bump — 21 dependent packages

**Objective:** Atualizar todos os 21 packages que tinham peerDep `@theokit/sdk` para apontar `@theokit/sdk-core@^2.0.0` (+ extras se eles consomem memory/budget/cache/handoff/tools).

### T7.1 — Update peer-deps em 21 packages + bump majors

#### Objective
Sem este passo, instalar `@theokit/cli` (v0.1.1) puxa `@theokit/sdk@^1.0.0` como peer, conflitando com `@theokit/sdk-core@2.0.0`. Cohort release garante consistência.

#### Evidence
21 packages têm `peerDependencies: { "@theokit/sdk": ">=1.x" }`. Verificado via Phase 0 inventory.

#### Files to edit
```
packages/cli/package.json — peer @theokit/sdk → @theokit/sdk-core; version 0.1.1 → 0.2.0
packages/react/package.json — peer @theokit/sdk → @theokit/sdk-core; version 1.1.0 → 2.0.0
packages/orm/package.json — peer @theokit/sdk não tinha (não dependia); version 0.1.0-next.1 → 0.2.0-next.1
packages/di/package.json — sem peer SDK; version 0.1.0 → 0.2.0
packages/di-agent/package.json — peer @theokit/sdk → @theokit/sdk-core; version 0.1.0 → 0.2.0
packages/acp/package.json — peer @theokit/sdk → @theokit/sdk-core; version 0.1.0 → 0.2.0
packages/gateway/package.json — peer @theokit/sdk → @theokit/sdk-core; version 0.4.0 → 1.0.0
packages/gateway-telegram/package.json — version bump
packages/gateway-slack/package.json — idem
packages/gateway-whatsapp/package.json — idem
packages/gateway-teams/package.json — idem
packages/gateway-email/package.json — idem
packages/gateway-sms/package.json — idem
packages/gateway-mattermost/package.json — idem
packages/gateway-line/package.json — idem
packages/gateway-matrix/package.json — idem
packages/gateway-discord/package.json — idem
packages/memory-honcho/package.json — peer @theokit/sdk → @theokit/sdk-memory (memory adapter consome Memory, não core)
packages/memory-mem0/package.json — idem
packages/memory-supermemory/package.json — idem
packages/skills-google-workspace/package.json — peer @theokit/sdk → @theokit/sdk-core; version 2.0.0 → 3.0.0
.changeset/cohort-2-0-bump.md — (NEW) entries para os 21 packages
```

#### Deep file dependency analysis

**Per-package mapping (peer-dep change):**
- Packages que importam **só Agent/defineTool/errors** (cli, react, gateway*, acp, di-agent, skills) → peer `@theokit/sdk-core`.
- Packages que importam **Memory** (3 memory adapters) → peer `@theokit/sdk-memory`.
- Packages que **não importavam SDK** (di, orm) → sem peer SDK, mas major bump para sincronizar cohort.

**Source-code changes em cada package:**
- Find: `from '@theokit/sdk'` → Replace: `from '@theokit/sdk-core'` (ou `-memory` para memory adapters).
- Same codemod do Phase 8, mas aplicado AQUI manualmente nos 21 packages (consumers externos esperam o codemod, internamente fazemos handwritten para validar o codemod depois).

#### Deep Dives

**Cohort changeset:**
```markdown
---
"@theokit/cli": minor
"@theokit/react": major
"@theokit/orm": minor
"@theokit/di": minor
"@theokit/di-agent": minor
"@theokit/acp": minor
"@theokit/gateway": major
"@theokit/gateway-telegram": minor
"@theokit/gateway-slack": minor
... (todos os 10 gateways)
"@theokit/memory-honcho": minor
"@theokit/memory-mem0": minor
"@theokit/memory-supermemory": minor
"@theokit/skills-google-workspace": major
---

Bumped peerDep target: @theokit/sdk → @theokit/sdk-core (or @theokit/sdk-memory for memory adapters). Required by SDK 2.0.0 split.

Source impact: imports from '@theokit/sdk' updated to new target. Public API of each package unchanged.
```

#### Tasks
1. Para cada um dos 21 packages, editar package.json peerDeps + version.
2. Para cada, rodar `grep -rln "from '@theokit/sdk'" packages/<name>/src` e fazer find/replace.
3. Build cada um: `pnpm -F @theokit/<name> build`.
4. Test cada um: `pnpm -F @theokit/<name> test`.
5. Criar changeset cohort.
6. Commit `feat: bump 21 packages for SDK 2.0.0 cohort`.

#### TDD + BDD

```
RED:     test_cli_peer_dep_updated() — Given the cohort, When loading packages/cli/package.json peerDependencies, Then key '@theokit/sdk-core' exists AND '@theokit/sdk' (old) NOT
RED:     test_react_peer_dep_updated() — same shape
RED:     test_memory_adapters_peer_dep_is_sdk_memory() — Given memory-honcho/mem0/supermemory consume Memory, When loading their package.json peer, Then '@theokit/sdk-memory' (not sdk-core)
RED:     test_no_package_has_dual_peer_old_and_new() — Given the cohort, When scanning all packages, Then no package.json has BOTH '@theokit/sdk' AND '@theokit/sdk-core' as peers
RED:     test_changeset_cohort_present() — Given the release process, When checking .changeset/, Then file 'cohort-2-0-bump.md' exists
RED:     test_all_21_packages_versions_bumped() — Given the cohort, When comparing versions to baseline, Then all 21 packages have new version != baseline
RED:     test_source_no_old_import_in_any_package() — Given the rewrite, When grep -r "from '@theokit/sdk'" packages/, Then ZERO matches (excluding sdk-core itself)
GREEN:   Manual edits in 21 package.json + source rewrites
REFACTOR: None — bulk edits
VERIFY:  pnpm -r build && pnpm -r test
```

BDD scenarios:
- **Happy path:** após cohort, `pnpm install` no workspace root → todos os packages instalam sem peer-conflict warnings.
- **Validation error:** package esquecido (peer ainda aponta `@theokit/sdk`) → pnpm warning `[WARN] Missing peer @theokit/sdk@^1.x`.
- **Edge case:** consumer externo que tem `@theokit/sdk@1.7.0` + `@theokit/sdk-core@2.0.0` ambos instalados → coexistem (são packages npm diferentes), mas codemod recomenda remover o antigo.
- **Error scenario:** package com source ainda importando `@theokit/sdk` mas peer já bumped → TypeScript TS2307 "Cannot find module '@theokit/sdk'".

#### Acceptance Criteria
- [ ] 21 package.json atualizados (peerDep + version)
- [ ] Source code de cada package atualizado (find/replace done)
- [ ] `pnpm -r build` exit 0
- [ ] `pnpm -r test` exit 0
- [ ] 7 unit tests GREEN
- [ ] Changeset cohort criado
- [ ] Zero `from '@theokit/sdk'` em packages/ (excluindo deprecated stub se houver)

#### DoD
- [ ] Commit em develop
- [ ] Pre-push limpo
- [ ] CHANGELOG agregado documenta cohort

---

## Phase 8: Codemod jscodeshift

**Objective:** Script `scripts/migrations/1-x-to-2-0.mjs` que reescreve imports de consumers externos. Cobertura ~95%.

### T8.1 — Implementar codemod + test against fixtures

#### Objective
Consumers externos (dogfood-app, TheoKit framework, examples) precisam migrar imports. Codemod automatiza.

#### Evidence
Pattern já provado neste monorepo: `theokit/scripts/migrations/envelope-0-2-to-0-4.mjs` (regex codemod para envelope migration). Aqui usamos jscodeshift por ser mais robusto para import rewrites.

#### Files to edit
```
scripts/migrations/1-x-to-2-0.mjs — (NEW) jscodeshift codemod
scripts/migrations/1-x-to-2-0-map.json — (NEW) mapping import → new target
tests/unit/migration-1-x-to-2-0-codemod.test.ts — (NEW) testa cobertura em fixtures
tests/fixtures/codemod-1x/before/** — (NEW) snapshots pre-codemod
tests/fixtures/codemod-1x/after/** — (NEW) snapshots post-codemod (expected output)
package.json (root) — adicionar devDep jscodeshift
```

#### Deep file dependency analysis

**1-x-to-2-0-map.json:**
```json
{
  "Agent": "@theokit/sdk-core",
  "AgentBuilder": "@theokit/sdk-core",
  "defineTool": "@theokit/sdk-core",
  "definePlugin": "@theokit/sdk-core",
  "AgentRunError": "@theokit/sdk-core",
  "Cron": "@theokit/sdk-core/cron",
  "Eval": "@theokit/sdk-core/eval",
  "Workflow": "@theokit/sdk-core/workflow",
  "Memory": "@theokit/sdk-memory",
  "DreamingSweepOptions": "@theokit/sdk-memory",
  "Budget": "@theokit/sdk-budget",
  "UsageAccumulator": "@theokit/sdk-budget",
  "computeCost": "@theokit/sdk-budget",
  "Cache": "@theokit/sdk-cache",
  "CacheEmbedderError": "@theokit/sdk-cache",
  "Handoff": "@theokit/sdk-handoff",
  "handoffTo": "@theokit/sdk-handoff",
  "readFileTool": "@theokit/sdk-tools",
  "listDirTool": "@theokit/sdk-tools"
}
```

**Codemod algorithm:**
1. Parse source via jscodeshift.
2. Find all `ImportDeclaration` where source = `@theokit/sdk`.
3. For each specifier (named import), look up in map.
4. Group specifiers by target. Create new `ImportDeclaration` per target.
5. Remove original.
6. Handle: side-effect imports (`import '@theokit/sdk'`) → comment with TODO.
7. Handle: type-only imports (`import type { Foo }`) → same map.
8. Handle: namespace imports (`import * as SDK from '@theokit/sdk'`) → BLOCK + comment "Manual review required: namespace import not auto-migrated".
9. Handle: dynamic imports (`await import('@theokit/sdk')`) → comment + manual.
10. **EC-3 — Agent.create without budgetTracker** (CallExpression transform):
    - Find all `CallExpression` where callee is `Agent.create` (MemberExpression with `Agent` + `create`).
    - Inspect first argument (ObjectExpression).
    - If property `budgetTracker` ABSENT, insert leading comment:
      ```
      // CODEMOD-WARN: SDK 2.0 — Agent.create no longer auto-creates Budget.
      //   Add budgetTracker explicitly to keep enforcement, or accept free-run mode.
      //   See docs/migration/1-x-to-2-0.md#budget-tracker
      ```
11. **EC-4 — Agent.create with legacy handoffs option** (CallExpression transform):
    - Find `Agent.create` ObjectExpression arg with property `handoffs`.
    - Insert leading comment:
      ```
      // CODEMOD: handoffs option removed in 2.0 — wrap target agents with Handoff.asPlugin({ targets: [...] }) and pass via plugins array.
      //   Before: Agent.create({ handoffs: [a, b] })
      //   After:  Agent.create({ plugins: [Handoff.asPlugin({ targets: [a, b] })] })
      //   See docs/migration/1-x-to-2-0.md#handoff
      ```
    - Do NOT auto-rewrite — handoffs → plugins is semantically non-trivial (requires `Handoff` import + factory call); human review preferred over wrong codegen.

**Edge cases:**
- Symbol não conhecido (não está no map): preserve original import, emit warning.
- Import rename (`import { Memory as M }`) → preserve alias in new import.
- Multiple imports same target → consolidate em uma declaration.
- `Agent.create` invocação via variável re-aliased (`const create = Agent.create; create({})`) → codemod NÃO detecta; documented limitation.

#### Deep Dives

**Fixtures de teste (3 cenários canônicos):**

`before/single-import.ts`:
```typescript
import { Agent } from '@theokit/sdk';
const agent = Agent.create({});
```

`after/single-import.ts`:
```typescript
import { Agent } from '@theokit/sdk-core';
const agent = Agent.create({});
```

`before/mixed-imports.ts`:
```typescript
import { Agent, Memory, Budget, Cache, Handoff } from '@theokit/sdk';
```

`after/mixed-imports.ts`:
```typescript
import { Agent } from '@theokit/sdk-core';
import { Memory } from '@theokit/sdk-memory';
import { Budget } from '@theokit/sdk-budget';
import { Cache } from '@theokit/sdk-cache';
import { Handoff } from '@theokit/sdk-handoff';
```

`before/aliased.ts`:
```typescript
import { Memory as M, Cache as C } from '@theokit/sdk';
```

`after/aliased.ts`:
```typescript
import { Memory as M } from '@theokit/sdk-memory';
import { Cache as C } from '@theokit/sdk-cache';
```

`before/agent-create-no-budget.ts` (EC-3):
```typescript
import { Agent } from '@theokit/sdk';
const agent = Agent.create({ name: 'x', model: 'gpt-4o-mini' });
```

`after/agent-create-no-budget.ts` (EC-3):
```typescript
import { Agent } from '@theokit/sdk-core';
// CODEMOD-WARN: SDK 2.0 — Agent.create no longer auto-creates Budget.
//   Add budgetTracker explicitly to keep enforcement, or accept free-run mode.
//   See docs/migration/1-x-to-2-0.md#budget-tracker
const agent = Agent.create({ name: 'x', model: 'gpt-4o-mini' });
```

`before/agent-create-handoffs.ts` (EC-4):
```typescript
import { Agent } from '@theokit/sdk';
const billing = Agent.create({ name: 'billing', model: 'gpt-4o-mini' });
const support = Agent.create({ name: 'support', model: 'gpt-4o-mini', handoffs: [billing] });
```

`after/agent-create-handoffs.ts` (EC-4):
```typescript
import { Agent } from '@theokit/sdk-core';
// CODEMOD-WARN: SDK 2.0 — Agent.create no longer auto-creates Budget. (...)
const billing = Agent.create({ name: 'billing', model: 'gpt-4o-mini' });
// CODEMOD: handoffs option removed in 2.0 — wrap target agents with Handoff.asPlugin({ targets: [...] }) and pass via plugins array.
//   Before: Agent.create({ handoffs: [a, b] })
//   After:  Agent.create({ plugins: [Handoff.asPlugin({ targets: [a, b] })] })
//   See docs/migration/1-x-to-2-0.md#handoff
// CODEMOD-WARN: SDK 2.0 — Agent.create no longer auto-creates Budget. (...)
const support = Agent.create({ name: 'support', model: 'gpt-4o-mini', handoffs: [billing] });
```

#### Tasks
1. `pnpm add -D jscodeshift -w` no root.
2. Criar `scripts/migrations/1-x-to-2-0-map.json` com mapping completo.
3. Criar `scripts/migrations/1-x-to-2-0.mjs` (jscodeshift transformer).
4. Criar 6 fixtures (3 before, 3 after).
5. Criar test file que aplica codemod em before/ + diffa contra after/.
6. Verificar `pnpm vitest run tests/unit/migration-1-x-to-2-0-codemod.test.ts` GREEN.
7. Dry-run em dogfood-app/.
8. Commit `feat(migration): jscodeshift codemod 1.x → 2.0`.

#### TDD + BDD

```
RED:     test_codemod_rewrites_single_import() — Given before/single-import.ts, When codemod runs, Then output equals after/single-import.ts byte-for-byte
RED:     test_codemod_splits_mixed_imports() — Given before/mixed-imports.ts, When codemod runs, Then 5 separate imports emitted matching mapping
RED:     test_codemod_preserves_aliases() — Given before/aliased.ts, When codemod runs, Then aliases preserved in new imports
RED:     test_codemod_idempotent() — Given codemod ran once, When ran again, Then output identical (no double-rewrite)
RED:     test_codemod_warns_namespace_import() — Given import * as SDK from '@theokit/sdk', When codemod runs, Then comment '// CODEMOD: namespace import requires manual review' inserted
RED:     test_codemod_unknown_symbol_warns() — Given import { UnknownExport } from '@theokit/sdk', When codemod runs, Then console.warn emitted with file:line + 'UnknownExport not in mapping'
RED:     test_codemod_dry_run_default() — Given codemod invoked without --write, Then NO files modified on disk; only prints diff
RED:     test_codemod_write_flag_modifies() — Given --write flag, Then files updated in place
RED:     test_codemod_agent_create_without_budget_inserts_warn_comment() (EC-3) — Given Agent.create({ name, model }) without budgetTracker, When codemod runs, Then leading comment '// CODEMOD-WARN: SDK 2.0 — Agent.create no longer auto-creates Budget.' inserted before the CallExpression
RED:     test_codemod_agent_create_with_budget_no_warn() (EC-3) — Given Agent.create({ budgetTracker: tracker, ... }), When codemod runs, Then NO budget-warn comment inserted (idempotent for compliant call-sites)
RED:     test_codemod_agent_create_with_handoffs_inserts_comment() (EC-4) — Given Agent.create({ handoffs: [...] }), When codemod runs, Then leading comment '// CODEMOD: handoffs option removed in 2.0 — wrap target agents with Handoff.asPlugin' inserted
RED:     test_codemod_agent_create_no_handoffs_no_comment() (EC-4) — Given Agent.create without handoffs property, When codemod runs, Then NO handoff-comment inserted
GREEN:   Implement codemod
REFACTOR: Extract mapping loading + import-group consolidation helpers
VERIFY:  pnpm vitest run tests/unit/migration-1-x-to-2-0-codemod.test.ts
```

BDD scenarios:
- **Happy path:** consumer roda `npx jscodeshift -t scripts/migrations/1-x-to-2-0.mjs --write src/**/*.ts` → todos os imports migrados, tsc clean.
- **Validation error:** consumer roda em arquivo .tsx mal-formado → jscodeshift parse error com file:line.
- **Edge case:** import só com side-effect (`import '@theokit/sdk'`) → comment "Manual review: side-effect import" + preserva.
- **Error scenario:** consumer interrompe (Ctrl+C) mid-write → arquivos parcialmente migrados; idempotency garante segunda run completa.

#### Acceptance Criteria
- [ ] Codemod implementado em jscodeshift
- [ ] Mapping completo cobrindo todos os exports removidos
- [ ] 10 fixtures (5 before, 5 after) byte-equal — incluindo `agent-create-no-budget` (EC-3) e `agent-create-handoffs` (EC-4)
- [ ] **EC-3:** CallExpression transform detecta `Agent.create` sem `budgetTracker` e insere comment
- [ ] **EC-4:** CallExpression transform detecta `Agent.create({ handoffs })` e insere comment (sem auto-rewrite)
- [ ] 12 unit tests GREEN (8 originais + 4 novos EC-3/EC-4)
- [ ] Dry-run em dogfood-app produz diff esperado
- [ ] Idempotent

#### DoD
- [ ] Commit
- [ ] devDep jscodeshift adicionada
- [ ] Test passes

---

## Phase 9: Documentation — packages/README.md + migration guide

**Objective:** Documentar as 5 famílias + guia de migração 1.x → 2.0.

### T9.1 — Write packages/README.md family table

#### Objective
Tabela única que orienta novo contributor / consumer sobre agrupamento.

#### Evidence
Hoje `packages/` é flat com 22+ subpastas. Sem README, ninguém sabe que `gateway-telegram` e `memory-honcho` são "famílias" diferentes.

#### Files to edit
```
packages/README.md — (NEW) family table
packages/sdk-core/README.md — atualizar com nova surface (sem Memory/Budget/Cache/Handoff)
packages/sdk-memory/README.md — pre-existente do Phase 1, completar
packages/sdk-budget/README.md — pre-existente do Phase 2, completar
packages/sdk-cache/README.md — pre-existente do Phase 3, completar
packages/sdk-handoff/README.md — pre-existente do Phase 4, completar
packages/sdk-tools/README.md — pre-existente do Phase 5, completar
docs/migration/1-x-to-2-0.md — (NEW) migration guide
README.md (root) — atualizar para mencionar família + link para packages/README.md
```

#### Deep file dependency analysis

**packages/README.md template:**
```markdown
# theokit-sdk packages

This monorepo ships 27 packages organized in 5 families.

| Family | Packages | Purpose |
|---|---|---|
| **core** | @theokit/sdk-core, @theokit/sdk-memory, @theokit/sdk-budget, @theokit/sdk-cache, @theokit/sdk-handoff, @theokit/sdk-tools, @theokit/di, @theokit/di-agent, @theokit/orm | Agent runtime + extensions + data layer |
| **react** | @theokit/react | React hooks bound to sdk-core |
| **channels** | @theokit/gateway, @theokit/gateway-telegram, @theokit/gateway-slack, @theokit/gateway-whatsapp, @theokit/gateway-teams, @theokit/gateway-email, @theokit/gateway-sms, @theokit/gateway-mattermost, @theokit/gateway-line, @theokit/gateway-matrix, @theokit/gateway-discord | Channel adapters (1 core + 10 channel implementations) |
| **memory-adapters** | @theokit/memory-honcho, @theokit/memory-mem0, @theokit/memory-supermemory | External memory backends |
| **integrations** | @theokit/acp, @theokit/skills-google-workspace, @theokit/cli | Protocol adapters + tooling |
```

**Migration guide structure (docs/migration/1-x-to-2-0.md):**
1. Summary of changes
2. 1-command upgrade snippet (`npx jscodeshift -t ...`)
3. Manual steps (peer-deps install, budget tracker explicit injection)
4. Before/after per common surface
5. Breaking changes complete list
6. Rollback procedure (back to 1.7.0)

#### Tasks
1. Escrever `packages/README.md` com tabela das 5 famílias.
2. Atualizar `packages/sdk-core/README.md` refletindo surface 2.0.
3. Completar READMEs de sdk-memory/budget/cache/handoff/tools (foram stubs nas phases 1-5).
4. Escrever `docs/migration/1-x-to-2-0.md` completo.
5. Atualizar root README mencionando família + linking.
6. Commit.

#### TDD + BDD

```
RED:     test_packages_readme_has_5_families() — Given the doc, When parsing markdown table, Then exactly 5 family rows present
RED:     test_packages_readme_lists_all_packages() — Given the inventory, When extracting package names from table cells, Then all 27 packages listed (no orphans)
RED:     test_migration_guide_has_codemod_snippet() — Given the doc, When grepping for 'npx jscodeshift', Then snippet present in install section
RED:     test_migration_guide_has_before_after_blocks() — Given the doc, When counting ```typescript code blocks, Then at least 10 before/after pairs
RED:     test_sdk_core_readme_reflects_2_0_surface() — Given the rewrite, When grepping README for 'Memory', Then mention prefixes with "see @theokit/sdk-memory" (no claim of own export)
RED:     test_root_readme_links_packages_readme() — Given orientation, When parsing root README, Then markdown link to packages/README.md present
GREEN:   Write docs
REFACTOR: Cross-link READMEs consistently
VERIFY:  pnpm vitest run tests/unit/docs-sdk-2-0.test.ts
```

BDD scenarios:
- **Happy path:** new contributor opens `packages/README.md`, identifies family, navigates to package README, sees usage example.
- **Validation error:** family table missing a package → test fails naming missing package.
- **Edge case:** README sub-link to internal anchor → manually validated; tests check link target exists.
- **Error scenario:** docs out-of-sync with package.json names → test grep mismatches names, fails.

#### Acceptance Criteria
- [ ] `packages/README.md` lista 5 famílias com 27 packages
- [ ] `docs/migration/1-x-to-2-0.md` completo
- [ ] 6 READMEs de sdk-* updated
- [ ] Root README aponta para packages/README.md
- [ ] 6 unit tests GREEN

#### DoD
- [ ] Commit
- [ ] Links válidos (testado)

---

## Phase 10: CI bundle budget gate

**Objective:** Garantir que ganho de bundle não regredeça via novo CI gate.

### T10.1 — `scripts/check-bundle-budget.mjs` + GH Actions step

#### Objective
Sem assertion, alguém adiciona re-export inadvertido em sdk-core, barrel volta a 138 KB. CI deve quebrar antes do merge.

#### Evidence
Pattern provado: `theokit/scripts/check-bundle-budget.sh` (assertion 350 KB scaffold default).

#### Files to edit
```
scripts/check-bundle-budget.mjs — (NEW) lê packages/*/.bundle-budget.json, mede dist/index.js gzipped, falha se > threshold
packages/sdk-core/.bundle-budget.json — (NEW) { "dist/index.js": 30000 }
packages/sdk-memory/.bundle-budget.json — (NEW) { "dist/index.js": 60000 }
packages/sdk-budget/.bundle-budget.json — (NEW) { "dist/index.js": 20000 }
packages/sdk-cache/.bundle-budget.json — (NEW) { "dist/index.js": 25000 }
packages/sdk-handoff/.bundle-budget.json — (NEW) { "dist/index.js": 15000 }
packages/sdk-tools/.bundle-budget.json — (NEW) { "dist/index.js": 15000 }
package.json (root) — adicionar script "check:bundle": "node scripts/check-bundle-budget.mjs"
.github/workflows/ci.yml — adicionar step `pnpm check:bundle` antes do publish
```

#### Deep file dependency analysis

**scripts/check-bundle-budget.mjs algorithm:**
1. Find all `packages/*/.bundle-budget.json`.
2. Para cada budget file, lê config `{ "dist/index.js": <maxBytes> }`.
3. Mede `gzipped size` do dist file: `gzip -c <file> | wc -c`.
4. Compara com max.
5. Exit 0 se all within budget; exit 1 com tabela com offenders se any over.

**Output sample:**
```
[bundle-budget] PASS  @theokit/sdk-core      dist/index.js     28432 / 30000 bytes  (94%)
[bundle-budget] PASS  @theokit/sdk-memory    dist/index.js     54123 / 60000 bytes  (90%)
[bundle-budget] FAIL  @theokit/sdk-cache     dist/index.js     27801 / 25000 bytes  (111%) ❌
```

#### Tasks
1. Escrever `scripts/check-bundle-budget.mjs` (Node, no deps).
2. Adicionar `.bundle-budget.json` em cada um dos 6 packages.
3. Adicionar script em root package.json.
4. Adicionar step em CI workflow.
5. Rodar local: `pnpm check:bundle` exit 0.
6. Commit.

#### TDD + BDD

```
RED:     test_check_bundle_budget_pass() — Given a package within budget, When script runs, Then exit code 0 AND stdout contains 'PASS <name>'
RED:     test_check_bundle_budget_fail_on_overshoot() — Given a package above budget, When script runs, Then exit code 1 AND stdout contains 'FAIL <name>'
RED:     test_check_bundle_budget_handles_missing_dist() — Given a package without dist/, When script runs, Then warns "build first" AND skips with exit 0 (não falsifica)
RED:     test_check_bundle_budget_lists_all_offenders() — Given multiple over-budget, When script runs, Then all listed in output (não para no primeiro)
RED:     test_bundle_budget_files_have_required_keys() — Given the config schema, When parsing each .bundle-budget.json, Then has at minimum 'dist/index.js' key with positive integer value
GREEN:   Implement script + config files
REFACTOR: Extract size-formatting helper
VERIFY:  pnpm vitest run tests/unit/check-bundle-budget.test.ts
```

BDD scenarios:
- **Happy path:** all packages within budget → CI green.
- **Validation error:** invalid .bundle-budget.json (non-numeric value) → script exit 2 com mensagem clara.
- **Edge case:** package sem dist/ (build esquecido) → warn + skip (não fail) para evitar falso positivo em PRs WIP.
- **Error scenario:** PR adiciona re-export pesado → CI step fails, PR não merge até reverter ou bumpar budget (com justificativa em PR).

#### Acceptance Criteria
- [ ] Script implementado
- [ ] 6 packages com `.bundle-budget.json`
- [ ] CI step adicionado
- [ ] 5 unit tests GREEN
- [ ] `pnpm check:bundle` local: PASS para todos

#### DoD
- [ ] Commit
- [ ] CI workflow validado em PR de teste

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Barrel `@theokit/sdk` 138 KB gzipped (god-export) | T6.1 | Barrel strip + rename → sdk-core 2.0; budget gate ≤ 30 KB |
| 2 | 361 .ts files num único package | T1.1, T2.1, T3.1, T4.1, T5.1 | Memory/Budget/Cache/Handoff/Tools extracted; sdk-core fica com ~200 files |
| 3 | Memory subsystem (4070 LOC) acoplado ao core | T1.1 | Move para @theokit/sdk-memory; peerDep clean |
| 4 | Budget acoplado via direct import no agent-loop | T2.1 | Interface BudgetTracker em sdk-core; impl em sdk-budget; DI |
| 5 | Cache no barrel principal | T3.1 | Move para @theokit/sdk-cache; integration via Plugin |
| 6 | Handoff auto-wired no agent-init | T4.1 | Move para @theokit/sdk-handoff; integration via Plugin |
| 7 | Tools no sub-path mas sem package | T5.1 | Move para @theokit/sdk-tools; deps próprias |
| 8 | 22 packages misturam famílias semânticas | T9.1 | Tabela em packages/README.md documenta 5 famílias |
| 9 | Sem retro-compat = consumers quebram silenciosamente | T8.1 | Codemod jscodeshift + dry-run + migration guide |
| 10 | Sem assertion de bundle = regressão futura | T10.1 | scripts/check-bundle-budget.mjs + CI gate |
| 11 | 21 packages com peerDep desatualizado pós-rename | T7.1 | Cohort bump simultâneo via changesets |
| 12 | Documentação 1.x não reflete 2.0 | T9.1 | docs/migration/1-x-to-2-0.md + 6 READMEs |
| 13 | Sem snapshot pre-change para comparar | T0.1 | Baselines persistidos em .claude/knowledge-base/baselines/ |
| 14 | Agent.create default behavior muda (budget opt-in) | T2.1 | Migration guide documenta; codemod cobre |
| 15 | Sub-paths (cron/eval/workflow/subscription/server-auth) preservados | T6.1 | Mantém sub-paths existentes; só barrel principal strip |
| 16 | npm @theokit/sdk velho fica órfão | T6.1 | Deprecation message via npm deprecate API |
| 17 | Cross-repo theokit/ workspace path desatualizado | T6.1 | Update pnpm-workspace.yaml em ambos repos |
| 18 | Tests legados que importam de @theokit/sdk | T1.1-T7.1 | Moved alongside source ou rewriteados em cohort |
| 19 | Persistence shared (atomic-write) entre core + extracted | T1.1 (decisão) | Mantido em sdk-core/internal/persistence; sdk-memory imports via sub-path |
| 20 | Registry no kernel (não extraído) | D8 ADR | Documentado por que NÃO extrair; circular dep evitado |
| 21 (EC-1) | Sub-path `internal/persistence` não em exports field → ESM bloqueia consumer | T1.1 | Sub-path explicitamente declarado em `packages/sdk-core/package.json` exports; README sinaliza "internal API — semver-exempt" |
| 22 (EC-2) | tsup bundla sdk-core dentro de cada extracted package, defeating split | T1.1, T2.1, T3.1, T4.1, T5.1 | Cada `tsup.config.ts` declara `external: [/^@theokit\//]`; grep `dist/index.js` valida ausência de `class Agent` |
| 23 (EC-3) | Agent.create perde Budget default silenciosamente → cost runaway em prod | T2.1, T8.1 | `warnOnce` em runtime quando `budgetTracker` ausente + codemod insere CODEMOD-WARN comment em cada call-site |
| 24 (EC-4) | `Agent.create({ handoffs })` legacy call-site não capturado por codemod (só imports) | T4.1, T8.1 | `AgentCreateOptions` interface `exact` (TS2353) + codemod CallExpression transform insere CODEMOD comment |
| 25 (EC-5) | Falta `pnpm install -w` entre phases → workspace não registra novos packages | T2.1, T3.1, T4.1, T5.1 | Cada Tasks list termina com `pnpm install -w` antes do commit; AC inclui `pnpm list -r --depth=0 @theokit/sdk-<x>` verifica registro |

**Coverage: 25/25 gaps (100%)** — 20 original + 5 edge cases absorbed v1.1

## Global Definition of Done

- [ ] All 10 phases completed (Phase 0 baseline + Phases 1-5 extract + 6 rename + 7 cohort + 8 codemod + 9 docs + 10 CI)
- [ ] All tests passing (Vitest unit + integration + type-tests)
- [ ] Zero TypeScript errors em `pnpm tsc --noEmit` no root
- [ ] Zero Biome warnings em packages modificados
- [ ] `pnpm check:bundle` PASS para todos os 6 packages sdk-*
- [ ] 27 packages publicados em cohort via changesets
- [ ] Codemod testado em dogfood-app (dry-run) + applicado real após validação
- [ ] Migration guide com before/after por surface
- [ ] Cross-repo theokit/ workspace paths atualizados
- [ ] CHANGELOG entries em cada package modificado (Keep a Changelog)
- [ ] **Dogfood QA PASS** — `/dogfood-app full` health ≥ 70, zero CRITICAL
- [ ] **Fixture proof** — `tests/fixtures/codemod-1x/` com before/after cobrindo 3+ cenários
- [ ] **npm deprecation** aplicada em `@theokit/sdk@1.7.0` apontando para `@theokit/sdk-core@2.0.0`

## Final Phase: Dogfood QA (MANDATORY)

**Objective:** Validar que SDK 2.0.0 funciona end-to-end como real-LLM agent product em dogfood-app, não só em testes unitários.

### Execution

1. Aplicar codemod em `dogfood-app/`: `npx jscodeshift -t scripts/migrations/1-x-to-2-0.mjs --write 'src/**/*.ts'`.
2. Atualizar dogfood-app/package.json deps: `@theokit/sdk@1.7.0` → `@theokit/sdk-core@2.0.0` + adicionar `@theokit/sdk-memory`, `@theokit/sdk-budget`, `@theokit/sdk-cache` conforme necessário.
3. `pnpm install` no dogfood-app.
4. `pnpm typecheck` deve exit 0.
5. `pnpm build` deve exit 0.
6. `pnpm dev` boot.
7. Rodar `/dogfood-app full` (skill canônica do TheoKit).
8. Validar real-LLM chat com OpenRouter gpt-4o-mini (cost real reportado).
9. Validar memory save/recall round-trip (sdk-memory live).
10. Validar agent handoff smoke (sdk-handoff live).

### Acceptance Criteria

- [ ] Health score ≥ 70/100 em `/dogfood-app full`
- [ ] Zero CRITICAL issues introduzidos pelo split
- [ ] Zero HIGH issues em surfaces tocadas pelo plano (Agent.create, Memory.recall, Budget.create, Cache.semantic, Handoff)
- [ ] Real-LLM smoke: ≥ 1 mensagem com resposta válida + cost > 0 reportado
- [ ] Bundle de dogfood-app NÃO maior que pre-split (medido via `pnpm build` + `gzip dist/assets/index-*.js`)
- [ ] Migration codemod aplicado sem manual fixes (or manuais documented como out-of-scope)

### If Dogfood Fails

1. Identificar se issue é plan-caused ou pre-existing (comparar com baseline Phase 0).
2. Plan-caused CRITICAL/HIGH → fix antes de declarar plano completo; re-run `/dogfood-app full`.
3. Pre-existing → log em report, NÃO bloqueia.
4. Bundle regression → analisar tree-shake via source-map-explorer; ajustar exports.
