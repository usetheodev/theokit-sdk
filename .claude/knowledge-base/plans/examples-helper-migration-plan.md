# Plan: Examples Helper Migration (39 examples → 4 DX helpers)

> **STATUS: COMPLETO + Phase 6 adicionada — 7 phases concluídas. 39/39 examples typecheck verde + 26/29 standalone real-LLM examples passados + 10/10 fixture-mode validated per inviolable rule. Descobriu + corrigiu bug crítico durante real-LLM sweep: SDK dist tinha top-level `import "zod"` quebrando todos os examples sem zod dep. Fix: `createRequire` lazy sync load em define-tool.ts. SDK tests 6/6 verde, defineTool semantics inalteradas. 1 fail (telegram-bot) é token conflict ambiental; 2 skipped (mcp-http, plugins-walkthrough) pendem .env do usuário.**

> **Version 1.0** — Pass de revisão completa nos 39 examples do `@usetheo/sdk` após o release dos 4 DX helpers (`Agent.getOrCreate`, `createAgentFactory`, `defineTool`, `Agent.builder()`). Objetivo: garantir que (1) zero regressão de typecheck pós-rebuild SDK; (2) examples com `as` cast em custom tools migram para `defineTool`; (3) dogfood scripts internos migram para `getOrCreate`; (4) examples didáticos de showcase ganham variante helper (sem destruir o pattern original que ensina o feature base). Outcome: 39/39 examples typecheck clean, ~6 examples com migração concreta, ~3 com variante didática adicionada, e o README index aponta qual helper cada example demonstra quando aplicável.

## Context

**Triage do estado atual (gerado por survey-script):**

| Categoria | Count | Examples |
|---|---|---|
| **Já migrados (do plano anterior)** | 6 | telegram-pro, telegram-bot, resume-agent, agent-management, error-handling, error-handling-full |
| **`as-cast` em custom tools (defineTool candidato)** | 2 | shell-tool, hooks-policy |
| **`try/catch-resume` ainda pendente (getOrCreate candidato)** | 2 | telegram-bot/src/dogfood.ts, telegram-bot/src/dogfood-restart.ts |
| **"Plain Agent.create" (single-feature demos)** | 29 | active-memory, active-memory-query-modes, cloud-agent, cloud-await-using, cloud-prerelease-guard, cloud-with-mcp-http, cloud-with-skills, cloud-with-subagents, context-manager, cron-schedule, embedding-providers, local-force-expire, mcp-http, mcp-stdio, memory, memory-dreaming, memory-get, memory-search, one-shot-prompt, plugins-walkthrough, provider-fallback, provider-inspector, quickstart, remember-prefix, run-lifecycle, send-mcp-override, send-overrides, skills, streaming-callbacks, subagents, theokit-catalog |

**Por que o trabalho vale:**

- Após o release dos helpers (commit do plano anterior), o `dist` do SDK ganhou 4 novos symbols (`getOrCreate`, `AgentBuilder`, `createAgentFactory`, `defineTool`). Cada example tem seu próprio `node_modules/@usetheo/sdk` link que precisa refresh — typecheck pode falhar silenciosamente em CI até que cada example reinstale.
- Os 2 dogfood scripts do `telegram-bot/src/dogfood*.ts` ainda usam o try/catch antigo — não são examples didáticos publicados, são test scripts internos, e mantê-los inconsistentes confunde quem clona o repo.
- `shell-tool` e `hooks-policy` têm `as` cast em definições de tool — mesmo padrão que `ad-hoc-tools.ts` tinha antes da migração. Removendo o cast ganhamos type-safety + Zod runtime validation grátis.
- Os 29 examples "plain" são propositalmente single-feature (foco didático). Migrar tudo para builder/factory **obscurece** o que eles ensinam. EXCEÇÃO: o `quickstart` é a primeira impressão — adicionar uma seção "...e você pode escrever isso assim com Agent.builder()" gera 80% do valor pedagógico dos helpers para 0% de churn nos outros.

**Riscos identificados (não-especulativos):**

- Os 39 examples têm `package.json` com dep `"@usetheo/sdk": "file:../../packages/sdk"`. pnpm symlinks o dist; se o symlink não atualizar após rebuild SDK, o tsc enxerga API antiga e falha. Confirmado durante a migração do telegram-pro: o `pnpm install --ignore-workspace` foi necessário para refrescar.
- Examples com Zod opt-in: hoje só telegram-pro tem zod como dep direta. Se algum example "plain" começar a usar `defineTool`, precisa do mesmo dep.

**Referências:**

- Plano predecessor: `.claude/knowledge-base/plans/agent-construction-dx-helpers-plan.md` (STATUS: COMPLETO)
- ADRs D22-D26 (helpers semantics)
- Triage commit: HEAD (após validate exit=0 do plano anterior)

## Objective

**Done = 39/39 examples passam `npx tsc --noEmit` sem erro contra o SDK rebuildado, 2 dogfood scripts migrados para `getOrCreate`, 2 custom-tool examples migrados para `defineTool`, e o `quickstart` ganha uma seção alternativa com `Agent.builder()` para descobribilidade.**

Metas mensuráveis:

1. **Typecheck-sweep:** 39/39 examples typecheck clean após rebuild SDK + refresh do node_modules link. Zero erros.
2. **Force-migrate (4 arquivos):**
   - `examples/telegram-bot/src/dogfood.ts` — try/catch → `Agent.getOrCreate`
   - `examples/telegram-bot/src/dogfood-restart.ts` — try/catch → `Agent.getOrCreate`
   - `examples/shell-tool/src/index.ts` — custom tool com `as` cast → `defineTool`
   - `examples/hooks-policy/src/index.ts` — custom tool com `as` cast → `defineTool`
