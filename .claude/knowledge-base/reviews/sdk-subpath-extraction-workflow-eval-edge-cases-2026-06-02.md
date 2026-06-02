# Discover Edge Case Review — sdk-subpath-extraction-workflow-eval

Data: 2026-06-02
Discovery plan analisado: `.claude/knowledge-base/discoveries/plans/sdk-subpath-extraction-workflow-eval-plan.md`
Research questions analisadas: 6 (Q1-Q6)
Edge cases encontrados: 7 (MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 2)

Spot-checks rodados antes do report (evidência empírica):

- `ast-grep` disponível em `/home/paulo/.nvm/versions/node/v20.19.2/bin/ast-grep` — Q2 Fase A pode executar.
- `packages/sdk/scripts/mirror-dts-to-cts.mjs:32-36` declara `targets = [tools, path-safety.d.ts, task-store.d.ts]` **explícitos** (não glob de `dist/**`). Adicionar workflow/eval exige update no array.
- `tools/typecheck-examples.sh:1-50` faz `pnpm install --no-frozen-lockfile` mas **NÃO** dispara `pnpm --filter @usetheo/sdk build` antes do sweep.
- `.github/workflows/` existe com `ci.yml` + `docs-drift.yml` (Q1 não cairá em empty).
- `packages/sdk/package.json#scripts` só declara `build: "tsup"` — sem `validate`/`prepublishOnly`/`attw`/`publint` no manifest do pacote. A validation chain real mora em outro lugar (provavelmente `ci.yml` ou root `package.json`).

---

## MUST FIX

### EC-1: Q2 sem fallback empírico — checkpoint forbids `unknown` mas pure-read não garante verdict determinístico

- **Question afetada:** Q2 (cycle-DTS risk)
- **Família:** Method / Interpretation
- **Cenário:** Q2 special checkpoint exige verdict ∈ {yes, no, conditional} e proíbe `unknown`. Mas o método declarado é puramente leitura (ast-grep + grep + Read de `types/agent.ts` + `fork-agent.ts` + `workflow.ts`). Saber se o cycle dispara no `rollup-plugin-dts` da tsup só é determinístico empiricamente: adicionar a entrada nova ao `tsup.config.ts`, rodar `pnpm --filter @usetheo/sdk build`, observar o erro. Leitura estática pode produzir verdict ambíguo ("o tipo é `import type` então provavelmente safe, mas o `types/agent.ts` re-exporta de `internal/runtime/fork-agent.ts` no level acima...").
- **Impacto:** O halt-loop em `/discover-execute` itera Q2 indefinidamente tentando alcançar um verdict não-ambíguo, esgotando o budget de 1h reservado pra cycle-DTS probe, e mesmo assim emitindo BLOCKED — invalidando o blueprint inteiro (Q2 é o pivô da decisão tooling).
- **Fix sugerido:** Adicionar Fase C empírica em Q2: "Se Fase B não convergir para yes/no/conditional, criar `packages/sdk/tsup.scratch.config.ts` com `entry.workflow = 'src/workflow.ts'` adicionado, rodar `pnpm tsup --config tsup.scratch.config.ts`, capturar erro/sucesso da emissão `dist/workflow.d.ts`. Tempo: 5 min. Cleanup: deletar scratch config."

### EC-2: Q5 grep pattern produz falsos-positivos e falsos-negativos

