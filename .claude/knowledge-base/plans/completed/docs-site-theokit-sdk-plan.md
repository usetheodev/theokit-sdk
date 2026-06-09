# Plan: Docs Site for `@theokit/sdk` (Roadmap v1.4 #1)

> **Version 1.1** (2026-05-23) — Sai do estado "1 página esqueleto" para um site de documentação navegável e completo do `@theokit/sdk`, vivendo em `theo-opendocs/content/theokit-sdk/`. Inspirado de forma absoluta pelas referências (Mastra IA + OpenAI Agents conciseness + Hermes operational depth). Inclui: getting-started, conceitos, API reference auto-gerada (TypeDoc → MDX), cookbook auto-gerado de `examples/`, drift detection no CI, busca, deploy Cloudflare Pages. Resultado esperado: ao final do plano, qualquer pessoa que chegar em `usetheo.dev/theokit-sdk/` consegue ler quickstart, navegar a API completa do SDK v1.20+ (todos os 7 itens shipados v1.3 + Bedrock/Vertex), copiar cookbook recipes que funcionam, e buscar texto. `docs.md` continua canonical mas deixa de ser o único front-door.

> **Edge-case review 2026-05-23 absorbed (v1.1):** 6 MUST FIX e 3 SHOULD TEST identificados pela skill `edge-case-plan` foram incorporados nos tasks:
> - **EC-1** (T1.1) — `_placeholder.mdx` em subfolders novos pra Fumadocs não quebrar build entre Phase 1 e Phase 3-5.
> - **EC-2** (T4.2) — sanitizer de filename para symbols namespaced (`Theokit.models.list`).
> - **EC-3** (T4.2) — pre-clean de `reference/` antes de emitir (evita órfãos de symbols renomeados/removidos).
> - **EC-4** (T4.2) — escape de triple-backticks em JSDoc (evita MDX parser fechar bloco cedo).
> - **EC-5** (T5.1) — fallback `run.ts → src/index.ts → index.ts` + skip-on-missing-README + lista de `EXCLUDED`.
> - **EC-6** (T8.1) — `SECTION_TO_SLUG` mapping table inline (evita false-positive drift por naming mismatch).
>
> SHOULD TEST (EC-7/8/9) viraram entradas no TDD existente; DOCUMENT (EC-10/11) ficam como nota inline para manutenção pós-v1.

## Context

### O que existe hoje

1. **`packages/sdk/docs.md`** — 2687 linhas, canonical, único arquivo. Contém 7 features v1.3 (CLI, Eval, Handoffs, Workflows, Cache, Slack, Bedrock+Vertex) + tudo do v1.0-1.2. Sem busca, sem cross-link inteligente, sem deep-link estável (anchors mudam quando alguém edita), sem TOC consultável.

2. **`../theo-opendocs/`** — Next.js 16 + Fumadocs 16 + MDX, **já bootstrapped e em produção**. Tem 6 pilares carregando (paas, theocode, theocreate, theokit, theokit-sdk, theoui) e o `theokit-sdk` tem APENAS 1 página: `content/theokit-sdk/index.mdx` com texto placeholder + `meta.json: { "pages": ["index"] }`. Routes funcionam (`app/theokit-sdk/[[...slug]]/page.tsx`).

3. **`examples/`** — 9 examples reais funcionando (bedrock-bot, cache, eval, handoffs, slack-bot, telegram-pro, vertex-bot, workflows, + README com feature matrix de 36 examples antigos).

### Evidência de que é o gap #1

- Roadmap v1.3 (registrado em CLAUDE.md) marcou Docs site como T1 #3 — **único T1 NÃO shipado** ao fim do v1.3 (CLI ✅ + Eval ✅ shipped).
- Auditoria estratégica 2026-05-23: "7 itens v1.3 shipados ficam invisíveis sem cookbook navegável + API ref + search. `theo-opendocs` já bootstrapped vazio."
- Mastra / OpenAI Agents / Vercel AI ganham **10x em onboarding** por causa de docs site. Sem isso, nossa SDK é tecnicamente competitiva mas estrategicamente invisível.

### Referências auditadas (`referencia/`)

- **Mastra** (`referencia/mastra/docs/src/content/en/`): IA mais sofisticada — `docs/` (conceito/feature), `guides/` (tutoriais), `reference/` (API auto), `models/{providers,gateways}`. Versionamento via `feature-versioning.json`. Docusaurus. **Inspiração absoluta** para IA TS-first.
- **OpenAI Agents** (`referencia/openai-agents-python/`): mkdocs + mkdocstrings (Python). 32 páginas top-level achatadas + nav agrupado. Conciseness > taxonomy. **Inspiração** para tom direto e referência auto.
- **Hermes** (`referencia/hermes-agent/docs/` + `website/docs/`): docs + site separados. Pattern de canonical-markdown + site rendering. Não copiar IA do Hermes (muito Python-flavored), mas validar nosso split canonical-vs-site.
- **OpenClaw** (`referencia/openclaw/docs/`): 50+ markdowns top-level. Anti-padrão — sem IA = não navegável. **Não imitar.**

## Objective

**Done = `usetheo.dev/theokit-sdk/` é a porta de entrada efetiva do SDK.**

Metas mensuráveis:

1. **Cobertura ≥ 95%**: cada feature listada em `docs.md` (regex de `^## ` + `Agent.<name>`, `Cron.<name>`, `Memory.*`, etc.) tem MDX correspondente em `theo-opendocs/content/theokit-sdk/`.
2. **API reference auto-gerada** de TypeDoc JSON do `packages/sdk/dist/*.d.ts` (zero docs escritos à mão para signatures).
3. **Cookbook auto-gerado** de `examples/*/run.ts` + `README.md` — 9 recipes mínimo (1 por example shipado).
4. **Busca funcional** via Fumadocs Orama (built-in, sem Algolia, custo zero).
5. **Drift detection CI gate**: PR que muda `docs.md` mas não toca `theo-opendocs/content/theokit-sdk/` falha o check; PR que adiciona feature pública sem MDX falha.
6. **Deploy live** em Cloudflare Pages, build verde, dogfood manual de navegação 100% PASS (todos os links resolvem, busca acha cada feature, 0 broken images).

## ADRs

### D1 — Site host = `theo-opendocs/content/theokit-sdk/`
- **Decisão:** Não criar repo novo. Usar o `theo-opendocs` sibling já em produção.
- **Rationale:** Bootstrap pronto (Next 16, Fumadocs 16, MDX, Shiki, Mermaid, wrangler deploy). Compartilha layout/theming com outros pilares (paas, theocode, theokit, theoui). Migrar pra repo novo gastaria 1-2 semanas só de infra duplicada.
- **Consequências:** Cross-repo workflow para qualquer mudança (PR no theokit-sdk + PR no theo-opendocs). Mitigado por CI gate de drift (D14).

### D2 — IA inspirada em Mastra (4 sections top-level)
- **Decisão:** Estrutura `theokit-sdk/{getting-started, concepts, reference, cookbook}/*.mdx` + `index.mdx` landing.
- **Rationale:** Mastra é o produto mais próximo (TS, agentes, multi-feature) e tem IA navegável validada por usuários reais. OpenAI Agents é mais raso (32 páginas em 1 nível) — funciona pra Python mas pra TS multi-pkg (gateway-*, cli, sdk, react) precisamos mais profundidade. Hermes mistura docs/site — não copiar.
- **Consequências:** 4 seções top-level (concepts é o "Documentation" do OpenAI Agents). API ref auto em `reference/`. Cookbook auto em `cookbook/`. Manualmente escrito: `getting-started/` (5 pages) + `concepts/` (índice + leve curadoria de docs.md splits).

### D3 — Source-of-truth split documentado
- **Decisão:** `packages/sdk/docs.md` continua canonical do contrato técnico. `theo-opendocs/content/theokit-sdk/*.mdx` é a **superfície de leitura**. Split é per-feature; cada MDX referencia o anchor canonical do `docs.md` no topo.
- **Rationale:** `docs.md` monolítico é fácil para LLMs/agentes consumirem (1 fetch) e é a referência durante review. Site é para humanos navegarem. Mover canonical pro site quebra a propriedade "1 grep resolve a busca de API" que valorizamos no dev loop interno.
- **Consequências:** Drift entre os dois é risco real → resolvido por D14 (CI gate). Cada MDX começa com `> Canonical: [docs.md §<section>](link)` line.