3. **Quickstart helper-showcase:** adiciona seção "(alternative) Agent.builder()" no `quickstart/src/index.ts` + README, sem remover a versão options-bag original.
4. **README index:** `examples/README.md` (ou criar se não existir) lista os 39 examples em tabela com colunas `Example | Demonstrates | Helper used (if any)`.
5. **Zero regressão dogfood:** rebuild SDK + telegram-pro continua funcionando 100% (CDP test bate `/tool uuid`, `current_time`, hash sha256).

## ADRs

### D27 — Migration scope para examples didáticos

- **Decisão**: Examples **single-feature** (active-memory, mcp-stdio, cron-schedule, etc.) **NÃO migram** para os 4 helpers. Mantêm o `Agent.create({...})` literal porque o ponto deles é mostrar UM feature isoladamente, e o builder/factory **adiciona** ruído conceitual onde não há boilerplate real para eliminar. Examples com **boilerplate visível** (try/catch resume, `as` cast em tools, configs repetidas em múltiplas chamadas) migram.
- **Rationale**: Examples são pedagógicos. O `quickstart` precisa ensinar `Agent.create()` antes de `Agent.builder()` — ordem importa. Forçar todos os 39 a usar helpers seria como reescrever um livro de Python para que o primeiro capítulo já use decorators.
- **Consequências**: Examples "puros" continuam fáceis de seguir linha-a-linha. Examples com boilerplate ganham clareza. O README index e o `quickstart` direcionam quem quer os helpers para os 6 examples já migrados + as 4 force-migrations deste plano.

### D28 — Typecheck-sweep mechanism: per-example install + tsc

- **Decisão**: Para detectar regressão pós-rebuild do SDK, o sweep faz, por example: `pnpm install --ignore-workspace` (refresh symlink) → `npx tsc --noEmit` → captura exit code. Falhas são logadas e o sweep continua até o fim — não para no primeiro fail. Script auxiliar em `tools/typecheck-examples.sh`.
- **Rationale**: Cada example tem seu próprio `pnpm-lock.yaml` e `node_modules`. pnpm com `file:` link copia o dist no install — sem reinstall, o example vê o SDK antigo. Já confirmamos durante a migração do telegram-pro que o `pnpm install --ignore-workspace` é o gesto certo. Continuar até o fim (em vez de fail-fast) dá uma matriz completa de quem quebrou.
- **Consequências**: O sweep leva ~5-10 min wall-clock dependendo da paralelização (pnpm install é I/O bound). Vale o custo: detectar 1 example quebrado pós-rebuild evita CI red 24h depois.

### D29 — defineTool migration: só onde há `as` cast

- **Decisão**: Examples que usam `CustomTool` literal com `inputSchema: { type: "object", properties: {...} }` E handler com `as XxxInput` cast migram para `defineTool` + Zod. Examples que apenas declaram custom tools sem cast (handler aceita `Record<string, unknown>` sem reinterpretar) NÃO migram — o cost-benefit é pequeno e o `CustomTool` literal continua sendo uma API pública válida (não está deprecada).
- **Rationale**: O ganho real do `defineTool` é eliminar `as` casts inseguros. Onde não há cast, defineTool só adiciona uma dep Zod sem ganho de safety mensurável.
- **Consequências**: Triagem fácil — `grep -lE "as [A-Z][a-zA-Z]+Input|as Record"`. Em 2 examples (shell-tool, hooks-policy) o cast existe; resto fica.

### D30 — Quickstart como única "showcase" obrigatória

- **Decisão**: O `quickstart` é o único example que GANHA explicitamente uma seção alternativa com `Agent.builder()` lado a lado com `Agent.create()`. Não mexer no `streaming-callbacks`, `subagents`, `memory`, etc. — eles já são focados em UM tópico e quem aterrissa neles veio buscando aquele tópico, não DX helpers.
- **Rationale**: `quickstart` é o primeiro contato. Mostrar duas formas de fazer a mesma coisa no entry point ensina os patterns alternativos sem custar legibilidade. Em qualquer outro example, mostrar "também há essa outra forma" dilui o ponto.
- **Consequências**: Exatamente 1 example dual-pattern. Discovery dos helpers para usuários novos: README index → quickstart → 6 migrated examples.

### D31 — Cross-validation por typecheck + boot smoke; sem teste unitário por example

- **Decisão**: Examples não ganham suite de testes própria. Validation = `npx tsc --noEmit` + `pnpm dev` boot (até primeira linha de log ou first `await`). O dogfood real-LLM continua sendo no `telegram-pro` apenas. Justificativa: 39 examples × testes seria 200+ testes ad-hoc com baixo ROI; o SDK tem 331 golden tests que cobrem o comportamento real, examples são wrappers.
- **Rationale**: ROI de testes per-example é baixíssimo (cada example já é, ele próprio, um teste manual). Typecheck + boot pegam 95% dos bugs sem o custo.
- **Consequências**: Examples que dependem de chaves API externas (telegram-bot, etc.) não bootam sem .env real — esses são marcados como "boot-skip" no script de validação e validados via typecheck apenas. Examples puramente fixture (theo_test_*) bootam.

## Dependency Graph

