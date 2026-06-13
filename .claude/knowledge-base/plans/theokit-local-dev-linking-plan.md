# Plan: TheoKit Local Dev Linking — Resolver Dual-React em Dev Local

> **Version 1.0** — Resolve o problema de dual-React que ocorre quando projetos TheoKit (`theocode`, `theokit`, exemplos) consomem `@theokit/ui` via symlink em desenvolvimento local. Adiciona um script `dev:pack` no theo-ui e documenta o workflow de dev local cross-repo.

## Goal

> "Eliminar o dual-React em dev local entre repos TheoKit, medido por: `npm test` no theocode com `@theokit/ui` local passando sem erro de dual-React, E um workflow documentado que qualquer dev segue em < 2 comandos."

## Context

O ecossistema TheoKit tem 4+ repos sob `theokit-tools/` que nao estao em um pnpm workspace:

```
theokit-tools/
├── theo-ui/          # @theokit/ui — component library (pnpm)
├── theocode/         # TheoCode — AI coding agent (npm)
├── theokit/          # TheoKit framework (pnpm)
├── theokit-sdk/      # @theokit/sdk (pnpm)
└── (sem pnpm-workspace.yaml)
```

Quando o `theocode` (react@19) consome `@theokit/ui` via `npm install ../theo-ui` (symlink), o Node resolve `react` seguindo o symlink ate `theo-ui/node_modules/react@18` (devDep do pnpm) em vez do `react@19` do consumidor. Resultado: dois Reacts no runtime → hooks quebram ("useState null", "Element from older version").

O `@theokit/ui` declara React corretamente como peerDependency (`>=18.2 <20`). O bug nao e no package.json — e no mecanismo de symlink + pnpm strict hoisting.

**Impacto:** todo projeto TheoKit que consome `@theokit/ui` em dev local encontra esse problema. O theocode ja contornou com `file:vendor/theokit-ui-0.14.3.tgz` (tarball manual), mas o workflow e fragil e nao esta documentado.

## Baseline Context (deep review of current state)

### Files que serao tocados

| File | Repo | LoC hoje | Por que existe | Invariantes |
|---|---|---|---|---|
| `theo-ui/package.json` | theo-ui | ~150 | Manifest do @theokit/ui | Preservar peerDeps, scripts existentes |
| `theo-ui/scripts/dev-pack.sh` (NEW) | theo-ui | 0 | Script de pack para dev local | — |
| `theo-ui/CONTRIBUTING.md` ou `README.md` | theo-ui | varies | Docs do projeto | Adicionar secao "Local Development" |
| `theocode/package.json` | theocode | ~80 | Manifest do theocode | Atualizar dep do @theokit/ui |

### Current state

- **theo-ui** usa pnpm@10.32.1, tem `react@^18.3.1` como devDep + `react >=18.2 <20` como peerDep
- **theocode** usa npm, tem `react@^19`, `@theokit/ui: file:vendor/theokit-ui-0.14.3.tgz` (workaround manual)
- **Nenhum workspace** — cada repo instala independentemente
- **theo-ui** ja tem `prepublishOnly` no scripts (roda antes de `npm publish`)

## Prior Art & Related Work

- **pnpm `--pack-gzip-level`** — pnpm pack gera tarball sem incluir node_modules
- **yalc** — ferramenta de terceiros que simula publish local; adiciona dependencia, rejeitado per KISS
- **npm pack** — built-in, zero dependencias, gera `.tgz` que instala como se viesse do registry
- **Turborepo / Nx** — workspace tools que resolvem isso nativamente; overkill para 4 repos independentes
- **Next.js monorepo** — usa pnpm workspace, evita o problema by design

## Objective

- [ ] Script `dev:pack` no theo-ui que faz `pnpm pack` e copia o tarball para um local previsivel
- [ ] Documentacao de workflow: "como consumir @theokit/ui em dev local"
- [ ] theocode usando o workflow documentado (nao mais tarball manual em `vendor/`)

## ADRs

### D1 — `pnpm pack` + `file:` tarball e a solucao, nao workspace

**Decision:** Cada consumidor instala o tarball gerado por `pnpm pack` do theo-ui. Nao criamos um pnpm workspace em `theokit-tools/`.