- **Question afetada:** Q5 (consumer blast radius)
- **Família:** Method / Citation
- **Cenário:** O Fase A declarado encadeia `grep -ln "from \"@usetheo/sdk\""` com `xargs grep -ln "\bWorkflow\b\|\bEval\b\|Scorers\|EvalAlreadyRunning\|WorkflowAlready\|agentStep\|WorkflowBuilder"`. Problemas concretos verificáveis em `packages/cli/src/eval/`:
  - `EvalConfig` (CLI-local type) matchea `\bEval\b` via prefixo — falso positivo legítimo (não vem do SDK).
  - `Eval.create` matchea — verdadeiro positivo.
  - `WorkflowMaxIterationsExceededError`, `WorkflowSnapshotNotFoundError`, `WorkflowResumeStepNotFoundError`, `WorkflowNotSerializableError`, `WorkflowParallelError`, `WorkflowDuplicateStepIdError`, `WorkflowCompensateNotImplementedError`, `WorkflowAlreadyRunningError` (lista do `packages/sdk/src/index.ts:136-148`) — alguns matcheiam `WorkflowAlready`, mas `WorkflowMaxIterations`/`WorkflowSnapshot`/etc NÃO matcheiam nenhum termo do regex. Falsos negativos.
  - `fn` é palavra muito comum — vai matchear em qualquer arquivo (`fn` foi exportado mas pode quase nunca ser importado por nome).
  - `agentStep` é único o suficiente.
- **Impacto:** Q5 retorna lista incompleta. Sites com `WorkflowSnapshotNotFoundError` (ou outros 6 Workflow*Error) ficam de fora do migration plan. Após implementação, typecheck-examples quebra surpresas, ferindo `.claude/rules/real-llm-validation.md` (examples devem rodar contra LLM real após a mudança).
- **Fix sugerido:** Substituir Fase A por duas etapas: (1) listar TODOS os named exports do barrel via `grep "^export" packages/sdk/src/index.ts` e dos type-barrels via `grep "^export" packages/sdk/src/types/{workflow,eval}.ts`; (2) gerar regex exaustivo a partir dessa lista (~25 nomes), depois `grep -rln "from \"@usetheo/sdk\"" packages/*/src/ examples/*/ | xargs grep -nE "$(REGEX_EXAUSTIVO)"`.

### EC-3: ast-grep pattern em Q2 Fase A usa `$$$` dentro de string literal — semântica não-garantida

- **Question afetada:** Q2 (cycle-DTS risk)
- **Família:** Method / Citation
- **Cenário:** O plano declara `ast-grep run --pattern 'import type { $$$ } from "./types/agent$$$"' --lang typescript`. O `$$$` é wildcard ast-grep para múltiplos AST-nodes; dentro de um literal de string TypeScript, `$$$` é interpretado como **caracteres literais** `$$$`, não como wildcard (ast-grep faz match estrutural pelo AST, e a string `"./types/agent.js"` é UM nó `StringLiteral` cuja semântica de matching com sub-wildcard não é documentada como suportada). O import real em `packages/sdk/src/workflow.ts:5` é exatamente `import type { SDKAgent } from "./types/agent.js";` — com extensão `.js`. Se o ast-grep não der match porque o literal `./types/agent$$$` não é wildcard mas literal substring, Fase A retorna 0 hotspots.
- **Impacto:** Fase A retorna empty para workflow.ts. O fallback `grep` no Fase A target apenas `types/agent.ts` + `fork-agent.ts` (não workflow.ts), então a evidência "workflow.ts importa SDKAgent" desaparece. Halt-loop tenta 3 retries com variações de pattern, esgota e marca Q2 BLOCKED — mesma consequência cascata do EC-1.
- **Fix sugerido:** Trocar o pattern por literal exato: `ast-grep run --pattern 'import type { $$$ } from "./types/agent.js"' --lang typescript packages/sdk/src/workflow.ts packages/sdk/src/eval.ts`. Ou simplesmente substituir por `grep -nE 'from "(\\./types/agent\\.js|\\./internal/runtime/fork-agent)"' packages/sdk/src/{workflow,eval}.ts` que tem semântica determinística.

---

## SHOULD TEST

### EC-4: Q6 vai reportar "auto-propagates: no" mas o plano não declara o follow-up

- **Question afetada:** Q6 (typecheck-examples propagation)
- **Halt-loop checkpoint sugerido:** "Se Q6 reportar `auto-propagates: no` (confirmado: `tools/typecheck-examples.sh:35-50` faz `pnpm install --no-frozen-lockfile` mas NÃO dispara `pnpm --filter @usetheo/sdk build`), o blueprint MUST incluir uma seção explícita 'Required build step before consumer sweep' citando o comando exato (`pnpm --filter @usetheo/sdk build && tools/typecheck-examples.sh`). Caso contrário a /implement subsequente vai rodar typecheck-examples contra o dist stale e produzir verdict falso-positivo (sem breakage observado quando na verdade os examples importam de exports que ainda não foram regerados)."