```
Phase 0 (Triage script) ──▶ Phase 1 (Typecheck-sweep)
                                  │
                                  ▼
                            Phase 2 (Force-migrate 4 files)
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
            T2.1 dogfood*   T2.2 shell-tool   T2.3 hooks-policy
                  │               │               │
                  └───────────────┼───────────────┘
                                  ▼
                            Phase 3 (Quickstart showcase)
                                  │
                                  ▼
                            Phase 4 (README index)
                                  │
                                  ▼
                            Phase 5 (Cross-validation + Dogfood)
```

**Sequenciamento:**
- Phase 0 produz o script + executa o triage (já temos os dados via Bash; o script formaliza para CI).
- Phase 1 (typecheck-sweep) é INDEPENDENT do código de migração — pode rodar antes para baseline.
- Phase 2.1, 2.2, 2.3 são paralelizáveis (arquivos diferentes).
- Phase 3 só depende de Phase 2 estar verde (quickstart compete por mind-share com o conteúdo dos helpers, então roda DEPOIS dos helpers estarem bem documentados via migration commits).
- Phase 4 (README) consolida apontamentos para todos os examples — depende de Phase 2+3.
- Phase 5 é gate final.

---

## Phase 0: Triage formalizado em script

**Objective:** Cristalizar o survey ad-hoc num script reutilizável, executar uma vez e snapshotar resultado em `.claude/knowledge-base/reviews/examples-triage-{date}.md`. Garante que próximas sessões enxerguem o que era estado-em-Maio sem re-rodar bash inline.

### T0.1 — Criar `tools/triage-examples.sh`

#### Objective
Script que itera `examples/*/src/**/*.ts`, classifica cada example em `helpers-used | try/catch-resume | as-cast | inline-schema | plain` e emite tabela markdown.

#### Evidence
A triage Bash ad-hoc usada hoje funciona mas só roda quando alguém pede. Tornando-a script: (1) próxima sessão re-roda em 5 segundos; (2) CI pode rodar e bloquear se um example novo introduzir cast/try-catch sem o helper relevante.

#### Files to edit
```
tools/triage-examples.sh — (NEW) bash script que emite tabela markdown
.claude/knowledge-base/reviews/examples-triage-2026-05-17.md — (NEW) snapshot resultado
```

#### Deep file dependency analysis
- `tools/triage-examples.sh` é leaf — só usa `bash`, `find`, `grep`, `printf`. Sem deps externas.
- O snapshot markdown é referência humana — outras sessões consultam para entender quem é candidato a quê.

#### Deep Dives
Pseudo-script:
```bash
#!/usr/bin/env bash
# Categorize each examples/* by patterns relevant to the DX helpers.
# Output: GitHub-flavored markdown table.

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
{
  echo "| Example | Category |"
  echo "|---|---|"
  for ex in examples/*/; do
    ex_name=$(basename "$ex")
    files=$(find "$ex/src" -name "*.ts" -not -path "*/node_modules/*" 2>/dev/null)
    [ -z "$files" ] && continue
    cats=()
    grep -lE "Agent\.builder|createAgentFactory|defineTool|getOrCreate" $files > /dev/null 2>&1 && cats+=("✅ helpers-used")
    grep -lE "UnknownAgentError" $files > /dev/null 2>&1 && cats+=("⚠️ try/catch-resume")
    grep -lE "as [A-Z][a-zA-Z]+Input|as Record<string, unknown>" $files > /dev/null 2>&1 && cats+=("⚠️ as-cast")
    grep -lE "tools:\s*\[" $files > /dev/null 2>&1 && cats+=("custom-tools")
    [ ${#cats[@]} -eq 0 ] && cats=("plain")
    printf "| %s | %s |\n" "$ex_name" "$(IFS=', '; echo "${cats[*]}")"
  done
} > .claude/knowledge-base/reviews/examples-triage-$(date +%Y-%m-%d).md
```

#### Tasks
1. Escrever `tools/triage-examples.sh`
2. `chmod +x tools/triage-examples.sh`
3. Rodar 1x para gerar o snapshot
4. Verificar resultado bate com a triage Bash ad-hoc que já temos

#### TDD
```
N/A — script de relatório. Validação = rodar e comparar com triage ad-hoc da Phase 0 deste plano (8 categorias devem bater).
```

#### Acceptance Criteria
- [ ] `tools/triage-examples.sh` existe e é executável
- [ ] Snapshot em `.claude/knowledge-base/reviews/examples-triage-{date}.md`
- [ ] Snapshot lista 39 examples (3 sem .ts em src/ aparecem como skip)
- [ ] Resultado bate com triage Bash inline desta sessão (helpers-used ≥ 3, as-cast = 2, try/catch-resume = 1)

#### DoD
- [ ] T0.1 completo
- [ ] Snapshot commitado

---

## Phase 1: Typecheck-sweep dos 39 examples

**Objective:** Detectar regressão pós-rebuild SDK. Cada example reinstala o symlink + typecheck. Falhas logadas mas o sweep continua.

### T1.1 — Criar `tools/typecheck-examples.sh`

#### Objective
Script que: para cada `examples/*/`, roda `pnpm install --ignore-workspace --silent` + `npx tsc --noEmit`, captura exit code, emite tabela de status.

#### Evidence
Durante a migração do telegram-pro precisamos rodar `pnpm install --ignore-workspace` manualmente para o symlink atualizar. Sem sweep automatizado, próxima rebuild do SDK pode quebrar examples silenciosamente até alguém clonar o repo e dar `pnpm dev`.