**Rationale:** Per KISS — os repos tem package managers diferentes (theo-ui usa pnpm, theocode usa npm, theokit usa pnpm). Um workspace forcaria um unico package manager e lockfile. O `pnpm pack` gera um `.tgz` identico ao que o npm registry entregaria — sem symlinks, sem node_modules aninhado, peerDeps resolvidos pelo consumidor. Zero dependencias extras.

**Alternatives considered:**
- **(A) pnpm workspace** — rejeitado: mistura npm + pnpm; forcaria migrar theocode para pnpm ou vice-versa. Acoplamento alto entre repos independentes.
- **(B) yalc** — rejeitado: dependencia de terceiros (Rule 9 — nao reinventar, mas tambem nao adicionar deps desnecessarias quando `pnpm pack` resolve).
- **(C) resolve.dedupe no Vite** — rejeitado: workaround no consumidor, nao na fonte. Cada consumidor teria que configurar. Nao resolveu nos testes do theocode.

**Consequences:** Dev precisa rodar `dev:pack` no theo-ui apos cada mudanca antes de testar no consumidor. Workflow de 2 comandos.

### D2 — Tarball em `dist/` do theo-ui, nao em `vendor/` do consumidor

**Decision:** O tarball fica em `theo-ui/dist/theokit-ui-{version}.tgz`. O consumidor referencia `file:../theo-ui/dist/theokit-ui-{version}.tgz`.

**Rationale:** Per SRP — o produtor (theo-ui) e responsavel por gerar o artefato. O consumidor so aponta para ele. Isso evita copias duplicadas em `vendor/` de cada consumidor. `dist/` ja esta no `.gitignore` do theo-ui.

**Alternatives considered:**
- **(A) `vendor/` no consumidor** — rejeitado: cada consumidor guarda uma copia; fica stale; precisa de update manual.

**Consequences:** O path `file:../theo-ui/dist/theokit-ui-{version}.tgz` assume que os repos estao no mesmo diretorio pai. Isso e verdade hoje (`theokit-tools/`). Se alguem clonar os repos em locais diferentes, precisa ajustar o path.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Dev esquece de rodar `dev:pack` apos mudar o theo-ui | Medium | Documentar no CONTRIBUTING.md; o erro de runtime ("dual-React") e obvio e aponta para o workflow | D1 |
| Path `file:../theo-ui/dist/` assume layout de diretorios | Low | Documentar o prerequisito; 100% dos devs hoje usam `theokit-tools/` como pai | D2 |
| Tarball nao atualiza automaticamente (nao e hot-reload) | Medium | Para hot-reload, usar o dev server do theo-ui (Ladle). O tarball e para testes de integracao, nao para desenvolvimento de componentes | D1 |

## Unresolved Questions

(none — a solucao e direta: `pnpm pack` + `file:` tarball.)

## Dependency Graph

```
Phase 1 (theo-ui: dev:pack script) ──▶ Phase 2 (theocode: usar o workflow) ──▶ Phase 3 (docs)
```

---

## Phase 1: Script `dev:pack` no theo-ui

**Objective:** Adicionar um script que gera o tarball pronto para consumo local.

### T1.1 — Criar `dev:pack` script

#### Objective
Script que roda `pnpm pack`, move o tarball para `dist/`, e imprime o path para o consumidor usar.

#### Why this step
1. **What:** Adicionar `"dev:pack"` ao `package.json` do theo-ui que executa `pnpm build && pnpm pack --pack-destination dist/`.
2. **Why now:** Sem esse script, cada dev improvisa o workflow (uns fazem `npm pack`, outros `npm link`, outros copiam para `vendor/`). Padronizar.

#### Files to edit
```
theo-ui/package.json — adicionar script "dev:pack"
```

#### Deep Dives

O script deve:
1. Buildar o projeto (`pnpm build`) — garante que `dist/` tem os arquivos compilados
2. Rodar `pnpm pack --pack-destination dist/` — gera `dist/theokit-ui-{version}.tgz`
3. Imprimir o caminho do tarball para copiar no `package.json` do consumidor

#### Pseudo-code

```json
{
  "scripts": {
    "dev:pack": "pnpm build && pnpm pack --pack-destination dist/ && echo '\nTarball ready. In consumer project, run:\nnpm install file:../theo-ui/dist/theokit-ui-'$(node -p \"require('./package.json').version\")'.tgz'"
  }
}
```

