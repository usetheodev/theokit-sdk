# ROADMAP-v3 — Framework Hardening (fechar os loops que o V2 abriu)

> **Status:** PROPOSTO (2026-06-23). Artefato estratégico cross-repo. Nenhuma execução iniciada.
> Espelho do [`ROADMAP-v2.md`](./ROADMAP-v2.md): o V2 foi o lado **consumidor** (o `theocode` adotando o framework); o V3 é o lado **framework** (endurecer/expor os primitivos que o dogfooding do V2 provou faltarem), terminando cada milestone com o **theocode adotando de volta** — o loop fechado.

---

## 0. Premissa: o loop de dogfooding theocode ↔ framework

O `theocode` (app de referência: code-assistant completo em `theokit` + `@theokit/sdk` + `@theokit/ui`) é a **prova de vida** do stack. Ele valida o framework em 3 eixos:

1. **Suficiência** — roda um agente completo (loop, tools, memória, plan-mode, eval/SWE-bench, UI) → o stack é capaz.
2. **Correção** — quando adota um primitivo e a suíte (533 testes) fica verde → o primitivo está certo.
3. **Descobribilidade** — quando teve que reinventar algo que já existia, o framework falhou em **expor/documentar** (Regra 9), não em capacidade.

O ciclo:

```
theocode dogfoda → revela um GAP → framework EXPÕE/ENDURECE o primitivo → theocode ADOTA de volta (loop fechado)
```

Já fechado no V2: V2-2F (atomicWrite interno) → V2-3 (`@theokit/sdk/persistence` público) → V2-2G (`replaceFileAtomic` adotado). O V3 fecha os **loops restantes** — e cada gap tem a **spec executável já pronta**: o hand-roll do theocode + seu corpus de testes.

**Princípio inquebrável do V3:** o `@theokit/sdk` (Harness) e o `theokit` (framework) NÃO ganham scope-creep — só expõem/endurecem o que um consumidor real provou precisar. Nenhum milestone adiciona um primitivo especulativo (YAGNI); cada um existe porque o theocode tem o hand-roll que o prova.

---

## 1. Sequência (dependency graph)

```
V3-0 (ops, paralelo) ───────────────────────────────────────────────┐
V3-1 (shell-guard, ALTO valor) ──▶ theocode adota ─▶ baseline 3→2     │
V3-2 (ui peer + valibot, acoplados) ──▶ theocode bumpa ui 0.18 + audit limpo
V3-3 (compaction token-budget) ──▶ theocode adota ─▶ baseline 2→1
V3-4 (continuation streaming) ──▶ theocode adota (ou mantém — app policy)
V3-5 (eval ergonomics, opcional) ──▶ theocode adota jsonl/provisionRepo
V3-6 (migration API, OPCIONAL/deferível) ──▶ baseline 1→0 (se valer)
```

Ordem por valor: **V3-1 (segurança) > V3-2 (desbloqueio + CVE) > V3-3 > V3-4 > V3-5 > V3-6.** V3-0 roda em paralelo (infra). V3-1/V3-3/V3-6 derrubam entradas do anti-reinvention baseline do theocode (hoje 3: `compaction`, `shell-guard`, `migration-ensure-column`).

---

## V3-0 — Higiene operacional (infra) — [ ]

**Esforço:** S · **Repo:** org GitHub + theokit-sdk + theocode · **Depende de:** —

Dois atritos operacionais que o V2 expôs:
1. **GitHub Actions não pode criar PRs** na org → o changesets action pusha `changeset-release/main` mas falha ao abrir a "Version Packages" PR (toda release exige abrir a PR à mão). Fix: Settings → Actions → General → *Allow GitHub Actions to create and approve pull requests*.
2. **`__pycache__/*.pyc` trackeados** no theokit-sdk (bytecode no git) → gitignorar + `git rm --cached`.

**Concluído quando:** o changesets action abre a Version PR sozinho num release de teste; `git status` do theokit-sdk não lista `.pyc` trackeados.