#### Files to edit
```
tools/typecheck-examples.sh — (NEW) sweep script
.claude/knowledge-base/reviews/examples-typecheck-2026-05-17.md — (NEW) snapshot resultado
```

#### Deep file dependency analysis
- `tools/typecheck-examples.sh` chama `pnpm` + `npx tsc`. Cada example precisa ter seu próprio `package.json` (todos têm) e `tsconfig.json` (verificar quais não têm — eles são skip).
- O sweep NÃO modifica nenhum example — read-only.

#### Deep Dives
Pseudo-script (após edge-case review — incorpora EC-1 lock refresh + EC-2 tsc-vs-boot separation):
```bash
#!/usr/bin/env bash
set -uo pipefail
. ~/.nvm/nvm.sh 2>/dev/null; nvm use 22 > /dev/null 2>&1
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

pass=0; fail=0; skip=0
results=()
for ex in examples/*/; do
  name=$(basename "$ex")
  if [ ! -f "$ex/tsconfig.json" ]; then
    results+=("⏭️ $name (no tsconfig)"); ((skip++)); continue
  fi
  # EC-1: --no-frozen-lockfile força pnpm a re-resolver o file: link contra
  # o dist atualizado. Sem isso, examples com pnpm-lock.yaml antigo veem
  # API antiga do SDK e o tsc falha com falso positivo de regressão.
  (cd "$ex" && pnpm install --ignore-workspace --no-frozen-lockfile --silent > /dev/null 2>&1)
  install_rc=$?
  if [ "$install_rc" -ne 0 ]; then
    results+=("❌ $name — install failed (rc=$install_rc)"); ((fail++)); continue
  fi
  # EC-2: SOMENTE typecheck. Boot smoke é separado (examples com env-real
  # required cairiam aqui sem motivo). Quem quiser boot smoke roda à parte.
  (cd "$ex" && npx tsc --noEmit > /tmp/tc-$name.log 2>&1)
  if [ $? -eq 0 ]; then
    results+=("✅ $name"); ((pass++))
  else
    # Classificar tipo de erro: tsc emite "error TS<num>:"; runtime/env
    # errors típicos não aparecem no tsc. Marcar para a triagem T1.2.
    if grep -q "error TS" /tmp/tc-$name.log 2>/dev/null; then
      results+=("❌ $name (tsc-error) — see /tmp/tc-$name.log"); ((fail++))
    else
      results+=("⚠️  $name (other-error) — see /tmp/tc-$name.log"); ((fail++))
    fi
  fi
done
echo "Pass=$pass Fail=$fail Skip=$skip"
printf "%s\n" "${results[@]}"
```

Invariantes:
- Cada example mantém seu state inalterado (sem mutação de src/).
- node_modules pode crescer durante o sweep — aceitar.
- Exit code do script = 1 se `fail > 0`.

Edge cases:
- Example sem `tsconfig.json` → skip (alguns examples são puramente runtime, sem TS strict).
- pnpm install falha (network, etc.) → contar como fail.
- tsc exit > 0 → fail com log preservado em /tmp.

#### Tasks
1. Escrever `tools/typecheck-examples.sh` com flag `--no-frozen-lockfile` (EC-1)
2. `chmod +x`
3. Rodar baseline + capturar snapshot
4. Verificar classificação tsc-error vs other-error está funcionando (EC-2)

#### TDD
```
N/A — script. Validação:
- pass+fail+skip = 39
- Snapshot diferencia "❌ tsc-error" de "⚠️ other-error" (EC-2)
- Se a baseline tem fails, listar em snapshot E NÃO bloquear progresso do plano (Phase 2 corrige).
- Rodar sweep 2x consecutivas: pass count idêntico (idempotência confirma que --no-frozen-lockfile funciona)
```

#### Acceptance Criteria
- [ ] Script existe e é executável
- [ ] Script usa `--no-frozen-lockfile` (EC-1)
- [ ] Snapshot diferencia ❌ tsc-error vs ⚠️ other-error (EC-2)
- [ ] Baseline snapshot gerado
- [ ] Pass+fail+skip = 39
- [ ] Script exit code reflete fail count (>0 se algum falhou)
- [ ] Re-rodar 2x → mesmos números (idempotência)

#### DoD
- [ ] T1.1 completo
- [ ] Snapshot commitado

### T1.2 — Triagem dos fails (se houver)

#### Objective
Se o baseline da T1.1 mostrar fails, criar entries explícitos em `.claude/knowledge-base/reviews/examples-typecheck-fails.md` com o erro, causa raiz hipotética, e plano de fix.

#### Evidence
Sem essa triagem, fails do baseline poderiam se misturar com regressões introduzidas pelas Phases 2/3. Snapshot-de-falhas dá baseline limpa.

#### Files to edit
```
.claude/knowledge-base/reviews/examples-typecheck-fails.md — (NEW se houver fails) lista de fails com causa-raiz e fix
```

#### Deep file dependency analysis
- Só consulta os logs em `/tmp/tc-*.log` gerados pela T1.1.

#### Deep Dives
Para cada fail: copiar primeiras 5-10 linhas do log + classificar como:
- **stale-symlink** → fix = re-`pnpm install --ignore-workspace`
- **API mismatch** → fix = atualizar example para nova API (subtask em Phase 2 estendida)
- **example-bug pré-existente** → fix = corrigir bug no example (escopo este plano)

#### Tasks
1. Ler `/tmp/tc-*.log` para cada fail
2. Classificar
3. Escrever snapshot

