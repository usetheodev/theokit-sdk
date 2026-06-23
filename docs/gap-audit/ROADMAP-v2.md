# Roadmap V2 — Fechar o loop: da oferta entregue ao objetivo provado

> Sucessor do `ROADMAP.md` (V1, M0–M8 RELEASED). V1 fechou os **52 gaps do lado da oferta** — os primitivos foram implementados, expostos em barrels públicos e publicados na npm. V2 fecha o **loop**: provar o objetivo no consumidor de referência, torná-lo descobrível para terceiros, e impedir a regressão.
>
> **Fonte:** `THEOKIT_GAP_AUDIT.md` (52 gaps confirmados) + `ROADMAP.md` (V1) + a evidência de adoção coletada em 2026-06-23.

---

## Por que V2 existe (o diagnóstico)

O `THEOKIT_GAP_AUDIT.md` definiu o objetivo-norte:

> "Qualquer pessoa constrói um agente/code-assistant sobre o ecossistema Theo **sem reinventar plumbing genérico**. O `theocode` deixa de ser *prova de que dá* e passa a ser *exemplo de quão pouco código o app precisa*."

V1 (M0–M8) entregou a **oferta**: os 52 primitivos existem, estão expostos e publicados. Mas o objetivo **não se mede por "primitivos existem" — se mede por "o app encolhe"**, e esse lado não aconteceu:

- **Evidência (2026-06-23):** um `grep` por TODOS os primitivos M1–M8 em `theocode/src` retorna **zero matches**. O theocode não consome nenhum deles, não tem `@theokit/orm` instalado, e roda versões de `@theokit/sdk`/`sdk-tools` anteriores às que contêm os primitivos. Continua 100% no plumbing à mão (`stepCapTracker`, compaction copiada do a peer project, `web-fetch-guard`/`shell-guard`, retry por regex, atomic-write inferior).
- O `GAP_AUDIT §4` já avisava: vários "app concerns" são **violações da Regra 9 dentro do theocode** — o primitivo existe e é superior, o app só não adotou.
- O **Tema G (Descoberta)** — causa-raiz de metade dos gaps — **continua aberto**: publicamos em barrels + CHANGELOGs, mas não há um inventário de capacidades. A regra de ouro da auditoria: *"se o theocode (feito por quem conhece o stack) reinventou, um terceiro NUNCA descobre."*

**Estado real pós-V1:** *"agora dá pra construir sem reinventar — se você descobrir os primitivos."* O norte só é atingido quando o consumidor de referência **prova encolhendo** e o resultado é **descobrível** para o próximo builder.

---

## Norte da V2 e métrica única

**Norte:** virar o veredito da auditoria de *"dá pra construir sem reinventar — se descobrir"* para *"o theocode encolheu, há um inventário que torna os primitivos descobríveis, e um guard impede a regressão."*

**Métrica única e observável (o teste literal do objetivo):**

- **LoC/módulos à mão deletados no `theocode`** ao adotar os primitivos, **E**
- **re-grep dos 52 gaps no `theocode` → 0 reinvenções**.

Se o theocode não encolher, V2 falhou — independentemente de quantos primitivos a V1 publicou. Métricas de oferta ("primitivo existe") são explicitamente **insuficientes** para declarar V2 completa.

---

## Princípio de sequenciamento

A **adoção é o keystone** — é o objetivo se materializando. Os outros três orbitam-na:

```
V2-0 (enabler) ──▶ V2-2 (ADOÇÃO — keystone) ──▶ V2-3 (inventário, derivado) ──▶ V2-4 (ADR estratégico, informado)
        │                    ▲
        └──▶ V2-1 (guard) ───┘  (paralelo; protege durante toda a V2)
```

Fazer V2-3 (inventário) ou V2-4 (estratégia) **antes** da adoção repetiria o erro da V1: construir/decidir sem prova de demanda. O inventário ancorado em fiação real é honesto; aspiracional é fantasia. A decisão di/gateways só é boa **depois** que a adoção revela se o on-ramp imperativo ficou completo.

---