---

## V3-1 — Endurecer `catastrophicShellReason` (segurança) — [x] (shipped @theokit/sdk-tools@0.3.0)

**Esforço:** S-M · **Repo:** `theokit-sdk` (packages/sdk-tools) · **Depende de:** — · **Valor:** ALTO (segurança)

**Gap (provado em V2-2C-2):** o `@theokit/sdk-tools` `catastrophicShellReason` é um subconjunto MAIS FRACO do guard do theocode — erra **18 de 42** comandos catastróficos (probe empírico): `git reset --hard`, `git clean -fd`, exfiltração (`cat .env | curl`, `tar ~/.aws | nc`), RCE por command-substitution (`eval "$(curl)"`, `. <(curl)`), `find / -delete`, `rm -rf $HOME/...` (flags após operando), `truncate /dev/sda`. Adotar o do SDK regrediria segurança — por isso o theocode mantém o seu (143 LoC, endurecido em 2 security reviews).

**Spec executável:** `theocode/server/lib/shell-guard.ts` + `tests/unit/shell-guard.test.ts` (corpus 42 blocked + 24 allowed) são a referência. Portar as regras: rm-target variants, destructive-git, exfiltration (secret-file + network-sender), command-substitution RCE, find-delete, `> /dev/sd*`/`truncate /dev/*`.

**Concluído quando:** rodar o corpus do theocode (42+24) contra o `@theokit/sdk-tools` `catastrophicShellReason` → **0 misses, 0 false-positives**; changeset `@theokit/sdk-tools` minor; publicado. **Loop fechado:** o theocode adota `catastrophicShellReason` do SDK em `permission.plugin.ts`, deleta `shell-guard.ts`, remove a entrada `shell-guard` do baseline (3→2).

---

## V3-2 — Widen do peer `@theokit/ui` + patch do `valibot` (acoplados) — [x] (theokit peer ^0.14.0 || ^0.18.0 + theo-ui valibot ^1.4.1)

**Esforço:** M · **Repo:** `theokit` (peer) + `theo-ui` (valibot) · **Depende de:** — · **Valor:** Médio (desbloqueio + CVE)

**Gap (F-V2-2G-1 + F-V2-2G-4):** o `theokit@0.8.1` declara `peerOptional @theokit/ui@"^0.14.0"` → trava o theocode em `@theokit/ui` 0.14.4 (não pode adotar 0.18.x sem `--force`). E a 0.14.4 arrasta um `valibot` HIGH transitivo (3 HIGH no `npm audit`), que só some bumpando a ui — bloqueado pelo mesmo peer. Os dois são **um problema só**.

**Spec executável:** o `npm audit` do theocode (3 HIGH via `@theokit/ui` → `valibot`) + o ERESOLVE do `npm install theokit@0.8.1 @theokit/ui@0.18.1`.

**Concluído quando:** o `theokit` widen o peer de `@theokit/ui` (ex: `^0.14.0 || ^0.18.0` ou range aberto) num release; `@theokit/ui` 0.18.x usa um `valibot` sem o HIGH (bump/patch no theo-ui). **Loop fechado:** o theocode bumpa `@theokit/ui@0.18.x` (resolve sem `--force`) e `npm audit` fica sem HIGH transitivo de valibot.

---

## V3-3 — Modo token-budget no `@theokit/sdk/compaction` — [ ]

**Esforço:** M · **Repo:** `theokit-sdk` (packages/sdk, compaction) · **Depende de:** — · **Valor:** Médio

**Gap (V2-2B-2):** o `compactTranscript` do SDK é **turn-count only** (`keepRecent`), com marker fixo `[[theokit:checkpoint]]` e summarizer sem template. O theocode usa estratégia **token-budget** (`keepTokens` 8000), marker `<conversation-checkpoint>` (persistido em sessões existentes) e um template de 7 seções. Adotar o do SDK mudaria comportamento + quebraria checkpoints persistidos.