#### TDD
```
N/A — relatório.
```

#### Acceptance Criteria
- [ ] Se T1.1 reportou 0 fails: este task é SKIPPED (snapshot vazio em vez)
- [ ] Se T1.1 reportou ≥1 fail: cada fail tem entry com causa-raiz + fix
- [ ] Examples com fix planejado ganham task explícito em Phase 2

#### DoD
- [ ] T1.2 completo OU skipped por baseline limpa

---

## Phase 2: Force-migrate (4 arquivos com DX win claro)

> **STATUS: SKIPPED — inspeção deep confirmou que os 4 candidatos do triage são falsos-positivos. Codebase já limpo após plano predecessor.**
>
> **Decisões registradas:**
> - **T2.1** (telegram-bot/dogfood\*.ts): scripts são testes INTENCIONAIS de `Agent.create` vs `Agent.resume` separadamente. `dogfood-restart.ts` ESPERA `UnknownAgentError` como regression check ("restart-proofing broken"). Migrar para `getOrCreate` MASCARARIA o teste. Per D27, não migram.
> - **T2.2** (shell-tool/src/index.ts): `as` casts são em `event.args as Record<string, unknown>` (display de streaming events), NÃO em tool definitions. Per D29, defineTool não se aplica.
> - **T2.3** (hooks-policy/src/index.ts): mesmo caso de T2.2 — cast em event.args display.
>
> **Verificação inversa:** `grep -rn "as [A-Z][a-zA-Z]*Input"` em todos os examples retorna ZERO matches. Após a migração do telegram-pro no plano predecessor, não há mais `as XxxInput` casts em tool definitions no codebase.

**Objective:** Migrar os 4 arquivos onde a migração elimina código real (não é cosmética).

### T2.1 — Migrar `telegram-bot/src/dogfood.ts` + `dogfood-restart.ts` para `Agent.getOrCreate`

#### Objective
Substituir o try/catch + cold-create pattern em ambos os scripts dogfood pelo `Agent.getOrCreate` (1 call em vez de ~15 LoC).

#### Evidence
- `dogfood.ts` e `dogfood-restart.ts` são scripts manuais de teste do telegram-bot. Eles repetem o pattern try/catch que o `index.ts` já migrou.
- Inconsistência interna: o entry point bot já usa `getOrCreate`, os dogfood scripts usam o pattern antigo. Quem clona e roda os dogfoods aprende o pattern errado.

#### Files to edit
```
examples/telegram-bot/src/dogfood.ts — substituir try/catch por Agent.getOrCreate
examples/telegram-bot/src/dogfood-restart.ts — idem
```

#### Deep file dependency analysis
- Ambos os scripts são standalone (chamados via `pnpm exec tsx src/dogfood.ts`). Não exportam nada para o `index.ts`.
- `index.ts` não muda.

#### Deep Dives
Pattern de substituição: localizar o bloco try/catch que tenta `Agent.resume(agentId)` e fall through para `Agent.create`. Trocar por:

```ts
const agent = await Agent.getOrCreate(agentId, {
  apiKey: process.env.THEOKIT_API_KEY,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  // ... mesma config que estava no Agent.create
});
```

Invariantes:
- Mesmo `agentId` antes e depois.
- Mesma config no path de create — `getOrCreate` reutiliza no resume + create.

#### Tasks
1. Ler ambos os arquivos
2. Identificar o bloco try/catch em cada
3. Substituir por `Agent.getOrCreate`
4. Remover import de `UnknownAgentError` se ficar órfão
5. Typecheck

#### TDD
```
RED:     not applicable (manual scripts, no test harness). Validation:
GREEN:   npx tsc --noEmit em examples/telegram-bot retorna 0
REFACTOR: None expected
VERIFY:  grep -c "UnknownAgentError" src/dogfood*.ts retorna 0 OR só em comentário
```

#### Acceptance Criteria
- [ ] `dogfood.ts` usa `Agent.getOrCreate`
- [ ] `dogfood-restart.ts` usa `Agent.getOrCreate`
- [ ] Imports sem órfãos
- [ ] `npx tsc --noEmit` na pasta telegram-bot retorna 0

#### DoD
- [ ] T2.1 completo

### T2.2 — Migrar `shell-tool/src/index.ts` para `defineTool` (se aplicável)

#### Objective
Se o example define custom tools com `as` cast, substituir por `defineTool` + Zod schema. Se o cast é em outro context (não tool definition), DOCUMENTAR no plan resolução e skip.

#### Evidence
- Triage mostrou `shell-tool` com `as-cast` em `src/index.ts`. Sem ler ainda não sabemos se é cast em tool definition ou em outra coisa.

#### Files to edit
```
examples/shell-tool/src/index.ts — migrar custom tool com cast para defineTool (se aplicável)
examples/shell-tool/package.json — adicionar zod ^4.0.0 dep se migração ocorrer
```

#### Deep file dependency analysis
- Standalone example. Mudança fica contida no `index.ts`.
- Se zod for adicionado como dep, o `pnpm install --ignore-workspace` precisa rodar antes do typecheck.

#### Deep Dives
Decisão branch:
1. **Se o cast É em tool definition**: importar `defineTool` + `z`, substituir `inputSchema: { type: "object", ... }` por schema Zod, remover cast no handler.
2. **Se o cast NÃO é em tool definition** (e.g., cast em parsing de stdout do shell): registrar em comentário do task, deixar como está, mas considerar `as unknown as Foo` se for type-coercion legítimo.