### D4 — API reference 100% auto-gerada via TypeDoc
- **Decisão:** Script Node `scripts/generate-sdk-reference.ts` no `theo-opendocs/scripts/`. Roda `typedoc --json` no `packages/sdk/dist/index.d.ts`, parseia JSON, emite MDX por exported symbol (Agent, Cron, Theokit, Memory, Cache, Workflow, Eval, Handoff, etc.).
- **Rationale:** Escrever signatures à mão diverge em ≤2 semanas. Mastra usa mesma estratégia (TypeDoc → MDX). OpenAI Agents Python usa mkdocstrings (mesma filosofia, autogen). TypeScript tem TypeDoc estável desde 2018.
- **Consequências:** API ref é write-once, regenera no CI quando `dist/*.d.ts` muda. Nunca commitamos MDX em `reference/` à mão. Trade-off: signatures auto têm formatação genérica (vs. carinho humano); ganha em up-to-date.

### D5 — Cookbook 100% auto-gerado de `examples/`
- **Decisão:** Script Node `scripts/generate-sdk-cookbook.ts`. Lê `examples/*/README.md` + `examples/*/run.ts` (ou `src/index.ts`) e emite MDX com seção "Setup" (README), "Code" (Shiki render do source), "Run" (comando exato `pnpm tsx ...`).
- **Rationale:** Examples já existem, são testados (real-LLM-validated), e o trabalho de duplicar como prose é redundante. Mastra Examples + OpenAI Agents Examples seguem mesma filosofia. Quando alguém shipa um example novo, recipe aparece de graça.
- **Consequências:** Cookbook never lies — recipe é literalmente o código que roda. Trade-off: prose narrativa fica limitada ao README do example; mitigado por README mais rico nos examples (≥30 linhas mínimo).

### D6 — Search via Fumadocs Orama (built-in)
- **Decisão:** Habilitar `fumadocs-core/search` server-side (Orama embedded, sem Algolia/Meilisearch externa).
- **Rationale:** Custo zero, OSS, funciona offline em static export. Não temos volume pra justificar Algolia ($499/mês quando passa do free tier). Mastra e Fumadocs default usam Orama.
- **Consequências:** Search index cresce com docs (~1MB por 100 pages) — aceitável. Re-index automático no build.