**Spec executável:** `theocode/server/lib/compaction.ts` (`splitTranscript` token-budget + `SUMMARY_TEMPLATE` 7 seções + `filterFromLatestCheckpoint` include-checkpoint) + `tests/unit/compaction.test.ts`.

**Concluído quando:** `compactTranscript` aceita modo token-budget (`keepTokens`), um marker configurável (compat com `<conversation-checkpoint>`), e um summarizer template-driven; teste de paridade com o corpus do theocode passa. **Loop fechado:** o theocode adota `compactTranscript` do SDK, deleta `compaction.ts`, remove `compaction` do baseline (2→1). *(Honesto: se o custo de generalizar exceder o valor — KISS — pode ficar como decisão documentada de manter a divergência; o baseline então fica como accepted debt, não reinvenção.)*

---

## V3-4 — Driver de continuação streaming + stateless + reflection-aware — [ ]

**Esforço:** M-L · **Repo:** `theokit-sdk` (packages/sdk) · **Depende de:** — · **Valor:** Médio

**Gap (V2-2A-2):** o `agent.runToCompletion`/`buildReplayHistory` do SDK assume um loop **stateful + non-streaming + single-prompt**. O runner do theocode é **stateless (reconstrói o transcript por round) + streaming (`AsyncGenerator<AgentEvent>` pra UI ao vivo) + reflection-aware (reflect/verify/verify-fix por outcome do round)**. Adotar perderia streaming + a reflection ladder.

**Spec executável:** `theocode/server/lib/agent-stream.ts` (`runCodeAgent` outer loop) + `agent-loop.ts` (`classifyRoundOutcome`, `selectReflection`).

**Concluído quando:** o SDK expõe um driver de continuação que (a) emite eventos (streaming), (b) é stateless (aceita histórico acumulado por round), (c) tem hook por outcome de round (terminais `done`/`step_limit`/`no_progress` + re-prompt bounded). **Loop fechado:** o theocode adota o driver (mantendo a reflection ladder de domínio no app) OU documenta que o outer loop fica como app-policy (não é reinvenção rastreada pelo guard). *(Honesto: este pode legitimamente ficar como app-policy — a reflection ladder é domínio do code-assistant, não plumbing genérico.)*

---

## V3-5 — Ergonomia do eval harness (opcional) — [ ]

**Esforço:** M · **Repo:** `theokit-sdk` (eval + sandbox) · **Depende de:** — · **Valor:** Baixo (opportunity)

**Gap (V2-2E-1/3/4):** (a) `appendJsonl`/`readJsonlIds` foram **extraídos do theocode** (`referencia:` citado) mas ficaram em `@theokit/sdk/internal/persistence` (não-público) — o subpath público `@theokit/sdk/persistence` (V2-3) deveria re-exportá-los; (b) `provisionRepo`/`Scorers.verifyGate` exigem um `SandboxBackend` (o theocode é direct-execFile/local); (c) `Eval.create` é agent-centric, o harness do theocode é task-centric (seed→patch→verify).

**Spec executável:** `theocode/server/lib/swebench-batch.ts` (`readDoneIds`/`appendFileSync` resume), `swebench-provision.ts` (`prepareRepo`), `eval-suite.ts` (verify).

**Concluído quando:** `appendJsonl`/`readJsonlIds` re-exportados do `@theokit/sdk/persistence` público (parte trivial); `provisionRepo`/`verifyGate` com um backend local default (sem exigir SandboxBackend explícito). **Loop fechado:** o theocode adota os helpers jsonl + provisionRepo do path público. *(Baixa prioridade — o eval do theocode funciona; é cleanup de Regra 9, não bloqueio.)*

---

## V3-6 — API de migração programática (OPCIONAL / deferível) — [ ]

**Esforço:** M · **Repo:** `theokit` · **Depende de:** — · **Valor:** Baixo