Invariantes:
- O comportamento do example não muda — só a forma de declarar o tool muda.
- Zod schema produz JSON Schema equivalente ao literal anterior.

Edge cases:
- Schema com `enum` literal → `z.enum([...])` 1:1.
- Schema com `description` em propriedade → `z.string().describe("...")` 1:1.
- Handler que faz validação manual (e.g., `if (typeof x === "string")`) — Zod parse já garante; remover validações redundantes.

#### Tasks
1. Ler `examples/shell-tool/src/index.ts`
2. Decidir branch (tool-cast vs other-cast)
3. Aplicar migração se aplicável
4. Adicionar zod ao package.json se migrou
5. `pnpm install --ignore-workspace`
6. Typecheck

#### TDD
```
GREEN:   tsc --noEmit retorna 0
VERIFY:  grep -c "as [A-Z]" src/index.ts retorna 0 (se cast era em tool def) OU comentário no plano explica por que outro cast permanece
```

#### Acceptance Criteria
- [ ] Decisão (migra/não migra) documentada no commit message
- [ ] Se migrou: `defineTool` + `z` em uso; zero `as` cast em tool definition
- [ ] Typecheck verde
- [ ] Se NÃO migrou: razão explícita em comentário no código

#### DoD
- [ ] T2.2 completo

### T2.3 — Migrar `hooks-policy/src/index.ts` para `defineTool` (se aplicável)

#### Objective
Mesma análise/decisão que T2.2 mas para `hooks-policy`.

#### Evidence
Triage mostrou `hooks-policy` com `as-cast`.

#### Files to edit
```
examples/hooks-policy/src/index.ts — migrar se cast é em tool
examples/hooks-policy/package.json — zod dep se migrou
```

#### Deep file dependency analysis
Standalone — sem deps externos.

#### Deep Dives
Idêntico T2.2.

#### Tasks
1. Ler arquivo
2. Decidir branch
3. Migrar se aplicável
4. Typecheck

#### TDD
```
GREEN:   tsc --noEmit retorna 0
VERIFY:  igual T2.2
```

#### Acceptance Criteria
Igual T2.2.

#### DoD
- [ ] T2.3 completo

---

## Phase 3: Quickstart showcase (única showcase obrigatória)

**Objective:** Adicionar variante `Agent.builder()` ao `examples/quickstart/src/index.ts` lado a lado com o `Agent.create()` original. Atualizar README do quickstart para apontar a alternativa.

### T3.1 — Adicionar seção `mainWithBuilder()` em `quickstart/src/index.ts`

#### Objective
Manter o `main()` atual com `Agent.create({...})` (a primeira impressão "vanilla"). Adicionar `mainWithBuilder()` que faz a MESMA coisa via `Agent.builder().model(...).local(...).create()`. Comentário no topo do arquivo aponta as duas alternativas.

#### Evidence
Quickstart é a porta de entrada. Discoverability dos helpers — sem isso, usuários novos veem só options-bag e nunca encontram o builder/factory.

#### Files to edit
```
examples/quickstart/src/index.ts — adicionar mainWithBuilder() + flag para escolher qual roda
examples/quickstart/README.md — adicionar seção "Two ways to create an agent"
```

#### Deep file dependency analysis
- Quickstart hoje exporta `main()` que `Agent.create` + send. Adicionar `mainWithBuilder()` é additive — quebra nada.
- README ganha seção; estrutura geral preserva.

#### Deep Dives
Estrutura (após EC-3 — env var em vez de argv, mais robusta cross-tool):
```ts
async function main(): Promise<void> {
  // Options-bag form — the canonical Agent.create entry.
  const agent = await Agent.create({ ... });
  // ...
}

async function mainWithBuilder(): Promise<void> {
  // Fluent form — same result, different ergonomics (ADR D25).
  const agent = await Agent.builder()
    .apiKey(process.env.THEOKIT_API_KEY ?? "theo_test_quickstart")
    .model({ id: "..." })
    .local({ cwd: process.cwd() })
    .create();
  // ...
}

// EC-3: env var é unambiguous através de tsx / pnpm / direct node call.
// argv flag funciona mas exige `pnpm dev -- --builder` (com `--`) que
// confunde usuários. BUILDER=1 é trivialmente claro em qualquer shell.
const mode = process.env.BUILDER === "1" ? mainWithBuilder : main;
mode().catch(...);
```

Invariantes:
- `pnpm dev` (sem env var) roda `main()` — comportamento histórico preservado.
- `BUILDER=1 pnpm dev` roda variante.
- Output observável idêntico nas duas.

#### Tasks
1. Ler `quickstart/src/index.ts`
2. Adicionar `mainWithBuilder()`
3. Adicionar dispatch por flag
4. Atualizar README com seção comparativa
5. Typecheck + smoke boot (`pnpm dev` E `pnpm dev --builder`)

#### TDD
```
GREEN:   tsc --noEmit retorna 0
SMOKE:   pnpm dev — boota OK (até primeira send ou primeira linha de log esperada)
SMOKE:   BUILDER=1 pnpm dev — mesmo output (EC-3 confirms env var dispatch works)
VERIFY:  README tem nova seção "Two ways to create"
VERIFY:  README explicita BOTH commands (pnpm dev | BUILDER=1 pnpm dev) — sem ambiguidade
```

#### Acceptance Criteria
- [ ] `main()` preserva o behavior original (Agent.create)
- [ ] `mainWithBuilder()` produz mesma saída via builder
- [ ] Flag CLI decide qual roda
- [ ] README atualizado
- [ ] Smoke boot OK nas duas variantes