### EC-5: Q1 cita attw + publint mas eles não estão em `packages/sdk/package.json#scripts`

- **Question afetada:** Q1 (existing sub-paths validation in CI)
- **Halt-loop checkpoint sugerido:** "Q1 Fase A deve estender o grep para INCLUIR `.github/workflows/ci.yml` E `package.json#scripts` E root `package.json#scripts`. Verificação confirmada: `packages/sdk/package.json` só declara `build: 'tsup'` — sem validate/prepublishOnly/attw/publint. Antes de answer Q1, localizar a validation chain real (provavelmente em root validate ou ci.yml). Se nenhum dos três contiver attw+publint, marcar como gap DOCUMENTado: 'a discovery não encontrou prova de attw/publint gate para sub-paths existentes — assumir que extensão para workflow/eval mantém o status-quo (também sem gate) é uma decisão consciente'."

---

## DOCUMENT

### EC-6: Peer SDK reduzido a Anthropic — OpenAI também está em node_modules mas foi out-of-scope em ADR D2

- **Risco aceito:** ADR D2 já reconhece a redução de fontes externas. `node_modules/.pnpm/openai@4.104.0_*` está fisicamente presente e seu `exports` map é potencialmente mais granular que o do Anthropic SDK (OpenAI 4.x historicamente expõe `openai/resources`, `openai/streaming`, etc — padrão mais próximo do que workflow/eval querem virar). Se o blueprint resultante recomendar uma divergence do padrão Anthropic, abrir um follow-up `/discover-plan {slug}-peer-sdk-openai-comparison` é o caminho honesto — NÃO expandir o escopo deste plano. Time-budget de 0.5h para peer-SDK comparison não cabe segunda fonte.

### EC-7: Q5 "EXHAUSTIVE" checkpoint sem metric verificável

- **Risco aceito:** O Q5 special checkpoint demanda "Migration site list is EXHAUSTIVE (no `examples/*/run.ts` skipped)" mas exhaustividade é difícil de provar via grep. O ground truth real é: rodar `pnpm --filter '!@usetheo/sdk' typecheck` após implementação e ver se exit code = 0. Esse é um teste de **execução**, não de **discovery** — pertence à fase `/implement`, não `/discover-execute`. Documentar no blueprint que "EXHAUSTIVE" significa "passou o grep refinado de EC-2"; a prova final só vem no typecheck pós-implementação.

---

## Resumo

| Question | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------------|----------|-------------|----------|
| Q1 | 1 | 0 | 1 (EC-5) | 0 |
| Q2 | 2 | 2 (EC-1, EC-3) | 0 | 0 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 1 | 0 | 0 | 1 (EC-6) |
| Q5 | 2 | 1 (EC-2) | 0 | 1 (EC-7) |
| Q6 | 1 | 0 | 1 (EC-4) | 0 |
| **Total** | **7** | **3** | **2** | **2** |

**Veredicto:** DISCOVERY PLAN PRECISA DE AJUSTE

Três correções MUST FIX (todas em métodos de Fase A — não exigem reescrita estrutural do plano). Bump sugerido: `v1.0 → v1.1` incorporando:

1. EC-1: Adicionar Fase C empírica em Q2 (scratch tsup config + build, 5min).
2. EC-2: Substituir Fase A de Q5 por geração de regex a partir do barrel exports + named-import scan.
3. EC-3: Trocar ast-grep pattern de Q2 Fase A por literal `from "./types/agent.js"` OU usar grep direto.

E dois SHOULD TEST adicionados aos Halt-loop Checkpoints:

4. EC-4: Verificar verdict de Q6 e exigir step de rebuild explícito no blueprint se "no".
5. EC-5: Estender Q1 Fase A para incluir `.github/workflows/ci.yml` + root scripts.

Após bump v1.1, o plano fica ready para `/discover-execute`.