**Gap (V2-2F-1):** o `ensureColumn` à mão no theocode (`server/db/index.ts`) é a única entrada de baseline sem caminho de adoção — o alvo (`theokit db push`) é um **CLI de dev**, não há API programática chamável em runtime. O PRAGMA+ALTER idempotente é o approach correto hoje.

**Concluído quando (SE valer):** o `theokit` expõe uma API programática de migração idempotente (`ensureColumn`/`migrate`) chamável em runtime, sem o app depender do CLI. **Loop fechado:** o theocode adota, remove `migration-ensure-column` do baseline (→0). *(Honesto: pode ficar como **accepted debt permanente** — o hand-roll é correto e mínimo; só vale se outros consumidores pedirem.)*

---

## 2. Definição de "V3 completa"

- [ ] V3-0: changesets action abre Version PR sozinho; `.pyc` desentrackeados.
- [ ] V3-1: `catastrophicShellReason` do SDK passa o corpus 42+24 do theocode; theocode adota; baseline `shell-guard` removido (3→2).
- [ ] V3-2: peer `@theokit/ui` widened + `valibot` patcheado; theocode em `@theokit/ui@0.18.x`; `npm audit` sem HIGH transitivo.
- [ ] V3-3: `compactTranscript` com modo token-budget + marker configurável; theocode adota OU divergência documentada; baseline `compaction` resolvido.
- [ ] V3-4: driver de continuação streaming/stateless; theocode adota OU app-policy documentada.
- [ ] V3-5 (opcional): jsonl/provisionRepo públicos; theocode adota.
- [ ] V3-6 (opcional): API de migração OU accepted debt formal.
- [ ] **Veredito reescrito:** "o theokit tem TODOS os primitivos que um agente sério precisa, públicos, documentados e ao menos tão capazes quanto qualquer hand-roll de consumidor — e o theocode prova isso com 0 reinvenções restantes (ou cada reinvenção restante é accepted debt documentado, não gap)."

---

## 3. Riscos honestos a vigiar

| Risco | Severidade | Mitigação |
|---|---|---|
| Generalizar um primitivo (compaction token-budget, continuation driver) excede o valor → scope creep no Harness | Alta | Cada milestone tem o gate KISS/YAGNI: se generalizar custa mais que a divergência, fica como divergência documentada (accepted debt), NÃO se força a adoção. O hand-roll do theocode é a spec, não um mandato de absorção. |
| V3-2 acopla 2 repos (theokit peer + theo-ui valibot) | Média | Tratar como um milestone único; o DoD exige os dois + o `npm audit` limpo no theocode como prova end-to-end. |
| Releases cross-repo via changesets travam (V3-0 não feito) | Média | V3-0 primeiro/paralelo; até lá, abrir Version PRs à mão (`gh pr create --head changeset-release/main`). |
| O theocode diverge do framework de novo durante o V3 | Baixa | Cada milestone fecha o loop com adoção no theocode no MESMO ciclo; o anti-reinvention guard do theocode é o gate de regressão. |

---

## 4. Como executar (mesma disciplina do V2)

Cada milestone roda o cycle completo das skills, no repo-alvo, **terminando com a adoção no theocode**:

```
discover (probe empírico do gap, grounded no hand-roll do theocode)
  → to-plan → edge-case-plan → deps-audit → plan-confidence (SHIPPABLE)
  → implement (no repo do framework) → code-quality → review (READY_TO_MERGE)
  → release (changesets) → theocode adota de volta (cycle no theocode) → baseline encolhe
```

FAANG-level, sem workarounds, todos os DoDs validados — só parar quando READY_TO_MERGE + loop fechado.

---

> **Sincronização:** se houver uma cópia top-level de `gap-audit/`, manter este arquivo em sincronia (mesma regra do ROADMAP-v2). Versão canônica: `theokit-sdk/docs/gap-audit/ROADMAP-v3.md`.