## V2-0 — Enabler: theocode nas versões publicadas

**Esforço:** S · **Depende de:** — · **Bloqueia:** V2-2

> **Status: READY_TO_MERGE (2026-06-23)** — cycle discover→plan→implement→review completo no `theocode` (commits `83c921d`/`77087b8`/`70c70ee` em `develop` local; theocode não tem remote git → sem PR). Bump `@theokit/sdk` ^1.9.0→^2.5.0 + `@theokit/sdk-tools` ^0.1.0→^0.2.0; **aditivo p/ a surface do theocode** (barrel/eval/path-safety) → zero adaptação de código. Removidas as deps mortas `@theokit/di`+`@theokit/di-agent` (não-importadas; seu peer stale `sdk@^1.3.0` era a única causa do ERESOLVE) → install limpo. `@theokit/orm`/`@theokit/agents` **diferidos** (não importados; entram nos slices de adoção que os usam — refino de escopo vs a redação original abaixo). Gates: plan-confidence SHIPPABLE 100; deps-audit PASS_WITH_CAVEATS (3 HIGH `valibot` pré-existentes via `@theokit/ui`, fora de escopo → V2-2D); code-quality PASS_WITH_CAVEATS (symbol-fab unverifiable em subpaths scoped, falsos-positivos); review READY_TO_MERGE (2 agentes, 0 BLOCKER/0 HIGH). Verde: tsc 0 · suíte 527 (probe novo) · build 0 · ERESOLVE 0.

Bumpar o `theocode` para `@theokit/sdk@^2.5.0`, `@theokit/sdk-tools@^0.2.0`, `@theokit/agents@^0.5.0` e instalar `@theokit/orm@^0.1.0`. Sem isso nada pode ser adotado — o theocode hoje nem tem as versões com os primitivos.

**Concluído quando:** `theocode` instala as novas versões; build + suíte verdes no baseline (antes de qualquer deleção).

---

## V2-1 — Guard de regressão (fitness function)

**Esforço:** M · **Depende de:** — · **Roda:** paralelo, cedo