### D7 — i18n DEFERIDO (só EN no v1)
- **Decisão:** Fumadocs `defineDocs` aceita `content/theokit-sdk/{en,pt,ja}/...` mas v1 só usa EN (sem subfolder de language).
- **Rationale:** OpenAI Agents tem 4 idiomas (en/ja/ko/zh) — ROI questionável pré-PMF. Mastra tem en/ja. Nosso ICP atual é dev TS global, EN basta. Estrutura preparada para virar i18n quando demanda concreta aparecer (basta mover content/* → content/en/* + adicionar locales).
- **Consequências:** Não bloqueia v1; v1.x adiciona pt-BR (nosso mercado primário) sem refactor estrutural.

### D8 — Versionamento DEFERIDO (single-version v1)
- **Decisão:** SDK está pre-1.0 ainda (npm `1.0.0` mas mudando rápido). Não vamos snapshotar docs por versão. Cada MDX cita `(v1.x+)` no título quando aplicável.
- **Rationale:** Mastra usa `feature-versioning.json` mas eles já têm v1 estável. Versionar docs pré-PMF dobra superfície de manutenção sem ganho. Voltar pra isso em v2.
- **Consequências:** Quem precisa de docs antigos lê git tag do `docs.md`. v2 introduz Fumadocs feature-versioning.

### D9 — Deploy = Cloudflare Pages (existing `wrangler.toml`)
- **Decisão:** `pnpm pages:build && pnpm pages:deploy` no `theo-opendocs/`. URL canonical `usetheo.dev/theokit-sdk/` (rota Next).
- **Rationale:** Já configurado, free tier infinito de bandwidth, deploy preview por PR via Cloudflare Pages GitHub integration. Static export (Next 16 `output: 'export'`).
- **Consequências:** Build é estático — sem SSR/RSC dinâmico. Search via Orama JSON loaded client-side. Mermaid client-render.

### D10 — Cross-repo CI gate via shared script
- **Decisão:** `theokit-sdk/.github/workflows/docs-drift.yml` roda em PR. Detecta `docs.md` diff vs `theo-opendocs/content/theokit-sdk/*.mdx` última modificação. Falha se docs.md mudou sem MDX correspondente; falha se símbolo público novo em `dist/index.d.ts` não está no `reference/`.
- **Rationale:** Sem gate, drift garantido em ≤4 semanas (pattern conhecido — vide histórico de `docs.md` vs CLAUDE.md ADRs).
- **Consequências:** Workflow tem permissão de leitura no `theo-opendocs` (via PAT ou submodule). Trade-off de complexidade aceito — alternativa é monorepo merge, que custa muito mais.

### D11 — Landing page redesign tipo Mastra/OpenAI homepage
- **Decisão:** `content/theokit-sdk/index.mdx` vira hero (1 frase + 1 botão Quickstart) + 4 Cards (Concepts / Reference / Cookbook / Examples) + 2 sections (What it is / Why this stack). Removendo dump corrente de 6 cards.
- **Rationale:** Landing atual lista 6 core primitives — informação técnica que pertence a Concepts. Landing deve **vender ação** (quickstart em 30s). Vide Mastra `/docs` index.
- **Consequências:** Quem chegar via Google em "Agent SDK TypeScript" decide em 5s se vale ler mais.

### D12 — `getting-started` é o ÚNICO prose-heavy escrito à mão (5 pages)
- **Decisão:** Tudo mais é split de `docs.md` (concepts) OU auto-gerado (reference, cookbook). Escrita carinhosa só nos 5 pages: install, quickstart, project-structure, providers-setup, first-agent.
- **Rationale:** Escrever 30+ pages à mão é trabalho de 3 semanas + manutenção contínua. Focar carinho onde importa: onboarding. Depois disso a pessoa navega.
- **Consequências:** Concepts e reference vão ter linguagem mais seca/automatizada. Aceitável — usuário que chegou em concepts já passou pelo getting-started carinhoso.

### D13 — Mermaid + ASCII diagrams permitidos; SVG não
- **Decisão:** Diagramas inline em Mermaid (já suportado pelo theo-opendocs). ASCII art OK. SVG externo só se imprescindível (assets/).
- **Rationale:** Mermaid edita-se em texto, diff-friendly, versão-controla bem. SVG vira binário esquecido. ASCII funciona em `docs.md` E no site.
- **Consequências:** Pessoa abrindo PR pra adicionar diagrama edita Markdown, não desenha. Manutenção barata.

### D14 — Drift detection é gate "soft" no v1, "hard" no v1.1
- **Decisão:** v1 do plano emite WARNING no CI quando drift detectado, não bloqueia merge. v1.1 transforma em hard gate depois de 4 semanas estáveis.
- **Rationale:** Hard gate de cara causa fricção desproporcional enquanto ainda estamos calibrando o que conta como "drift legítimo" (rename de section, reorder, etc.).
- **Consequências:** v1 pode ter pequenos drifts; review humano cobre. Conversão pra hard em v1.1 é mudar 1 linha no workflow.

## Dependency Graph

```
Phase 0 (audit)  ──▶  Phase 1 (IA + meta.json)  ──▶  Phase 2 (getting-started)
                                                            │
                                                            ▼
                                                  Phase 3 (concepts split de docs.md)
                                                            │
                                                            ▼
                            Phase 4 (TypeDoc reference) ◀──┤
                                                            │
                                                            ▼
                            Phase 5 (cookbook from examples) ◀──┤
                                                            │
                                                            ▼
                                                  Phase 6 (landing redesign)
                                                            │
                                                            ▼
                                                  Phase 7 (search tuning + sidebars)
                                                            │
                                                            ▼
                                                  Phase 8 (drift CI gate)
                                                            │
                                                            ▼
                                                  Phase 9 (deploy + dogfood)
```

- **Phase 1-2** sequencial (precisa IA antes de escrever pages).
- **Phase 3, 4, 5** podem rodar em **paralelo** (após Phase 1 fechar). Cada uma é independente.
- **Phase 6-7-8** sequenciais (landing depende do conteúdo existir; sidebars dependem de tudo; gate depende do estado final).
- **Phase 9** é final.

---

## Phase 0: Audit current state

**Objective:** Confirm theo-opendocs build chain works and nothing está broken antes de escrever conteúdo.

### T0.1 — Verificar build do theo-opendocs

#### Objective
Garantir que `pnpm build` no `theo-opendocs` passa hoje, antes de qualquer mudança.

#### Evidence
`theo-opendocs/package.json` lista `next build`. Não rodei o build durante o audit; pode haver erro latente que polua nossa investigação.

#### Files to edit
```
(nenhum — só leitura/execução)
```

#### Deep file dependency analysis
- `theo-opendocs/next.config.mjs` configura Next.js + Fumadocs MDX
- `theo-opendocs/source.config.ts` define os `defineDocs` por pilar
- `theo-opendocs/app/theokit-sdk/[[...slug]]/page.tsx` é o catch-all route
- Build falha = pilar inteiro broken; PR não pode prosseguir

#### Deep Dives
- Comando: `cd ../theo-opendocs && pnpm install && pnpm types:check && pnpm build`
- Erros típicos: peer dep `@theokit/ui@0.6.1-next.0` pode estar drift; checar `node_modules/.pnpm/`
- Resultado esperado: `out/` populado, sem `[Error]` no stderr

#### Tasks
1. `cd ../theo-opendocs && pnpm install`
2. `pnpm types:check`
3. `pnpm build`
4. `ls out/theokit-sdk/` — confirmar que página existente renderizou
5. Documentar warnings (não falhas) em comment do PR

#### TDD
```
RED:     N/A (este é um sanity check, não código novo)
GREEN:   Build sai com exit code 0; arquivo `out/theokit-sdk/index.html` existe
REFACTOR: None expected
VERIFY:  test -f ../theo-opendocs/out/theokit-sdk/index.html
```

#### Acceptance Criteria
- [ ] `pnpm build` exit code 0
- [ ] `out/theokit-sdk/index.html` existe e não-vazio
- [ ] Zero TypeScript errors em `types:check`

#### DoD
- [ ] Build verde documentado em PR description
- [ ] Issues encontrados → tasks novos antes de prosseguir

---

### T0.2 — Inventariar features públicas exportadas pelo SDK

#### Objective
Lista canônica de todo export público do SDK pra usar como check-list de cobertura ao escrever `reference/`.

#### Evidence
`docs.md` tem 12 seções `^## ` (regex acima) + features dentro. `packages/sdk/src/index.ts` é o barrel canonical. Sem inventário, vamos esquecer features ao split.

#### Files to edit
```
.claude/knowledge-base/plans/docs-site-theokit-sdk-inventory.md (NEW) — lista
```

#### Deep file dependency analysis
- `packages/sdk/src/index.ts` exports todos os símbolos públicos
- `packages/sdk/dist/index.d.ts` é a versão TypeDoc-friendly
- Inventário guia D14 (drift check); sem ele não há baseline

#### Deep Dives
- Comando: `grep "^export" packages/sdk/src/index.ts | sort -u`
- Categorias: classes (`Agent`, `Cron`, `Cache`, `Workflow`, `Eval`, `Handoff`, `Memory`, `Theokit`), funções (`definePlugin`, `defineTool`, `extractRawId`, `mkMemoryId`), tipos públicos
- Confirmar `docs.md` cobre cada um (grep cruzado)

#### Tasks
1. Extrair todos os exports de `packages/sdk/src/index.ts`
2. Categorizar (class, function, type, namespace)
3. Cross-check com `docs.md` (grep por nome do símbolo)
4. Listar lacunas (símbolo exportado sem doc) — log mas NÃO consertar aqui (escopo do plano)
5. Salvar em `.claude/knowledge-base/plans/docs-site-theokit-sdk-inventory.md`

#### TDD
```
RED:     test_inventory_matches_index — todos os símbolos do barrel aparecem no inventário (script no Phase 8 valida)
GREEN:   Arquivo gerado com ≥40 entries (tamanho estimado da API pública)
REFACTOR: None expected
VERIFY:  wc -l .claude/knowledge-base/plans/docs-site-theokit-sdk-inventory.md  # >= 40
```

#### Acceptance Criteria
- [ ] Inventário lista ≥ 40 símbolos públicos
- [ ] Cada símbolo categorizado (class/function/type)
- [ ] Lacunas (símbolo sem docs) documentadas com TODO

#### DoD
- [ ] Inventário commitado em `.claude/knowledge-base/plans/`
- [ ] PR reviewer confirma "looks complete"

---

## Phase 1: Information Architecture

**Objective:** Estruturar pastas + meta.json para as 4 seções top-level antes de escrever conteúdo.

### T1.1 — Criar tree de pastas e meta.json hierárquico

#### Objective
Estrutura física no disco que o Fumadocs descobrirá automaticamente.

#### Evidence
Hoje `content/theokit-sdk/` tem 1 file e 1 meta.json com `"pages": ["index"]`. Sem subfolders.

#### Files to edit
```
theo-opendocs/content/theokit-sdk/meta.json — atualizar pages list
theo-opendocs/content/theokit-sdk/getting-started/meta.json (NEW)
theo-opendocs/content/theokit-sdk/concepts/meta.json (NEW)
theo-opendocs/content/theokit-sdk/reference/meta.json (NEW)
theo-opendocs/content/theokit-sdk/cookbook/meta.json (NEW)
```

#### Deep file dependency analysis
- Fumadocs `defineDocs({ dir: 'content/theokit-sdk' })` (já existe em `source.config.ts`) recursivamente carrega o tree
- `meta.json` em cada folder define `title`, `description`, `pages` (ordem da sidebar)
- Sem `meta.json` → Fumadocs ordena alfabético (ruim para getting-started where order matters)

#### Deep Dives
- Estrutura proposta:
  ```
  content/theokit-sdk/
  ├── index.mdx                    # landing (redesign no Phase 6)
  ├── meta.json                    # { root: true, pages: [
                                   #   "index", "getting-started", "concepts", "reference", "cookbook"
                                   # ]}
  ├── getting-started/
  │   ├── meta.json                # { pages: ["install", "quickstart", "project-structure", "providers", "first-agent"] }
  │   ├── install.mdx
  │   ├── quickstart.mdx
  │   ├── project-structure.mdx
  │   ├── providers.mdx
  │   └── first-agent.mdx
  ├── concepts/
  │   ├── meta.json
  │   ├── agent.mdx
  │   ├── tools.mdx
  │   ├── sessions.mdx
  │   ├── streaming.mdx
  │   ├── mcp.mdx
  │   ├── hooks.mdx
  │   ├── memory.mdx
  │   ├── cron.mdx
  │   ├── eval.mdx
  │   ├── handoffs.mdx
  │   ├── workflows.mdx
  │   ├── cache.mdx
  │   ├── gateways.mdx
  │   ├── providers-bedrock-vertex.mdx
  │   ├── errors.mdx
  │   ├── telemetry.mdx
  │   ├── security.mdx
  │   ├── configuration.mdx
  │   └── plugins.mdx
  ├── reference/                   # populated by D4 generator
  │   └── meta.json                # { pages: ["index"] } — gerador preenche
  └── cookbook/                    # populated by D5 generator
      └── meta.json                # { pages: ["index"] }
  ```

#### Tasks
1. Criar diretórios listados
2. Escrever `meta.json` raiz reorganizando pages
3. Escrever `meta.json` de cada subfolder com ordem desejada
4. Não escrever .mdx final ainda — só estrutura (Phase 2-4 preenche)
5. **(EC-1 absorbed)** Criar `_placeholder.mdx` em cada subfolder novo (`concepts/`, `reference/`, `cookbook/`) com frontmatter `title: Coming soon, _draft: true` e 1 linha de body. Phases 3-5 sobrescrevem; objetivo é só evitar que Fumadocs quebre o build dev mode quando o folder tem `meta.json` mas zero .mdx. Não incluir `_placeholder` em `meta.json` pages (sidebar invisível).

#### TDD
```
RED:     test_meta_root_has_all_sections — `pages` raiz inclui as 4 subsections
RED:     test_meta_getting_started_order — ordem é install→quickstart→project-structure→providers→first-agent
RED:     test_placeholder_mdx_exists — concepts/_placeholder.mdx, reference/_placeholder.mdx, cookbook/_placeholder.mdx existem (EC-1)
GREEN:   Files criados; pnpm build verde mesmo com .mdx vazios; sidebar não mostra placeholders
REFACTOR: None expected
VERIFY:  cd ../theo-opendocs && pnpm build  # build verde
```

#### Acceptance Criteria
- [ ] 4 subfolders criados
- [ ] 5 meta.json files (root + 4 sub)
- [ ] `pnpm build` continua verde
- [ ] Sidebar Fumadocs em dev mode mostra 4 sections (concepts/reference/cookbook podem estar vazias)

#### DoD
- [ ] Tree commitada
- [ ] Screenshot do sidebar em PR

---

## Phase 2: Getting Started (manual prose)

**Objective:** Escrever os 5 pages de onboarding com carinho — só lugar prose-heavy do site.

### T2.1 — `install.mdx`

#### Objective
Página de install: requisitos, comando, validação.

#### Evidence
`docs.md` linhas iniciais cobrem install em ~10 linhas. Insuficiente para landing. Mastra `getting-started/installation` é referência: lista Node version, npm/yarn/pnpm/bun tabs, opcional troubleshoot.

#### Files to edit
```
theo-opendocs/content/theokit-sdk/getting-started/install.mdx (NEW)
```

#### Deep file dependency analysis
- Página standalone; só renderiza com `<Tabs>` (Fumadocs component disponível)
- Não depende de outras pages — pode ser a primeira a escrever

#### Deep Dives
- Frontmatter: `title: Install`, `description: Get @theokit/sdk installed in your project`
- Sections:
  1. Requirements (Node 22+, package manager)
  2. Install (`<Tabs>` com npm/pnpm/yarn/bun)
  3. Verify install (`node -e "console.log(require('@theokit/sdk').Agent)"`)
  4. Troubleshoot (link p/ providers if creds fail)
- Cita ADR D1 do SDK CLAUDE.md (Node 22+ mandatory)

#### Tasks
1. Criar arquivo com frontmatter
2. Section Requirements + table
3. Section Install com `<Tabs>` Fumadocs
4. Section Verify
5. Section Troubleshoot (link futuro para providers.mdx)

#### TDD
```
RED:     test_install_mdx_has_node_version — busca string "22" no body
RED:     test_install_mdx_has_all_pkg_managers — busca npm, pnpm, yarn, bun
GREEN:   File compila no MDX, build verde
REFACTOR: None expected
VERIFY:  grep -E "(22|npm|pnpm|yarn|bun)" content/theokit-sdk/getting-started/install.mdx
```

#### Acceptance Criteria
- [ ] Arquivo existe, ~50-80 linhas
- [ ] Tabs render OK no dev mode
- [ ] Links internos válidos
- [ ] Verify command copy-paste funciona

#### DoD
- [ ] Page renderizada localmente
- [ ] Screenshot incluído em PR

---

### T2.2 — `quickstart.mdx`

#### Objective
Quickstart: agent que responde em 10 linhas, end-to-end.

#### Evidence
`packages/sdk/README.md` tem quickstart de ~20 linhas. `docs.md` cobre mas espalhado. Mastra quickstart é gold standard: `npm create mastra@latest` + 5 linhas e roda.

#### Files to edit
```
theo-opendocs/content/theokit-sdk/getting-started/quickstart.mdx (NEW)
```

#### Deep file dependency analysis
- Depende de install.mdx (link)
- Vai apontar pra `examples/quickstart` (que existe? confirmar; se não, criar — escopo lateral)
- Referencia D4 (provider) sem ser bloqueante

#### Deep Dives
- Frontmatter: `title: Quickstart`, `description: Build and run your first agent in 30 seconds`
- Conteúdo:
  ```ts
  import { Agent } from "@theokit/sdk";

  const agent = await Agent.create({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: { id: "openai/gpt-4o-mini" },
  });

  const run = await agent.send("What is 2+2?");
  const result = await run.wait();
  console.log(result.result);
  await agent.dispose();
  ```
- Run: `npx tsx hello.ts` → "4"
- Próximos passos: link para concepts/agent + cookbook

#### Tasks
1. Frontmatter
2. Pre-req box (instalado + provider key)
3. Code block Shiki TypeScript (5-7 linhas)
4. Run section
5. Next steps cards (Agent concept / Tools / Streaming)

#### TDD
```
RED:     test_quickstart_has_code_block — busca ```ts
RED:     test_quickstart_under_100_lines — wc -l < 100
RED:     test_quickstart_next_steps_links — busca href para concepts/
GREEN:   Build verde
REFACTOR: None expected
VERIFY:  wc -l < 100 && grep "concepts/" content/theokit-sdk/getting-started/quickstart.mdx
```

#### Acceptance Criteria
- [ ] File < 100 linhas
- [ ] Code block é executável (copy-paste no Node 22 funciona)
- [ ] 3 next steps cards

#### DoD
- [ ] Code block testado localmente (literalmente cole no shell e roda)
- [ ] Screenshot em PR

---

### T2.3 — `project-structure.mdx`

#### Objective
Explicar `.theokit/` directory + workspace layout esperado.

#### Evidence
SDK lê `.theokit/agents/*.md`, `.theokit/skills/*.md`, `.theokit/personalities/*.md`, etc. Esses lookups são opacos sem doc.

#### Files to edit
```
theo-opendocs/content/theokit-sdk/getting-started/project-structure.mdx (NEW)
```

#### Deep file dependency analysis
- Depende de quickstart (linka pra ele como pré-req)
- Referencia ADRs D60, D74, D150-D158 do SDK (mas só prosa, sem links pra CLAUDE.md no público)

#### Deep Dives
- Tree mostrado:
  ```
  my-project/
  ├── .theokit/
  │   ├── agents/        # named agents (markdown + frontmatter)
  │   ├── skills/        # invokable skills
  │   ├── personalities/ # persona presets
  │   ├── plugins/       # local plugin definitions
  │   ├── cron/jobs.json # scheduled jobs
  │   └── mcp.json       # MCP server config
  ├── CLAUDE.md / AGENTS.md / GEMINI.md  # context files (auto-discovered)
  └── ...
  ```
- Section: User-level (`~/.theokit/`) vs Project-level (`.theokit/`)
- Section: env vars conhecidas (`THEOKIT_API_KEY`, `THEOKIT_HOME`, provider keys)

#### Tasks
1. Frontmatter
2. ASCII tree no top
3. Section per-folder com 1 frase + link pra concepts
4. Section env vars (tabela)

#### TDD
```
RED:     test_project_structure_lists_dot_theokit — busca `.theokit/`
RED:     test_project_structure_env_vars_table — busca THEOKIT_API_KEY
GREEN:   Build verde
VERIFY:  grep -E "(\.theokit|THEOKIT_API_KEY)" content/theokit-sdk/getting-started/project-structure.mdx
```

#### Acceptance Criteria
- [ ] ASCII tree + 6 sub-folders explicados
- [ ] Env vars tabela com ≥5 entries
- [ ] Links internos válidos

#### DoD
- [ ] Page renderiza
- [ ] Screenshot

---

### T2.4 — `providers.mdx`

#### Objective
Como configurar cada provider (OpenAI, OpenRouter, Anthropic, Gemini, Ollama, LM Studio, llama.cpp, Bedrock, Vertex) — passo a passo.

#### Evidence
SDK tem 9 builtin providers (D182, D188, D189, D286, D288 + 4 baseline). `docs.md` cobre superficialmente. Onboarding fricciona em "qual env var?" pra cada um.

#### Files to edit
```
theo-opendocs/content/theokit-sdk/getting-started/providers.mdx (NEW)
```

#### Deep file dependency analysis
- Referencia D182, D286-D302 dos ADRs do SDK
- Link pra concepts/providers-bedrock-vertex (deep dive)

#### Deep Dives
- Tabela master:
  | Provider | Env var | Auth type | Model prefix |
  | OpenAI | `OPENAI_API_KEY` | api-key | `openai/...` |
  | OpenRouter | `OPENROUTER_API_KEY` | api-key | `openai/...` etc |
  | Anthropic | `ANTHROPIC_API_KEY` | api-key | `anthropic/...` |
  | Gemini | `GEMINI_API_KEY` | api-key | `google/...` |
  | Ollama | (none) | none | `ollama/...` |
  | LM Studio | (none) | none | `lmstudio/...` |
  | llama.cpp | (none) | none | `llamacpp/...` |
  | Bedrock | AWS creds | aws_bearer | `bedrock/us....` |
  | Vertex | GCP creds | gcp_oauth | `vertex/...` |
- Section per-provider com 5-8 linhas:
  - Quick install peer dep (when applicable: `@aws/bedrock-token-generator`, `google-auth-library`)
  - Env vars
  - Pitfalls (ex: Bedrock "use case form")

#### Tasks
1. Frontmatter
2. Tabela master
3. 9 sections, uma por provider
4. Section "Multi-provider fallback" linkando concepts

#### TDD
```
RED:     test_providers_lists_all_9 — busca cada nome (openai, openrouter, anthropic, gemini, ollama, lmstudio, llamacpp, bedrock, vertex)
RED:     test_providers_table_has_env_var_column — busca THEOKIT_API_KEY pattern
GREEN:   Build verde
VERIFY:  for p in openai openrouter anthropic gemini ollama lmstudio llamacpp bedrock vertex; do grep -i $p content/theokit-sdk/getting-started/providers.mdx; done
```

#### Acceptance Criteria
- [ ] 9 providers cobertos
- [ ] Tabela master com 4 colunas
- [ ] Cada provider section ≥5 linhas

#### DoD
- [ ] Page renderiza
- [ ] Cada env var é precisa (cross-check com `packages/sdk/src/internal/providers/builtin/*.ts`)

---

### T2.5 — `first-agent.mdx`

#### Objective
Tutorial mais longo (~15min): agent com 1 tool real, persistente, com memory.

#### Evidence
Quickstart resolve "hello world". Próximo passo é "agent útil" — `examples/quickstart` é simples demais. Mastra tem "Your first agent" tutorial.

#### Files to edit
```
theo-opendocs/content/theokit-sdk/getting-started/first-agent.mdx (NEW)
```

#### Deep file dependency analysis
- Depende dos 4 anteriores
- Referencia concepts/tools, concepts/memory (que serão escritos no Phase 3)
- É a única page do getting-started com >100 linhas

#### Deep Dives
- Goal final: agent "weather-bot" que tem tool `getWeather(city)` (mock), persistir conversa
- Steps:
  1. Setup (refresh do quickstart)
  2. Define a tool com Zod schema
  3. Pass tools no Agent.create
  4. Conversation persistence (`agent.resume(agentId)`)
  5. Optional: add memory
- Cada step tem ~10 linhas código + 5 linhas prose

#### Tasks
1. Frontmatter
2. Goal section (com screenshot/prompt simulado)
3. Step 1: Setup
4. Step 2: Tool definition
5. Step 3: Wire tool
6. Step 4: Persistence
7. Step 5 (opcional): Memory
8. "Next" section: cookbook recipes / concepts

#### TDD
```
RED:     test_first_agent_has_tool_example — busca `defineTool` ou `Zod`
RED:     test_first_agent_has_persistence_step — busca `agent.resume`
GREEN:   Build verde
VERIFY:  grep -E "(defineTool|agent.resume|Zod)" content/theokit-sdk/getting-started/first-agent.mdx
```

#### Acceptance Criteria
- [ ] 5 steps numerados
- [ ] Cada step tem code + prose
- [ ] Tutorial copy-paste funciona end-to-end no Node 22

#### DoD
- [ ] Tutorial testado end-to-end localmente (literalmente rode os comandos)
- [ ] Screenshot em PR

---

## Phase 3: Concepts split de docs.md

**Objective:** 19 concept pages, cada uma é um split focado de uma section do `docs.md`. Pouca escrita nova — principalmente reorganizar + add cross-links.

### T3.1 — Concepts/agent.mdx

#### Objective
Hub conceitual sobre `Agent.create`, `agent.send`, lifecycle, options.

#### Evidence
`docs.md` tem ~400 linhas sobre Agent espalhadas. Concentrar.

#### Files to edit
```
theo-opendocs/content/theokit-sdk/concepts/agent.mdx (NEW)
```

#### Deep file dependency analysis
- Source: grep `^##` em `docs.md` por "Agent"
- Cross-links pra: tools, sessions, streaming, hooks, memory, errors

#### Deep Dives
- Sections:
  1. What is an Agent (1 paragraph)
  2. Lifecycle (create → send → dispose)
  3. AgentOptions reference (link para `reference/Agent`)
  4. LocalAgent vs CloudAgent
  5. Persistence (`agent.resume`)
  6. Common patterns (link cookbook)

#### Tasks
1. Frontmatter `title: Agent | Concepts | TheoKit-SDK`
2. Banner `> Canonical: [docs.md → Agent section](https://github.com/usetheodev/theokit-sdk/blob/main/packages/sdk/docs.md#agent)`
3. Escrever sections (extract de `docs.md`, parafrasear, NUNCA copy/paste literal — diverge)
4. Cross-links

#### TDD
```
RED:     test_concept_agent_has_lifecycle_diagram — busca "create" e "dispose"
RED:     test_concept_agent_canonical_link — busca "docs.md"
GREEN:   Build verde
VERIFY:  grep -E "(create|dispose|docs.md)" content/theokit-sdk/concepts/agent.mdx
```

#### Acceptance Criteria
- [ ] Page renderiza
- [ ] Cross-links para ≥4 outros concepts válidos
- [ ] Banner canonical link presente

#### DoD
- [ ] Renderiza local
- [ ] Cross-links testados (não 404 no dev mode)

---

### T3.2-T3.19 — Demais 18 concepts pages

Padrão idêntico a T3.1. Lista:

| Task | Page | Source canonical (docs.md section) |
|---|---|---|
| T3.2 | tools.mdx | "Tools" + `defineTool` |
| T3.3 | sessions.mdx | "Session", `agent.resume` |
| T3.4 | streaming.mdx | "Streaming", `agent.send().stream()`, `SDKMessage` |
| T3.5 | mcp.mdx | "MCP", `mcpServers`, OAuth |
| T3.6 | hooks.mdx | "Hooks", plugin lifecycle |
| T3.7 | memory.mdx | "Memory", FTS5, vec, embeddings |
| T3.8 | cron.mdx | "Cron", `Cron.create` |
| T3.9 | eval.mdx | "Eval suite" |
| T3.10 | handoffs.mdx | "Agent handoffs" |
| T3.11 | workflows.mdx | "Workflows" |
| T3.12 | cache.mdx | "Semantic cache" |
| T3.13 | gateways.mdx | "Slack gateway" + telegram/discord meta |
| T3.14 | providers-bedrock-vertex.mdx | "Bedrock" + "Vertex" |
| T3.15 | errors.mdx | "Errors", `TheokitAgentError` hierarchy |
| T3.16 | telemetry.mdx | "Telemetry", OTel |
| T3.17 | security.mdx | "Security — secret redaction" + "path traversal" |
| T3.18 | configuration.mdx | "Configuration files" |
| T3.19 | plugins.mdx | "Plugins", `definePlugin` |

**Per-task pattern (idêntico ao T3.1):** Files, deps, deep dive, tasks, TDD, AC, DoD. Each ≤120 lines.

#### TDD (shared)
```
RED:     test_concept_<name>_canonical_link — banner present
RED:     test_concept_<name>_renders — pnpm build verde
GREEN:   18 files created
VERIFY:  cd ../theo-opendocs && pnpm build 2>&1 | grep -c "ERROR"  # 0
```

#### Acceptance Criteria
- [ ] 19 concepts pages (T3.1 + T3.2-T3.19)
- [ ] Cada uma com banner canonical link
- [ ] Build verde
- [ ] Sidebar populado em dev mode

#### DoD
- [ ] All 19 commit em 1 PR (ou batch ≤5 por PR pra revisão saudável)

---

## Phase 4: API Reference (auto-gen TypeDoc → MDX)

**Objective:** Script Node que lê `packages/sdk/dist/index.d.ts`, gera MDX em `reference/` automaticamente.

### T4.1 — TypeDoc setup

#### Objective
Configurar TypeDoc no `packages/sdk` pra emitir JSON consumível.

#### Evidence
Sem TypeDoc setup hoje. Cada feature exporta types em `dist/*.d.ts` mas sem visualização navegável.

#### Files to edit
```
packages/sdk/typedoc.json (NEW)
packages/sdk/package.json — adicionar script `docs:json`
packages/sdk/.gitignore — exclude `docs-json/`
```

#### Deep file dependency analysis
- TypeDoc 0.27+ tem `--json` flag estável
- Output JSON é canonical TypeDoc reflection schema — consumível por qualquer script
- Não toca dist/, só lê

#### Deep Dives
- Config alvo:
  ```json
  {
    "entryPoints": ["src/index.ts", "src/errors.ts", "src/cron.ts"],
    "out": "docs-json",
    "json": "docs-json/api.json",
    "excludePrivate": true,
    "excludeInternal": true,
    "readme": "none"
  }
  ```
- Comando: `pnpm typedoc --options typedoc.json`
- Output: `packages/sdk/docs-json/api.json`

#### Tasks
1. `pnpm add -D typedoc -w` (ou no SDK)
2. Criar `typedoc.json`
3. Add script `"docs:json": "typedoc --options typedoc.json"`
4. Add `docs-json/` to .gitignore
5. Rodar uma vez, confirmar output ≥100 KB

#### TDD
```
RED:     test_typedoc_emits_json — `test -f docs-json/api.json && jq '.children | length' docs-json/api.json | awk '$1 > 30'`
GREEN:   JSON gerado com ≥30 children (cada export top-level vira child)
REFACTOR: None
VERIFY:  pnpm docs:json && test -s docs-json/api.json
```

#### Acceptance Criteria
- [ ] `pnpm docs:json` exit 0
- [ ] `docs-json/api.json` ≥ 100KB
- [ ] JSON contém Agent, Cron, Theokit, Memory, Cache, Workflow, Eval, Handoff (jq verifica)

#### DoD
- [ ] Script funcional commitado
- [ ] CI pode rodar

---

### T4.2 — Generator script: JSON → MDX

#### Objective
Script Node que lê `api.json` e emite 1 MDX por symbol em `theo-opendocs/content/theokit-sdk/reference/`.

#### Evidence
Mastra usa esse pattern. OpenAI Agents Python usa mkdocstrings (mesmo modelo). Sem isso, manutenção manual diverge.

#### Files to edit
```
theo-opendocs/scripts/generate-sdk-reference.ts (NEW)
theo-opendocs/package.json — script "generate:sdk-reference"
```

#### Deep file dependency analysis
- Reads: `../theokit-sdk/packages/sdk/docs-json/api.json`
- Writes: `content/theokit-sdk/reference/{ClassName,FunctionName}.mdx`
- Não depende de outros geradores; standalone

#### Deep Dives
- Algoritmo:
  1. Parse JSON
  2. Para cada `child` com `kind: 128` (class), `kind: 64` (function), `kind: 256` (interface), `kind: 2097152` (type alias):
     a. Gerar MDX:
        ```mdx
        ---
        title: ${name}
        description: ${shortText from JSDoc}
        ---

        # ${name}

        ${longDescription}

        ## Signature

        \`\`\`ts
        ${formatSignature(child)}
        \`\`\`

        ## Parameters

        ${formatParamsTable(child)}

        ## Returns

        ${formatReturns(child)}

        ## Source

        [${file}:${line}](github link)
        ```
  3. Escrever `reference/meta.json` com `pages: ["index", ...sortedSymbols]`
- Tipos: cada export é processado independente; encontrei pattern em Mastra docs gen

#### Tasks
0. **(EC-3 absorbed)** Pre-clean: antes de emitir, deletar `content/theokit-sdk/reference/*.mdx` exceto `index.mdx` e `meta.json`. Generator é fonte única — symbol renomeado/removido não deve deixar órfão. Uso de `fs.rm` recursivo + filter; nada de `rm -rf` cego para preservar `meta.json` placeholder se existir.
1. Criar `generate-sdk-reference.ts`
2. Função `parseTypeDocJson(path): Symbol[]`
3. Função `formatSignature(sym): string` (TS-style)
4. Função `formatParamsTable(sym): string` (Markdown table). **(EC-4 absorbed)** Função interna `escapeJsdocCodeFences(text): string` que substitui ``` em JSDoc por `\`\`\``. Aplicar em qualquer text que vai DENTRO de outro ``` block do template MDX (description, @example body, etc).
5. Função `formatReturns(sym): string`
6. Função `emitMdx(sym, outDir): void`. **(EC-2 absorbed)** Antes de `writeFile`, sanitizar nome do symbol: `const safeName = sym.name.replace(/[\/\\:<>|?*]/g, "-")`. Garante FS-safe em Linux/macOS/Windows e evita filename com `/` quando TypeDoc emite namespace+member (ex: `Theokit.models.list`).
7. Função `emitMeta(symbols, outDir): void` — usa o mesmo `safeName` da step 6.
8. Main: load JSON → step 0 (pre-clean) → emit cada symbol
9. Add npm script `generate:sdk-reference`

#### TDD
```
RED:     test_generator_emits_agent_mdx — após rodar, `content/theokit-sdk/reference/Agent.mdx` existe
RED:     test_generator_emits_meta — meta.json lista todos symbols
RED:     test_generator_idempotent — rodar 2x produz mesmo output (no diff)
RED:     test_generator_signature_format — output contém `Agent.create(options:`
RED:     test_generator_sanitizes_filename (EC-2) — symbol `Theokit.models.list` vira filename `Theokit.models.list.mdx` (sem `/`)
RED:     test_generator_cleans_orphans (EC-3) — pré-existente `reference/OldClass.mdx` é removido se symbol não está mais no JSON
RED:     test_generator_escapes_nested_codefences (EC-4) — JSDoc com ``` resulta em MDX que renderiza (parser não fecha bloco cedo)
GREEN:   Script funcional
REFACTOR: Extrair formatters em modules separados
VERIFY:  pnpm generate:sdk-reference && test -f content/theokit-sdk/reference/Agent.mdx && pnpm build  # MDX parse OK
```

#### Acceptance Criteria
- [ ] Script roda em <5s
- [ ] ≥30 MDX files emitidos (1 por symbol público)
- [ ] meta.json regenerado
- [ ] Idempotent (2 runs = mesmo output)

#### DoD
- [ ] Script commitado em `theo-opendocs/scripts/`
- [ ] Output commitado (reference/ populado)
- [ ] Build verde com nova reference

---

### T4.3 — Linkar reference em concepts pages

#### Objective
Cada concepts/X.mdx referencia o reference/<symbol>.mdx correspondente.

#### Evidence
Sem links, reference vira ilha. Usuário em concepts/agent deve clicar e ir pra reference/Agent.

#### Files to edit
```
content/theokit-sdk/concepts/*.mdx — adicionar links no final
```

#### Deep file dependency analysis
- Depende de T3.* (concepts existirem) e T4.2 (reference existirem)
- Cada concepts page ganha section "API reference"

#### Tasks
1. Para cada concept page, adicionar:
   ```mdx
   ## API reference

   <Cards>
     <Card title="Agent" href="/theokit-sdk/reference/Agent" />
     <Card title="LocalAgent" href="/theokit-sdk/reference/LocalAgent" />
   </Cards>
   ```
2. Verificar URLs no dev mode (sem 404)

#### TDD
```
RED:     test_concept_links_reference — grep "reference/" em cada concept MDX
GREEN:   Links existem e válidos
VERIFY:  for f in content/theokit-sdk/concepts/*.mdx; do grep -q "reference/" $f || echo "MISSING: $f"; done
```

#### Acceptance Criteria
- [ ] 19 concepts pages têm section "API reference"
- [ ] Zero 404 no dev mode (testar com curl ou Cypress smoke)

#### DoD
- [ ] Cross-link adicionado em todas as 19 pages

---

## Phase 5: Cookbook (auto-gen from examples)

**Objective:** Script gera 1 MDX por example em `cookbook/`.

### T5.1 — Generator script: examples → MDX

#### Objective
`generate-sdk-cookbook.ts` reads `theokit-sdk/examples/*/` and emits MDX recipes.

#### Evidence
9 examples shipados (bedrock-bot, cache, eval, handoffs, slack-bot, telegram-pro, vertex-bot, workflows + base) já tem README e código. Escrever cookbook prose à mão duplica e diverge.

#### Files to edit
```
theo-opendocs/scripts/generate-sdk-cookbook.ts (NEW)
theo-opendocs/package.json — script "generate:sdk-cookbook"
```

#### Deep file dependency analysis
- Reads: `../theokit-sdk/examples/*/{README.md,run.ts,src/index.ts,package.json}`
- Writes: `content/theokit-sdk/cookbook/{example-name}.mdx`

#### Deep Dives
- Per example, emit:
  ```mdx
  ---
  title: ${example.name}
  description: ${example.description from README}
  ---

  # ${example.name}

  ${README.md content (full, sans frontmatter)}

  ## Code

  \`\`\`ts title="run.ts"
  ${run.ts content}
  \`\`\`

  ## Run

  \`\`\`bash
  cd examples/${example.name}
  cp .env.example .env  # fill in keys
  pnpm install
  pnpm run run
  \`\`\`

  ## Repository

  [examples/${example.name}](https://github.com/usetheodev/theokit-sdk/tree/main/examples/${example.name})
  ```
- Excluded: telegram-pro (too complex, link only) — flag em meta.json

#### Tasks
1. Criar script
2. Discover examples via `readdir`
3. **(EC-5 absorbed)** Para cada example:
   a. Se `README.md` ausente → `console.warn("[cookbook] skipping ${name}: no README.md")` + continue (não crash).
   b. Determinar main file via fallback chain: `run.ts` → `src/index.ts` → `index.ts`. Se nenhum existir → warn + skip.
   c. Lista de excluded examples (`EXCLUDED = ["telegram-pro"]`) ler de constante no topo do script — telegram-pro é complexo demais pra recipe, vai como link apenas no `cookbook/index.mdx`.
4. Read README + main file (já garantidos existirem pelo step 3)
5. Emit MDX
6. Emit `cookbook/meta.json` (pages list só dos examples processados com sucesso; excluded e skipped não entram)
7. npm script

#### TDD
```
RED:     test_cookbook_emits_for_each_example — para cada example NÃO-excluded e NÃO-skipped, MDX existe
RED:     test_cookbook_includes_code — cada MDX tem ```ts block
RED:     test_cookbook_idempotent — rodar 2x sem diff
RED:     test_cookbook_skips_missing_readme (EC-5a) — example sem README.md gera warning e nenhum MDX, sem crash
RED:     test_cookbook_uses_src_index_fallback (EC-5b) — telegram-pro-like example com `src/index.ts` é encontrado quando `run.ts` ausente
RED:     test_cookbook_respects_excluded_list (EC-5c) — `telegram-pro` NÃO recebe MDX recipe (apenas link no index)
GREEN:   Script funcional
VERIFY:  pnpm generate:sdk-cookbook && ls content/theokit-sdk/cookbook/*.mdx | wc -l  # >=8
```

#### Acceptance Criteria
- [ ] ≥8 recipes (todos os examples exceto telegram-pro que vira link)
- [ ] Cada recipe tem code block + run command
- [ ] meta.json gerado

#### DoD
- [ ] Script commitado
- [ ] Output commitado
- [ ] Build verde

---

## Phase 6: Landing page redesign

### T6.1 — Redesign `content/theokit-sdk/index.mdx`

#### Objective
Hero + 4 Cards (Concepts/Reference/Cookbook/Examples) + Quickstart inline.

#### Evidence
Landing atual lista 6 core primitives — informação técnica. Não vende ação.

#### Files to edit
```
theo-opendocs/content/theokit-sdk/index.mdx — overwrite
```

#### Deep file dependency analysis
- Depende de Phase 2-5 (cards apontam pra páginas que precisam existir)

#### Deep Dives
- Estrutura:
  1. H1: "Build agents in TypeScript"
  2. Sub: 1-frase pitch
  3. Botão CTA: "Quickstart" linkando `/theokit-sdk/getting-started/quickstart`
  4. 4 Cards
  5. Section "What's included" (lista 4-bullet: Agent loop / Tools+MCP / Memory / Gateways)
  6. Section "Why this stack" (1 parágrafo: Apache-2.0 + multi-provider + opt-in cloud + walk-away cost)
  7. Quickstart code block inline (mesmo do quickstart.mdx) — pessoa pode copiar antes de clicar

#### Tasks
1. Backup do index.mdx atual
2. Reescrever com nova estrutura
3. Adicionar `<Cards>` apontando 4 sections
4. Code block inline

#### TDD
```
RED:     test_landing_has_quickstart_cta — busca href="/theokit-sdk/getting-started/quickstart"
RED:     test_landing_has_4_cards — busca 4 ocorrências de `<Card`
GREEN:   File reescrito
VERIFY:  grep -c "<Card" content/theokit-sdk/index.mdx  # >=4
```

#### Acceptance Criteria
- [ ] Landing < 80 linhas
- [ ] 4 cards visuais
- [ ] CTA primário (botão grande)
- [ ] Build verde

#### DoD
- [ ] Screenshot da landing em PR (dev mode)

---

## Phase 7: Search tuning + sidebar polish

### T7.1 — Verificar search funciona

#### Objective
Garantir que Orama indexa todo o conteúdo + busca retorna resultados relevantes.

#### Evidence
Fumadocs ativa Orama by default mas precisa source config — confirmar.

#### Files to edit
```
theo-opendocs/source.config.ts — verificar postprocess includeProcessedMarkdown true
theo-opendocs/app/api/search/route.ts (if needed)
```

#### Tasks
1. Verificar search funcional em dev mode (digitar "agent" no header → resultados)
2. Se não funcionar, adicionar route `/api/search` per Fumadocs docs
3. Validar busca por: "Agent.create", "Workflow", "Bedrock", "MCP"
4. Resultados ≤ 200ms

#### TDD
```
RED:     test_search_returns_agent_results — curl `/api/search?q=agent` retorna ≥5 hits
GREEN:   Search OK
VERIFY:  Manual — digitar "agent" no UI
```

#### Acceptance Criteria
- [ ] Search retorna resultados para os 4 termos test
- [ ] Latência ≤ 200ms

#### DoD
- [ ] Screenshot do search aberto em PR

---

### T7.2 — Sidebar order tuning

#### Objective
Ordem da sidebar reflete jornada do usuário (não alfabético).

#### Tasks
1. Revisar cada meta.json
2. Reordenar `pages` na ordem desejada
3. Garantir que concepts segue: agent → tools → sessions → streaming → mcp → hooks → memory → cron → eval → handoffs → workflows → cache → gateways → providers-bedrock-vertex → errors → telemetry → security → configuration → plugins

#### TDD
```
RED:     test_meta_concepts_first_is_agent — `cat meta.json | jq '.pages[0]' == "agent"`
GREEN:   Ordens reorganizadas
VERIFY:  jq '.pages' content/theokit-sdk/concepts/meta.json
```

#### Acceptance Criteria
- [ ] Sidebar dev mode mostra ordem esperada

#### DoD
- [ ] Sidebar reviewable visualmente

---

## Phase 8: Drift detection CI gate

### T8.1 — Drift check script

#### Objective
Script Node detecta drift entre `docs.md`, `dist/*.d.ts`, e `theo-opendocs/content/theokit-sdk/`.

#### Evidence
Sem gate, garantido divergir em ≤4 semanas (vide histórico).

#### Files to edit
```
packages/sdk/scripts/check-docs-drift.ts (NEW)
packages/sdk/package.json — script "docs:drift"
```

#### Deep file dependency analysis
- Reads: `docs.md`, `dist/index.d.ts`, `../theo-opendocs/content/theokit-sdk/` (filesystem)
- Writes: stdout report + exit code

#### Deep Dives
- Checks:
  1. Cada `^## ` em `docs.md` tem MDX em concepts/ correspondente (slug match)
  2. Cada `export class/function` em `dist/index.d.ts` tem `reference/<name>.mdx`
  3. Cada example em `examples/` tem `cookbook/<example>.mdx`
- Exit codes:
  - 0: sem drift
  - 1: WARNING (drift detected, soft)
  - 2: ERROR (em v1.1 quando virar hard)
- v1: sempre exit 0 ou 1 (warning soft)

#### Tasks
1. Criar script
2. **(EC-6 absorbed)** Implementar check 1 (regex `^## ` em docs.md vs filesystem `concepts/*.mdx`). Manter mapping table inline no topo do script:
   ```ts
   // Maps docs.md section header (lowercased + first-line-only) to concepts/ slug.
   // Edited by hand when new section ships; drift checker rejects unknown sections (forces update).
   const SECTION_TO_SLUG: Record<string, string> = {
     "eval suite": "eval",
     "agent handoffs": "handoffs",
     "workflows": "workflows",
     "semantic cache": "cache",
     "slack gateway": "gateways",
     "bedrock provider": "providers-bedrock-vertex",
     "vertex ai provider": "providers-bedrock-vertex",
     "security — secret redaction": "security",
     "security — path traversal + toctou": "security",
     "built-in tools for coding agents": "tools",
     "configuration files": "configuration",
     "local models — ollama": "providers",
     // ... ≤20 entries total
   };
   ```
   Match heuristic: extrair primeiro segmento antes de `(` ou `—` no header, lowercase, lookup. Section sem mapping → emit warning "unknown docs.md section, add to SECTION_TO_SLUG" (force human review on new ships, evita false-positive drift).
3. Implementar check 2 (parse `dist/index.d.ts` ou usar typedoc JSON)
4. Implementar check 3
5. Report stdout estruturado
6. Adicionar npm script

#### TDD
```
RED:     test_drift_detects_missing_concept — quando deletamos concepts/agent.mdx, script reporta
RED:     test_drift_zero_when_aligned — quando tudo aligned, exit 0
RED:     test_drift_warn_not_fail_in_v1 — exit code 1 (não 2)
RED:     test_drift_section_mapping (EC-6) — docs.md `## Eval suite (v1.15+)` resolve para `concepts/eval.mdx` via SECTION_TO_SLUG; nenhum false positive
RED:     test_drift_unknown_section_emits_review_warning (EC-6) — section em docs.md fora do mapping emite "add to SECTION_TO_SLUG" (não silent ignore nem crash)
GREEN:   Script funcional
VERIFY:  pnpm docs:drift; echo $?
```

#### Acceptance Criteria
- [ ] Script roda em <10s
- [ ] Report estruturado (3 sections: docs.md drift, types drift, examples drift)
- [ ] Exit code correto

#### DoD
- [ ] Script commitado
- [ ] Testes unitários

---

### T8.2 — GitHub Action wire-up

#### Objective
Workflow YAML que roda o drift check em PR.

#### Files to edit
```
.github/workflows/docs-drift.yml (NEW)
```

#### Deep Dives
- Trigger: PR a `main` que toca `packages/sdk/src/**`, `packages/sdk/docs.md`, ou `examples/**`
- Steps:
  1. Checkout `theokit-sdk`
  2. Checkout `theo-opendocs` (via PAT secret ou GITHUB_TOKEN se mesma org)
  3. Setup Node 22
  4. Install pnpm deps
  5. Build SDK (pra ter dist)
  6. Run `pnpm docs:drift`
  7. Comment PR com report se exit 1
- v1: continue-on-error: true (warning soft)

#### Tasks
1. Criar YAML
2. Add secret `THEO_OPENDOCS_PAT` (configurar via gh CLI — fora do escopo do PR; documentar)
3. Test localmente com `act` se possível

#### TDD
```
RED:     test_workflow_yaml_valid — `yamllint .github/workflows/docs-drift.yml`
GREEN:   Workflow válido
VERIFY:  gh workflow view docs-drift
```

#### Acceptance Criteria
- [ ] YAML válido (passa yamllint)
- [ ] Triggers configurados
- [ ] Drift report aparece em PR comment quando há drift

#### DoD
- [ ] Workflow rodando em PR de teste
- [ ] Drift detection observado funcionando (criar PR proposital pra testar)

---

## Phase 9: Deploy + manual dogfood

### T9.1 — Cloudflare Pages deploy

#### Objective
Site no ar em `usetheo.dev/theokit-sdk/` (ou URL atual do Cloudflare).

#### Files to edit
```
(nenhum no SDK; deploy via wrangler já configurado)
```

#### Tasks
1. `cd ../theo-opendocs && pnpm pages:build`
2. `pnpm pages:deploy` (se autorizado)
3. Verificar URL live
4. Smoke navigation: clica em cada section, confirma render

#### TDD
```
RED:     N/A (deploy é manual)
GREEN:   Deploy ok, URL acessível
VERIFY:  curl -I https://usetheo.dev/theokit-sdk/ | grep "200 OK"
```

#### Acceptance Criteria
- [ ] URL retorna 200
- [ ] Landing renderiza
- [ ] Search funciona em produção
- [ ] Code blocks Shiki renderizam

#### DoD
- [ ] URL compartilhada
- [ ] Screenshot da prod

---

### T9.2 — Manual dogfood (navigation checklist)

#### Objective
Pessoa real navega o site cumprindo 8 cenários comuns.

#### Evidence
Build verde + URL no ar não basta. Precisa de smoke real.

#### Files to edit
```
.claude/knowledge-base/reviews/docs-site-dogfood-{YYYY-MM-DD}.md (NEW)
```

#### Tasks
**Cenários:**
1. "Eu nunca usei o SDK, quero entender o que é em 30s" → landing fornece resposta sem rolar
2. "Quero instalar agora" → `Quickstart` ou `Install` button visível no header/landing
3. "Como fazer um agent simples?" → Quickstart resolve em copy-paste
4. "Como funciona MCP no SDK?" → search "mcp" → concepts/mcp em ≤3 cliques
5. "Qual a signature exata de `Agent.create`?" → reference/Agent
6. "Eu uso Bedrock, como configurar?" → providers.mdx + concepts/providers-bedrock-vertex
7. "Tem exemplo de workflows?" → cookbook/workflows
8. "Achei erro na doc, como reportar?" → footer link pra GitHub issue

Para cada cenário: anotar tempo até resolver + frustração.

#### TDD
```
RED:     N/A — humano executa
GREEN:   8/8 cenários completados em <60s cada
VERIFY:  Report manual
```

#### Acceptance Criteria
- [ ] 8/8 cenários PASS
- [ ] Issues encontrados → tasks de follow-up (não bloqueiam plano)

#### DoD
- [ ] Report commitado em `.claude/knowledge-base/reviews/`

---

## Coverage Matrix

| # | Gap / Requirement (do plano) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Build do site existing está verde | T0.1 | Sanity check |
| 2 | Inventário das APIs públicas para baseline | T0.2 | Inventory committed |
| 3 | IA com 4 sections top-level | T1.1 | Tree + meta.json |
| 4 | Onboarding em 5 pages | T2.1-T2.5 | install, quickstart, project-structure, providers, first-agent |
| 5 | 19 concepts cobrindo docs.md | T3.1-T3.19 | 19 MDX pages |
| 6 | Reference auto-gerada da TS public API | T4.1, T4.2, T4.3 | TypeDoc + script |
| 7 | Cookbook auto-gerado dos examples | T5.1 | Script |
| 8 | Landing vende ação não info | T6.1 | Redesign |
| 9 | Busca funcional | T7.1 | Orama tuning |
| 10 | Sidebar ordenado por jornada | T7.2 | meta.json tuning |
| 11 | Drift detection CI gate | T8.1, T8.2 | Script + workflow |
| 12 | Deploy live | T9.1 | Cloudflare Pages |
| 13 | Smoke real de navegação | T9.2 | Dogfood manual |

**Coverage: 13/13 (100%)**

## Global Definition of Done

- [ ] Todas as 9 phases completadas
- [ ] 5 getting-started pages escritas (T2.1-T2.5)
- [ ] 19 concepts pages criadas (T3.1-T3.19)
- [ ] `reference/` ≥30 MDX files auto-gerados (T4.2)
- [ ] `cookbook/` ≥8 recipes (T5.1)
- [ ] Landing redesenhada (T6.1)
- [ ] Search funcional (T7.1)
- [ ] Drift CI gate ativo (T8.1, T8.2)
- [ ] Deploy live confirmado (T9.1)
- [ ] Manual dogfood 8/8 PASS (T9.2)
- [ ] `pnpm build` verde no theo-opendocs
- [ ] Zero broken links no site live
- [ ] `CHANGELOG.md` entry em ambos os repos (theokit-sdk + theo-opendocs)
- [ ] **Dogfood QA PASS** — `/dogfood full` do telegram-pro continua 44/44 (zero regressão; o plano não toca SDK, então é sanity)

## Final Phase: Dogfood QA (MANDATORY)

> Este plano NÃO toca código de runtime do SDK. O dogfood é tanto **sanity** (garantir que nada quebrou) quanto **navigation smoke** (T9.2).

### Execução

1. **SDK sanity:** `/dogfood full` — telegram-pro continua 44/44 PASS. Se quebrar, plano causou regressão acidental (improvável mas valida).
2. **Docs site smoke:** T9.2 (8 navigation scenarios).

### Acceptance Criteria

- [ ] SDK dogfood: 44/44 PASS (ou melhor)
- [ ] Site dogfood: 8/8 cenários PASS
- [ ] Zero CRITICAL ou HIGH issues introduzidos por este plano
- [ ] Search funciona em produção (não só dev)

### If Dogfood Fails

1. SDK dogfood fail = plano introduziu regressão no SDK (não esperado pq não toca SDK). Identificar e reverter.
2. Site dogfood fail = identificar qual cenário falhou → fix → re-rodar.
3. Pre-existing issues documentar (não bloqueia plano).