#### DoD
- [ ] T3.1 completo

---

## Phase 4: README index dos examples

**Objective:** Single source-of-truth para "qual example demonstra o quê". Hoje, descobrir o example certo é folder-by-folder. README index com tabela resolve.

### T4.1 — Criar/atualizar `examples/README.md`

#### Objective
Tabela com 39 linhas: nome do example, feature primária demonstrada, helper usado (se aplicável), comando para rodar.

#### Evidence
Sem index, descobrir exemplos requer ls + cat de cada README. CLAUDE.md global rule 6 (changelog discipline) tem analogue para examples — manter "índice publicável" reduz fricção de adoção.

#### Files to edit
```
examples/README.md — (NEW ou rewrite) tabela completa + seção "Where to start"
```

#### Deep file dependency analysis
- Standalone — não muda código nenhum.
- Outras READMEs (per-example) podem linkar de volta ao index.

#### Deep Dives
Estrutura sugerida:
```markdown
# @usetheo/sdk Examples

39 runnable examples covering the public surface of `@usetheo/sdk`.

## Where to start

- **Brand new?** → [`quickstart`](./quickstart) (also shows `Agent.builder()`)
- **Chat bot?** → [`telegram-pro`](./telegram-pro) (factory + defineTool + getOrCreate)
- **Memory?** → [`memory`](./memory), [`memory-search`](./memory-search), [`memory-dreaming`](./memory-dreaming)
- **MCP?** → [`mcp-stdio`](./mcp-stdio), [`mcp-http`](./mcp-http)
- **Cloud?** → [`cloud-agent`](./cloud-agent), [`cloud-with-skills`](./cloud-with-skills)

## Full index

| Example | Demonstrates | Helper used | Run |
|---|---|---|---|
| `active-memory` | Memory.activeRecall blocking pre-send | — | `pnpm dev` |
| `agent-management` | Agent.list / get / archive / delete | `Agent.builder`, `Agent.getOrCreate` | `pnpm dev` |
| ... | ... | ... | ... |
```

Invariantes:
- Cada example aparece exatamente 1x na tabela.
- "Helper used" reflete migração real (não aspiracional).
- "Demonstrates" é uma frase curta, não rave review.

#### Tasks
1. Listar os 39 examples
2. Para cada um: identificar feature primária (ler README ou index.ts)
3. Identificar helper usado (consultar o snapshot T0.1)
4. Escrever tabela
5. Adicionar "Where to start" no topo

#### TDD
```
N/A — relatório markdown.
VERIFY:  wc -l da tabela = 39 + cabeçalho + separator
VERIFY:  grep -c "^| " na tabela = 39 + 1 (cabeçalho)
```

#### Acceptance Criteria
- [ ] `examples/README.md` existe
- [ ] Tabela tem 39 linhas
- [ ] Coluna "Helper used" reflete o estado real pós-migração
- [ ] Seção "Where to start" cobre os 5 caminhos principais

#### DoD
- [ ] T4.1 completo

---

## Phase 5: Cross-validation + Dogfood QA

**Objective:** Validar que (1) nada quebrou no SDK; (2) os 39 examples typecheck; (3) telegram-pro continua rodando real-LLM sem regressão.

### T5.1 — Re-rodar typecheck-sweep (T1.1) pós-mudanças

#### Objective
Garantir que Phases 2 e 3 não introduziram regressão nos outros 33 examples não-migrados.

#### Evidence
A baseline foi capturada antes das mudanças. Se Phase 2 ou Phase 3 quebrarem algum outro example, sweep pega.

#### Files to edit
```
.claude/knowledge-base/reviews/examples-typecheck-{date}-final.md — (NEW) snapshot final
```

#### Tasks
1. Rodar `tools/typecheck-examples.sh`
2. Diff vs baseline T1.1
3. Snapshot final

#### TDD
```
VERIFY:  pass count >= baseline pass count
VERIFY:  fail count <= baseline fail count
VERIFY:  diff de status para cada example documentado
```

#### Acceptance Criteria
- [ ] Pass count não diminuiu
- [ ] Fail count não aumentou
- [ ] Snapshot diff commitado

#### DoD
- [ ] T5.1 completo

### T5.2 — SDK full validate

#### Objective
Re-rodar `pnpm -w run validate` (G1-G9). Garantir que mudanças nos examples não afetam o SDK.

#### Files to edit
N/A — só executa validate.

#### Tasks
1. `pnpm -w run validate`
2. Confirmar exit=0

#### TDD
```
VERIFY:  validate exit=0
VERIFY:  331/331 tests passing (não muda — examples não tem testes próprios)
```

#### Acceptance Criteria
- [ ] Validate exit=0
- [ ] Tests count = 331 (sem regressão)

#### DoD
- [ ] T5.2 completo

### T5.3 — Telegram-pro real-LLM regression check

#### Objective
Após qualquer mudança no SDK ou nos examples relacionados, garantir que o bot ainda funciona. Re-rodar CDP test.

#### Evidence
Plano predecessor estabeleceu telegram-pro como o gate real-LLM. Mantemos esse gate aqui.

#### Files to edit
N/A — restart bot + CDP test existente.

#### Tasks
1. Restart bot (`pnpm dev` no telegram-pro)
2. Rodar `/tmp/chrome-attach/test-phase7-dogfood.mjs` (já existe)
3. Verificar messages.jsonl persistido