#### TDD
```
RED:     Rodar `pnpm dev:pack` no theo-ui antes de adicionar o script → comando nao existe
GREEN:   Adicionar o script → gera tarball em dist/
VERIFY:  ls dist/theokit-ui-*.tgz existe apos rodar
```

#### Acceptance Criteria
- [ ] Run `pnpm dev:pack` no theo-ui e confirmar que `dist/theokit-ui-0.14.3.tgz` existe
- [ ] Confirmar que o tarball NAO contem `node_modules/react` (o ponto central)

#### DoD
- [ ] Script funciona e gera tarball
- [ ] Tarball nao contem dependencias aninhadas

---

## Phase 2: TheoCode usar o workflow correto

**Objective:** Remover o workaround manual (`vendor/`) do theocode e usar o path padronizado.

### T2.1 — Atualizar theocode para usar `file:../theo-ui/dist/`

#### Objective
Trocar `file:vendor/theokit-ui-0.14.3.tgz` por `file:../theo-ui/dist/theokit-ui-0.14.3.tgz` e deletar `vendor/`.

#### Why this step
1. **What:** Atualizar o `package.json` do theocode e reinstalar.
2. **Why now:** O workaround atual (copia manual em `vendor/`) e fragil — fica stale, ocupa espaco no git, nao e documentado.

#### Files to edit
```
theocode/package.json — trocar path do @theokit/ui
theocode/vendor/ — deletar diretorio
```

#### TDD
```
RED:     theocode com vendor/theokit-ui-0.14.3.tgz → funciona mas e workaround
GREEN:   theocode com file:../theo-ui/dist/theokit-ui-0.14.3.tgz → funciona igualmente
VERIFY:  npm test no theocode sem erro de dual-React
```

#### Acceptance Criteria
- [ ] `theocode/package.json` referencia `file:../theo-ui/dist/theokit-ui-*.tgz`
- [ ] `theocode/vendor/` nao existe mais
- [ ] `npm test` no theocode passa sem dual-React

#### DoD
- [ ] Testes passando no theocode

---

## Phase 3: Documentacao

**Objective:** Documentar o workflow para que qualquer dev saiba como consumir @theokit/ui em dev local.

### T3.1 — Documentar no theo-ui

#### Objective
Adicionar secao "Local Development (cross-repo)" no README ou CONTRIBUTING do theo-ui.

#### Files to edit
```
theo-ui/README.md ou theo-ui/CONTRIBUTING.md
```

#### Content

```markdown
## Local Development (cross-repo)

When developing a project that consumes `@theokit/ui` locally (e.g., TheoCode, TheoKit):

### Why not `npm link`?

`npm link` creates a symlink that exposes theo-ui's own `node_modules/react@18`,
causing dual-React errors in the consumer project. This is a known Node.js
limitation with symlinks + pnpm strict hoisting.

### Workflow

1. In theo-ui, generate the tarball:
   ```bash
   cd theo-ui
   pnpm dev:pack
   ```

2. In the consumer project, install the tarball:
   ```bash
   cd ../theocode
   npm install file:../theo-ui/dist/theokit-ui-0.14.3.tgz
   ```

3. After changing theo-ui components, re-run step 1 + 2.

### Prerequisites

Both repos must be under the same parent directory (e.g., `theokit-tools/`).
```

#### Acceptance Criteria
- [ ] Documentacao existe e menciona o motivo (dual-React)
- [ ] Workflow de 2 comandos esta claro

#### DoD
- [ ] Docs escritas

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Script `dev:pack` no theo-ui | T1.1 | `pnpm build && pnpm pack --pack-destination dist/` |
| 2 | theocode sem workaround manual | T2.1 | `file:../theo-ui/dist/` em vez de `vendor/` |
| 3 | Documentacao do workflow | T3.1 | README/CONTRIBUTING com explicacao + 2 comandos |
| 4 | Tarball sem dual-React | T1.1 | `pnpm pack` nao inclui node_modules |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] `pnpm dev:pack` no theo-ui gera tarball funcional
- [ ] theocode instala via `file:../theo-ui/dist/` sem dual-React
- [ ] Workflow documentado em 2 comandos
- [ ] Nenhum `vendor/*.tgz` commitado no theocode