> **Status: V2-1a READY_TO_MERGE (2026-06-23)** — guard anti-reinvenção (#3) entregue no `theocode` (commits `bbf18f9`/`18e9a69`/`3c865de` em `develop` local). Ratchet node:fs-only (`scripts/anti-reinvention-guard.mjs` + `anti-reinvention-baseline.json`) ancorado na DEFINIÇÃO local de 6 primitivos reinventados (stepCapTracker→runToCompletion, compactTranscript→`@theokit/sdk/compaction`, isBlockedAddress→SSRF, catastrophicShellReason→sdk-tools, isTransientLlmError→`isTransientError`, ensureColumn→theokit db). Verde no estado atual (6 defs baselined = dívida que o V2-2 paga, só encolhe); vermelho numa def NOVA fora do baseline. Wired no `ci.yml` (`npm run guard:anti-reinvention`) + vitest planted-fixture (RED por signature, GREEN no real + GREEN na forma de adoção `import { X }` — non-regression do V2-2). Gates: plan-confidence SHIPPABLE 100; deps-audit PASS_WITH_CAVEATS (sem deps novas); code-quality PASS_WITH_CAVEATS (sem findings V2-1); review 2 agentes READY_TO_MERGE (0 BLOCKER/0 HIGH, 2 LOW corrigidos). Verde: guard exit 0 · suíte 536 · tsc 0 · lint 0.
>
> **V2-1b (PENDENTE)** — detectores #1 (decorator-sem-runtime) + #2 (`@internal` selado) scaneiam **source do framework** (theokit/theokit-sdk, sob `theokit-tools/`) ausente no theocode → pertencem aos CIs daqueles repos (architecture-guards/validate). Split forçado pela realidade (node_modules do theocode só tem `dist`), não preferência.

Check de CI (no ecossistema framework + no theocode) que falha nos três anti-padrões que a auditoria identificou como geradores de quase todos os gaps:

1. **Decorator sem runtime** — decorator de `@theokit/agents` com `getXConfig` sem consumidor de runtime (o anti-padrão #1 do GAP_AUDIT §1).
2. **Primitivo `@internal` selado** — lógica testada dentro de um pacote mas ausente do barrel público.
3. **Primitivo re-implementado à mão** (no theocode) — re-grep dos 52 gaps; novo match = falha.

**Concluído quando:** o check roda em CI; falha-vermelho num caso de teste plantado de cada anti-padrão; verde no estado atual. Impede a auditoria de precisar ser re-rodada manualmente.

---

## V2-2 — Adoção no theocode (keystone)

**Esforço:** L (o grosso da V2) · **Depende de:** V2-0 · **Protegido por:** V2-1

> **Status: V2-2A READY_TO_MERGE (2026-06-23)** — slice A (Harness) entregue no `theocode` (commits `65eeffd` adoção + `50368cc` review-hardening em `develop` local). **Adoções limpas:** (1) retry — deletado `lib/retry.ts` (`isTransientLlmError` + `withRetry` à mão), fiado `@theokit/sdk` `withRetry` (`/retry`) + `isTransientError` (**BARREL**, não `/errors` — finding F1: subpath empacota cópia separada de `TheokitAgentError`, `instanceof` cross-entry nunca casa; provado empiricamente); (2) step-cap — deletado `stepCapTracker`, agora ENFORCED pelo SDK `createCounterBudgetTracker({maxIterations})` + `RunResult.stoppedAtIterationLimit`, com summary via helper puro `runResultTailEvents` (módulo próprio, unit-tested). Baseline anti-reinvenção encolheu 6→4 (`step-cap-tracker` + `transient-error` removidos) — guard VERDE porque os primitivos foram deletados, não silenciados. **Deferidos (F3 → V2-2A-2):** `runToCompletion` (M1-2) + `buildReplayHistory` (M1-3) — assumem loop stateful + non-streaming + single-prompt; o runner do theocode é stateless + streaming + reflection-aware (mismatch arquitetural, não gap). Gates: plan-confidence SHIPPABLE 97.6; deps-audit PASS_WITH_CAVEATS (zero deps novas); code-quality PASS_WITH_CAVEATS (15 falsos-positivos `@theokit/*` subpath, zero símbolo real fabricado); review 3 agentes → READY_TO_MERGE (2 HIGH encontrados — `sleep` morto + DoD LoC — ambos corrigidos sem workaround; re-verificados). Verde: suíte 533 · tsc 0 · lint 0 · guard 0 · agent-stream.ts 470 (< 497 DoD). Findings F1/F2/F3 em `theocode/.claude/knowledge-base/implementations/v2-2a-framework-findings.md`. **Restam V2-2B..F.**

> **Status: V2-2C READY_TO_MERGE (2026-06-23)** — slice C (Tools/segurança) entregue (commits `8cbf5e8` + `4208a2e` + `f8b1c5a` em `theocode/develop`). **SSRF adotado (limpo):** `isBlockedAddress` regex à mão → `@theokit/sdk-tools` `isBlockedIp` (superset behavior-equivalent — probe empírico: 16/16 casos de IP; reviewer independente confirmou que o `isBlockedIp` bloqueia AINDA MAIS: multicast 224/4, reserved 240/4, broadcast — melhoria de segurança, zero regressão). Wrapper `createGuardedWebFetchTool` + contrato JSON + block-all-redirects intactos. Baseline 4→3 (`ssrf-guard` removido). **Shell NÃO adotado (finding V2-2C-2):** o probe provou que o `@theokit/sdk-tools` `catastrophicShellReason` é um subconjunto MAIS FRACO — erra 18/42 casos catastróficos que o theocode bloqueia (`git reset --hard`, exfiltração de segredo, RCE via command-substitution, `find / -delete`, `rm -rf $HOME/...`); adotá-lo regrediria segurança. theocode mantém o guard endurecido; hardening do SDK é follow-up do theokit-sdk (split como V2-1b). **A INSIGHT-CHAVE do V2:** os hand-rolls do theocode são frequentemente MAIS capazes que os primitivos do SDK — "adoção" só é correta quando o primitivo é ao menos tão capaz; senão o finding endurece o framework. Gates: plan-confidence SHIPPABLE 98; deps PASS (zero deps novas); code-quality PASS_WITH_CAVEATS (subpath FPs); review 2 agentes READY_TO_MERGE (0 BLOCKER/HIGH; 1 LOW de denominador corrigido). Verde: suíte 533 · tsc 0 · lint 0 · guard 0 (baseline 3).

> **Status: V2-2B READY_TO_MERGE (2026-06-23)** — slice B (Contexto/compaction) entregue (commits `d593a43` + `da21634` em `theocode/develop`). **Adotado (limpo):** `estimateTokens` → re-export de `@theokit/sdk/compaction` (duplicata exata; probe independente 15/15 inputs incl. multibyte/emoji; zero churn nos call-sites). **`compactTranscript` NÃO adotado (finding V2-2B-2):** o SDK usa estratégia turn-count (keep 6 turns) vs token-budget do theocode (keep 8000 tokens), marker incompatível (`[[theokit:checkpoint]]` vs `<conversation-checkpoint>` — quebra checkpoints persistidos + UI + history loader), e summarizer sem template (perderia o template de 7 seções); reviewer achou bônus: `filterFromLatestCheckpoint` do SDK EXCLUI o checkpoint vs INCLUI do theocode (dropparia o summary). Não há modo token-budget no SDK → adapter re-implementaria tudo. **`shouldCompact` NÃO adotado (V2-2B-3):** `>=` vs `>` (diverge no budget exato) + SDK junta `maxOutput` no `buffer`. Baseline fica 3 (`compaction` mantido — estratégia diferente, não reinvenção deletável). Gates: plan-confidence SHIPPABLE 99.2; deps PASS; code-quality PASS_WITH_CAVEATS; review 2 agentes READY_TO_MERGE (0 BLOCKER/HIGH/MEDIUM). Verde: suíte 533 · tsc 0 · lint 0 · guard 0.

Refatorar o `theocode` tema-a-tema, **deletando** o plumbing à mão e fiando os primitivos. Cada tema roda o cycle completo (discover→plan→implement→review) e re-verifica os caminhos exatos do `theocode` (os file:line abaixo são do snapshot da auditoria — re-confirmar no plano de cada slice).

| Slice | Tema (V1) | Deletar à mão (theocode, per GAP_AUDIT) | Substituir por (primitivo V1) |
|---|---|---|---|
| **V2-2A** | A — Harness | `stepCapTracker` (`agent-stream.ts`), detector de truncamento + re-send (`agent-loop.ts`) | `nextIteration()` (M1-1), `agent.runToCompletion`/continuation (M1-2), `buildReplayHistory` (M1-3), `isTransientError`/`withRetry` (M0-1/M0-3) |
| **V2-2B** | B — Contexto | compaction copiada do a peer project (`compaction.ts`) | `@theokit/sdk/compaction` (`compactTranscript`/`shouldCompact`/`estimateTokens`) (M2-1/2-2) |
| **V2-2C** | C — Tools/segurança | `web-fetch-guard.ts`, `shell-guard.ts` | `createGuardedWebFetchTool` (SSRF) + `catastrophicShellReason` (M3-1/M3-2); `buildRepoMap` (M3-3) onde aplicável |
| **V2-2D** | D — UI | tool-cards/`liveText` à mão na shell | `foldAgentToolCards`/`useAgentToolCards`/`liveText` (M5-1/2) + `AgentToolRenderer`/adapters (M5-3/4) |
| **V2-2E** | E — Eval | resume/flush de eval reconstruído | `Eval` persist/resume + `loadJsonl` + `verifyGate` + `provisionRepo` (M6) |
| **V2-2F** | F — Persistência | atomic-write inferior, `ensureColumn` à mão, `safeFilenameForId`, `<memories>` dump | `replaceFileAtomic`/`withFileLock` (M0-6), `theokit db push` + drift CI (M0-7), `safeFilenameForId` (M0-4), `createRepository` (M7-7/@theokit/orm), `memory.activeRecall` (M0-9) |

Inclui os itens M0 deferidos no V1 (M0-7 migrations versionadas, M0-9 recall ranqueado, M0-10 provider profile) — eram adoção, não framework.

**Concluído quando (por slice):** módulos à mão deletados; primitivo fiado + testado; re-grep daquele tema → 0 reinvenções; review READY_TO_MERGE. **Concluído (global):** LoC deletadas reportadas; re-grep dos 52 → 0.

---

## V2-3 — Discoverability: Theo Harness Capability Map (Tema G)

**Esforço:** M · **Depende de:** V2-2 (derivado da adoção)

Inventário público e mantido de "tudo que o harness oferece", **ancorado na fiação real da adoção** (cada primitivo adotado em V2-2 → uma entrada com import-path, assinatura, exemplo de uso). Inclui promover `@internal` selados restantes para barrels documentados.

**Concluído quando:** existe um doc único navegável (ex.: `docs/harness-capability-map.md`) cobrindo os 52 primitivos com import + 1 exemplo cada; linkado do README de cada pacote; um terceiro consegue achar `compactTranscript`/`buildRepoMap`/`isTransientError` sem ler o código-fonte.

---

## V2-4 — Decisão estratégica di/gateways/dual-surface (Seção 6)

**Esforço:** M · **Depende de:** V2-2 (informado pela evidência de adoção)

ADR formalizando o futuro de `theokit-di`/gateways + consolidação das duas superfícies HTTP, **à luz da evidência** que a adoção produziu: o on-ramp imperativo ficou completo? di/gateways preenchem necessidade real do shape de app de agente (local-first, síncrono, file-based) ou são scope creep? M8-4 (ADR 0031) deu o primeiro passo (decorators imperative-first/optional); isto é o veredito final, com dados.

**Concluído quando:** ADR registrado com decisão + alternativas rejeitadas + evidência da adoção; tensão dual-surface resolvida (um builder não escolhe entre "convention sem health tipado" e "TheoApp que não serve as rotas do `theokit dev`").

---

## Risco honesto a vigiar

| Risco | Severidade | Mitigação |
|---|---|---|
| Adoção expõe primitivos com ergonomia insuficiente (ex.: `@theokit/orm` async-only/DI-first — barreira de adoção já marcada no GAP_AUDIT §Tema F) | Alta | V2 **não é "só consumir" — é consumir-e-refinar**: micro-fixes de volta no framework são esperados e são o loop funcionando. Orçar tempo de framework dentro de cada slice de V2-2. |
| File:line do GAP_AUDIT desatualizados (snapshot) | Média | Cada slice de V2-2 re-verifica os caminhos no discover/plan antes de deletar. |
| Bump de versões quebra o theocode (V2-0) | Média | Baseline build+test verde ANTES de qualquer deleção; o bump é aditivo (minor). |
| theocode é repo separado (regras de git próprias) | Baixa | Trabalhar em `develop`; release por PR (Regra 4). |

---

## Definição de "V2 completa"

- [ ] theocode nas versões publicadas (V2-0).
- [ ] Guard de regressão em CI, vermelho nos 3 anti-padrões plantados (V2-1).
- [ ] Os 6 slices de adoção (V2-2A..F) READY_TO_MERGE; **re-grep dos 52 gaps no theocode → 0 reinvenções**; LoC/módulos deletados reportados.
- [ ] Capability Map público cobrindo os 52 primitivos (V2-3).
- [ ] ADR di/gateways/dual-surface registrado com evidência (V2-4).
- [ ] **Veredito da auditoria reescrito:** de *"dá pra construir sem reinventar — se descobrir"* para *"o theocode é exemplo de quão pouco código o app precisa, e é descobrível."*

---

> **Status:** PROPOSTO (2026-06-23) — artefato estratégico para revisão. Nenhuma execução iniciada. As duas cópias deste arquivo (`gap-audit/ROADMAP-v2.md` top-level + `theokit-sdk/docs/gap-audit/ROADMAP-v2.md`) devem ser mantidas em sincronia.