#### TDD
```
VERIFY:  /tool uuid → UUID v4 válido
VERIFY:  /tool hash sha256 hello → 2cf24dba…938b9824
VERIFY:  current_time → ano atual (2026)
```

#### Acceptance Criteria
- [ ] Bot boot OK
- [ ] 3/3 cenários CDP passam (ou via messages.jsonl)
- [ ] Zero CRITICAL regression vs estado anterior

#### DoD
- [ ] T5.3 completo

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Triage automatizada dos 39 examples | T0.1 | Script + snapshot reproducible |
| 2 | Typecheck-sweep dos 39 (regressão pós-rebuild SDK) | T1.1, T1.2 | Script + snapshot fail list |
| 3 | Migrar 2 dogfood scripts do telegram-bot | T2.1 | getOrCreate substitui try/catch |
| 4 | Migrar shell-tool se tem cast em tool def | T2.2 | defineTool + Zod schema |
| 5 | Migrar hooks-policy se tem cast em tool def | T2.3 | defineTool + Zod schema |
| 6 | Quickstart showcase do builder | T3.1 | mainWithBuilder() add, main() preserva |
| 7 | README index dos 39 examples | T4.1 | Tabela + Where-to-start |
| 8 | Validação cruzada pós-mudanças | T5.1, T5.2, T5.3 | Typecheck-sweep final + SDK validate + telegram-pro dogfood |
| 9 | Decisão sobre quem NÃO migra | D27 | ADR explícito: single-feature demos ficam |
| 10 | Decisão sobre defineTool scope | D29 | ADR: só onde há `as` cast em tool def |
| 11 | Decisão sobre quickstart como única showcase | D30 | ADR: 1 example dual-pattern, resto foca |
| 12 | Decisão sobre cross-validation method | D31 | ADR: typecheck + boot smoke, sem testes per-example |

**Coverage: 12/12 gaps covered (100%)**

## Global Definition of Done

- [x] All phases completed (Phase 0-6, +1 added pós-edge-case discovery)
- [x] **39/39** examples typecheck clean (`Pass=39 TscError=0 OtherError=0`)
- [x] Os 4 force-migration files: **decisão registrada** (Phase 2 skipped — falsos-positivos do regex triage; codebase já limpo)
- [x] `quickstart` ganha `mainWithBuilder()` sem perder `main()` (dispatch via `BUILDER=1`)
- [x] `examples/README.md` ganhou "DX helpers cheat sheet" + "Maintenance" sections
- [x] SDK suite **331/331** (sem regressão)
- [x] `pnpm -w run validate` **exit=0** (G1-G9 todos verdes)
- [x] Telegram-pro real-LLM regression check OK (messages.jsonl com SHA256 real + 2026 timestamp)
- [x] **5 ADRs** lockados (D27-D31)
- [x] `tools/triage-examples.sh` executável e reproduzível
- [x] `tools/typecheck-examples.sh` executável + idempotente (testado 2x, mesmos números)
- [x] **Phase 6: real-LLM sweep** — `tools/run-examples-real-llm.sh` rodou 26/29 standalone examples com LLM real, 10/10 fixture-mode (per rule), 1 marker-missing (telegram-bot env conflict), 2 skipped (.env user-setup). Evidence em snapshot inclui quickstart 992ms response, shell-tool invocando ferramenta real, memory init em disco.
- [x] **Bug crítico corrigido**: SDK dist tinha top-level `import "zod"` que quebrava examples sem zod dep. Refatorado para `createRequire` lazy sync load. SDK tests 6/6 mantidos verdes.

## Final Phase: Dogfood QA (MANDATORY)

Already covered in T5.3 above. The dogfood here is the SAME as the predecessor plan — telegram-pro bot running real LLM, CDP test bates `/tool uuid`, `current_time`, hash sha256.

### Execution

```bash
pkill -9 -f "telegram-pro/src/index" 2>&1; sleep 3
cd examples/telegram-pro && nohup pnpm dev > /tmp/bot-examples-migration.log 2>&1 &
sleep 8
node /tmp/chrome-attach/test-phase7-dogfood.mjs
```

### Acceptance Criteria

- [ ] Bot boota em Node 22
- [ ] `/tool uuid` retorna UUID v4 válido (regex match)
- [ ] `/tool hash sha256 hello` retorna `2cf24dba…938b9824`
- [ ] `current_time` retorna timestamp com ano atual

### If Dogfood Fails

1. Diff: o que mudou entre o estado pré-plano e o atual? `git diff origin/main..HEAD examples/telegram-pro/`
2. Bisect: reverter mudanças phase-a-phase até identificar a causa
3. Fix + re-rodar

---

## Riscos e Mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| pnpm install --ignore-workspace é lento (~30s × 39 examples) | Baixa | Paralelizar com xargs -P 8 no script — passa de ~15min para ~2min |
| Algum example tem pre-existing typecheck error não detectado | Média | T1.2 baseline captura; phases não bloqueiam por fail pré-existente |
| Zod 4 API muda em patch versions | Baixa | Pin `^4.0.0` no package.json dos examples migrados |
| README index fica desatualizado conforme novos examples são adicionados | Média | Adicionar nota no `examples/README.md` apontando para `tools/triage-examples.sh` |
| Quickstart com 2 funções confunde quem só queria copiar 1 | Baixa | Flag CLI explícita + comentário no topo |
| Sweep typecheck demora demais e gera fricção | Baixa | Sweep não é gate de pre-commit (apenas pre-release ou manual) |
