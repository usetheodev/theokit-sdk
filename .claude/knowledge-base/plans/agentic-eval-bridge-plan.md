# Plan: Agentic Eval Bridge — Full SDK Coverage Maturity Gate

> **Version 2.1** — Régua objetiva de maturidade do `@usetheo/sdk` cobrindo **toda a surface area** declarada em `docs.md`: tool-use, multi-turn, memory, context manager, MCP servers, hooks, skills, subagents, streaming, provider fallback, multi-modelo, e capacidades não-eval (Cron, Theokit namespace). Combina três técnicas em camadas: **(a) benchmarks padrão externos** (BFCL v3, τ²-bench, LoCoMo, NIAH adaptado) para o que existe na literatura; **(b) mini-suites comportamentais proprietárias** para capacidades sem benchmark padrão (hooks, skills, subagents, MCP); **(c) testes E2E binários** para infraestrutura (Cron, namespace, fallback chaos). Toda capacidade pública vira sinal medível antes de liberar o SDK para usuários. Mantém princípio de v1.1: bridge externa stateless por design (D9), sem invadir `packages/sdk/src/`. **Versão 2.1** incorpora 5 MUST FIX + 17 SHOULD TEST + 11 DOCUMENT do edge case review v2.0: registry pattern para hooks/subagents (D14 extendido, EC-18), Docker sandbox para HumanEval (D18, EC-19), Cron cleanup com namespace isolado (EC-20), nightly continue-on-error (EC-21), e schema multi-step para casos active-recall (EC-22). Versão 2.0 era válida mas tinha gaps conceituais críticos — v2.1 os fecha.

## Context

**Evidência motivadora.** A literatura recente (2025-2026) mostra que o harness contribui mais do que se pensava no resultado final de agents:

- SWE-bench Verified: trocar scaffold com **mesmo modelo** gera swing de até **11pp em GPT-5** e **15pp em Kimi K2** (Epoch AI, 2025).
- SWE-bench Pro com Claude Opus 4.5: Auggie 50.2% vs Claude Code 55.4% — **22pp só de scaffold** (Morph Labs, 2026).
- Para `mesmo Claude Opus 4.6`, leaderboard 2026 mostra variação de **14.7% a 72.0%** apenas trocando o scaffold (Awesome Agents).
- Princeton HAL (arXiv:2510.11977, out/2025) consolidou que "agent scaffold afeta drasticamente accuracy e custo".

**Estado atual do `@usetheo/sdk`** (commit `2b7d89a`, branch `feat/sdk-implementation`):

- 166 testes (`tests/golden/**`, `tests/contract/**`, `tests/smoke.test.ts`) — todos verdes.
- Quality gates G1-G10 ativos (`.claude/quality-gates.md`).
- Regra absoluta `no-stubs-no-mocks-no-wired` no código de produção (`.claude/rules/no-stubs-no-mocks-no-wired.md`).
- 25 exemplos end-to-end em `examples/`, alguns rodando contra OpenRouter real.
- Nenhuma régua quantitativa externa: a única validação hoje é "testes passam" + "exemplos rodam" — não há número que diga "o SDK está pronto para usuários".

**O que está faltando.** Falta um sinal objetivo, reproduzível e comparável entre versões para responder: *"este SDK entrega valor em tool-use e multi-turn comparável a alternativas (LangChain, OpenAI Agents SDK, Vercel AI) com o mesmo LLM?"*. Sem essa régua, o lançamento depende de feeling, não de evidência.

**O que NÃO é este plano.** Não é feature de produto exposta no `docs.md`. Não vai gerar API pública. Não é dashboard novo. Não cobre benchmarks pesados (SWE-bench, MLE-bench, OSWorld). Não inclui Inspect AI (Fase 2, plano futuro).

## Objective

Em ≤ 6-8 semanas, ter `pnpm eval:nightly` rodando localmente e em CI, executando o **conjunto completo** de evals do SDK contra um agent baseline (modelo: `claude-sonnet-4-5` via OpenRouter na Fase 1; matriz 3-modelos a partir da Phase 14), gerando JSON estruturado em `evals/results/{timestamp}/`, comparando contra `evals/baselines/{benchmark}.json`, e publicando **relatório de cobertura por capacidade** mapeado contra `docs.md`.

**Metas mensuráveis por capacidade (alinhadas à Coverage Matrix completa):**

| # | Capacidade | Sinal de maturidade | Fase |
|---|---|---|---|
| 1 | Loop básico `Agent.send` | BFCL v3 score ≥ baseline | 1-2 |
| 2 | Tool-use estruturado | BFCL v3 by_category todos ≥ baseline | 2 |
| 3 | Multi-turn com tool_calls history | τ²-retail pass_rate ≥ baseline | 3 |
| 4 | Memory (file manager + recall + search + dreaming + active) | LoCoMo-like score + suite E2E binária | 6 |
| 5 | Context manager (file sources + snapshot) | NIAH adaptado pass_rate ≥ 0.9 | 7 |
| 6 | MCP servers (stdio + http) | Suite E2E binária com 3 servidores oficiais | 8 |
| 7 | Hooks (pre/post tool, pre/post message) | Suite comportamental: hook fired = expected | 9 |
| 8 | Skills (frontmatter + auto-inject) | Suite comportamental: agent menciona skill por nome | 10 |
| 9 | Subagents (parent/child collab) | Delta de score em HumanEval com/sem subagents | 11 |
| 10 | Streaming callbacks (onStep / onDelta) | TTFT < 2s p50; onStep fire count > 0 | 12 |
| 11 | Provider fallback chain | Chaos test: primary 5xx → secondary completes | 13 |
| 12 | Multi-modelo (Claude / GPT / Gemini) | Matriz 3×N publicada em relatório | 14 |
| 13 | Send overrides + Cron + Theokit namespace | Suite E2E binária (não-eval) | 15 |
| 14 | Erros tipados | Contract tests verde para 100% das classes de erro públicas | 15 |
| 15 | Comparação harness × harness (LangChain, OpenAI SDK, Vercel AI) | Adiada para `agentic-eval-bridge-v3` (Inspect AI) | (futuro) |

**Garantias transversais:**

- Custo total por run nightly ≤ US$ 80 (sobe de US$ 30 da v1.1; mensurado por fase no relatório).
- Tempo total CI nightly ≤ 4h (sobe de 90min; cabe no GH Actions free 6h).
- Os 166 testes pré-existentes continuam verdes.
- Zero violações da regra `no-stubs-no-mocks-no-wired` em `packages/sdk/src/`.

## ADRs

### D1 — Bridge externa, fora de `packages/sdk/src/`

**Decision:** Tudo do sistema de eval vive em `evals/` no workspace root, NÃO em `packages/sdk/src/`. Não exportado pelo `@usetheo/sdk`. Não aparece em `docs.md`.

**Rationale:** A regra `no-stubs-no-mocks-no-wired.md` proíbe código de produção não-wired. Bridge HTTP e runners de eval são tooling de QA — se entrassem em `src/`, seriam código órfão (sem caller real no contrato público). Manter fora do bundle também evita inflar o tamanho do SDK publicado no npm. KISS: o bridge é um servidor independente, não uma abstração interna do SDK.

**Consequences:** Permite usar dependências pesadas (Python via subprocess, fastify, etc.) sem afetar o bundle. Bridge pode evoluir independentemente do versionamento do SDK. Custo: o bridge depende de imports de `@usetheo/sdk` via workspace path, então quebras de API do SDK quebram o bridge — coberto pelo CI.

### D2 — Bridge em TypeScript, runners de benchmark em Python

**Decision:** O servidor OpenAI-compatible que envelopa o `Agent` é TypeScript puro (Node 22+, sem build, executado via `tsx`). Os runners de benchmark (BFCL, τ²) são consumidos como ferramentas Python existentes via `pip install` + subprocess.

**Rationale:** O agent vive no ecossistema Node — invocá-lo via subprocess Python seria absurdo. Os benchmarks vivem no ecossistema Python — reimplementá-los em TS violaria a regra "não reinvente". Bridge HTTP entre os dois ecossistemas é desacoplamento natural e respeita as fronteiras. Rejeitado: porting de BFCL/τ² para TS (escopo absurdo) e wrapping do `Agent` em Python via FFI (frágil, sem precedente). HTTP é trivial, debugável, e ambos os runners já suportam `--api-base` apontando para qualquer endpoint OpenAI-compatible.

**Consequences:** CI precisa de Python 3.10+ em paralelo a Node 22+. Runtime ganha um dependency footprint Python (`bfcl-eval`, `tau2-bench` — ambos pip-installable). Bridge precisa serializar tool calls fielmente ao formato OpenAI. Cold-start do CI fica em torno de 60-90s (npm install + pip install).

### D3 — `node:http` nativo, sem framework HTTP

**Decision:** Bridge usa apenas `node:http` da stdlib. Sem fastify, sem express, sem hono.

**Rationale:** KISS + YAGNI. O bridge tem **um endpoint** (`POST /v1/chat/completions`) + health check. Trazer framework para 1 rota é overkill e adiciona dependência sem benefício. Roteamento e parsing de JSON cabem em ~50 linhas. Rejeitado: fastify (precisaria justificar peer dep), hono (ótimo, mas excessivo aqui).

**Consequences:** Zero novas deps no `package.json` root. Código do bridge fica trivialmente auditável. Se no futuro precisarmos de SSE/streaming, migramos para hono em < 1h.

### D4 — BFCL v3 primeiro, τ²-bench em sequência

**Decision:** Phase 2 = BFCL v3 (tool-calling estruturado). Phase 3 = τ²-bench/retail (multi-turn). Ambas obrigatórias, mas BFCL não bloqueia τ² após o bridge estar pronto.

**Rationale:** BFCL é o caminho mais barato e direto para validar o bridge: ~US$ 5-15 por run, formato de input/output bem documentado, leaderboard ativo (Berkeley Gorilla). Se a bridge serializa tool_calls errado, BFCL descobre primeiro. τ²-bench é mais valioso (multi-turn real) mas mais caro (~US$ 20-30) e exige user simulator — vale rodar após BFCL passar. Rejeitado: começar por τ² (risco de gastar mais sem validar o canal). Rejeitado: pular BFCL (perde uma medida ortogonal e barata).

**Consequences:** Phase 2 e Phase 3 são paralelizáveis após Phase 1 (bridge). Falha em qualquer um isola o problema (BFCL = serialização de tools; τ² = orquestração multi-turn).

### D5 — Modelo único na Fase 1: `anthropic/claude-sonnet-4-5` via OpenRouter

**Decision:** A Fase 1 roda apenas com **um modelo** (`anthropic/claude-sonnet-4-5` via OpenRouter, mesmo provider que os exemplos usam hoje). Comparações multi-modelo (Claude × GPT × Gemini) ficam para Fase 2 (plano futuro com Inspect AI).

**Rationale:** YAGNI. Resolver "isso funciona end-to-end com um modelo" antes de "isso funciona com N modelos". Custo controlado. Provider já configurado no SDK e nos exemplos — sem nova infraestrutura. A pergunta "harness vs modelo" precisa de matriz 3×3, mas isso é Fase 2 — Fase 1 estabelece o baseline.

**Consequences:** A Fase 1 não responde "qual modelo é melhor com o SDK". Responde "o SDK funciona com o melhor modelo disponível, num número objetivo". Suficiente para gate de maturidade pré-launch.

### D6 — Baseline congelado em Git, resultados em diretório ignorado

**Decision:** `evals/baselines/{benchmark}.json` é versionado (commit explícito). `evals/results/{timestamp}/` está em `.gitignore`. CI publica resultados como artifact (não commit).

**Rationale:** Baseline é fonte de verdade comparativa — precisa estar no histórico para auditoria. Resultados nightly são logs efêmeros (centenas de runs por mês) — poluem o repo se commitados. Rejeitado: commitar tudo (repo enche rápido). Rejeitado: tudo em external storage (complexidade desnecessária na Fase 1).

**Consequences:** Atualizar baseline = PR explícito com diff visível. Quem aprova vê o número antes/depois. Resultados ficam disponíveis no GitHub Actions por 90 dias (default).

### D7 — Gate "score >= baseline - 2pp" apenas em nightly, não em PR

**Decision:** Workflow PR roda só `pnpm test` + `pnpm typecheck` + `pnpm build` (como hoje). Workflow nightly roda evals e falha se score cair mais que 2pp vs baseline.

**Rationale:** Custo: rodar BFCL+τ² em todo PR seria ~US$ 30 × PRs/dia. Velocidade: nightly é assíncrono, não bloqueia merge. Sinal: regressão real aparece em 24h, não em meses. Rejeitado: gate em PR (custo). Rejeitado: sem gate nenhum (perde valor do baseline). 2pp tolera ruído estatístico esperado em LLM (modelos não-determinísticos mesmo com temp=0).

**Consequences:** Regressões cabeçudas que afetam mais de 2pp são pegas em ≤ 24h. Regressões sutis (< 2pp) escapam até a próxima atualização de baseline — risco aceitável dado o custo.

### D8 — Inspect AI fica fora deste plano (Fase 2 futura)

**Decision:** Adoção de Inspect AI como orquestrador unificado fica para um plano separado, após Fase 1 completar.

**Rationale:** Inspect AI permite comparações cabeça-a-cabeça `@usetheo/sdk` × LangChain × OpenAI Agents SDK no mesmo benchmark — mas isso é Fase 2 (diferenciação competitiva). Fase 1 é gate de maturidade interna: precisamos do número primeiro. Adicionar Inspect AI aqui infla escopo de 2 semanas para 1-2 meses. YAGNI: o problema de Fase 1 é "o SDK está maduro?", não "o SDK ganha de LangChain?".

**Consequences:** Fase 1 fica focada e entregável. Fase 2 (Inspect AI + matriz 3×3×2) ganha plano próprio com escopo claro. Risco: investir em runners proprietários (BFCL/τ² wrappers) que depois sejam substituídos por Inspect AI — mitigado: BFCL e τ² já rodam nativamente dentro do Inspect AI; o investimento em "rodar contra a bridge" não se perde.

### D9 — Evals são stateless: bridge nunca passa `memory` nem `context`

**Decision:** O `agent-factory.ts` sempre instancia `Agent.create()` com `memory: undefined` e `context: undefined`. Cada request começa do zero, sem persistência entre requests.

**Rationale:** Reportado em edge case review (EC-1). `node:http` atende requests concorrentes; τ² amplifica isso porque usa o **mesmo bridge** para agent E user simulator simultaneamente. Se dois Agents concorrentes compartilharem `.theokit/memory/`, há corrupção de write e contaminação cross-task — facts de uma task vazam para outra, falsificando os scores. Evals por definição precisam ser stateless e reproduzíveis: a única state legítima é a do próprio histórico de mensagens no request (vide D10). Rejeitado: passar memória per-request com paths únicos por UUID — adiciona I/O sem benefício (eval não usa recall entre requests) e arrisca lixo em disco.

**Consequences:** Bridge NÃO pode ser usada para benchmarks que exijam memória persistente entre conversas (não há ainda). Quando/se surgir, criar variante explícita do factory. Memória e context são features do SDK que ficam fora do que este plano mede — gap conhecido e documentado.

### D10 — Translate.ts preserva histórico de tool calls e tool results no INPUT

**Decision:** `translateRequest` mapeia integralmente o histórico de mensagens OpenAI — incluindo `{ role: "assistant", tool_calls: [...] }` e `{ role: "tool", tool_call_id, content }` — para o shape do `Agent.send({ messages })`.

**Rationale:** Reportado em edge case review (EC-2). BFCL categoria `multi_turn` e todo τ²-bench mandam histórico contendo turns anteriores com tool calls + tool results. Sem mapear isso, o agent perde o contexto da conversa e responde como se fosse o primeiro turn — colapsa esses benchmarks para ~0% e inutiliza o coração do plano. Rejeitado: ignorar mensagens com tool_calls — destrói o benchmark. Rejeitado: rejeitar request com 501 — torna esses runners impossíveis.

**Consequences:** `translate.ts` ganha lógica para 3 shapes adicionais (assistant com tool_calls; tool role; sequência canônica assistant→tool→assistant). Adiciona ≥ 2 testes ao TDD (EC-2 abaixo). Dependência: shape exato do `Agent.send({ messages })` do SDK precisa ser checado em `docs.md` e `packages/sdk/src/types/agent.ts` durante implementação.

### D11 — Três camadas de eval: padrão externo, mini-benchmark proprietário, E2E binário

**Decision:** Capacidades do SDK são classificadas em três categorias de eval, cada uma com técnica própria:
- **Camada A (benchmark padrão):** tool-use (BFCL), multi-turn (τ²), memory (LoCoMo), context (NIAH adaptado), subagents (HumanEval delta). Score numérico vs baseline.
- **Camada B (mini-benchmark proprietário):** hooks, skills, MCP, fallback. Suite de 5-15 fixtures comportamentais com assertion binária; "score" = % de fixtures aprovadas.
- **Camada C (E2E binário):** Cron, Theokit namespace, send overrides, erros tipados. Não é eval — é contract test que passa ou falha.

**Rationale:** Forçar tudo em "score 0-1" levaria a comparações falsas (medir hooks com um número é arbitrário) ou a inventar benchmarks duvidosos para capacidades que não têm literatura. KISS: deixar cada coisa medida pela técnica certa. Honestidade: o relatório final mostra **camadas separadas** — leitor entende que "MCP score 100%" e "BFCL score 82.3%" são tipos diferentes de sinal.

**Consequences:** Bridge é a mesma para Camadas A e B (ambas batem em `/v1/chat/completions`). Camada C dispensa bridge — chama API do SDK diretamente em testes vitest dedicados. Relatório agregado precisa de seções por camada. Custo: relatórios mais ricos, mas leitura mais honesta.

### D12 — Memory: LoCoMo como benchmark padrão + suite E2E para Active Memory

**Decision:** Phase 6 mede memory em duas frentes complementares: (a) **LoCoMo** (Long-Conversation Memory, Park et al. 2024) — benchmark padrão da literatura para recall em conversas longas, com runner Python OpenAI-compatible; (b) **Suite E2E proprietária** para Active Memory, Dreaming, Memory Search — capacidades exclusivas do SDK não cobertas por benchmark padrão.

**Rationale:** Memory é o diferencial mais cobrado da v1 (vide `examples/memory*`). LoCoMo dá número comparável à literatura. Mas Active Memory (auto-write entre runs) e Dreaming (consolidação) são features proprietárias — precisam de fixture comportamental ("agent 1 fala fato X; agent 2 no mesmo workspace lembra do fato X"). Rejeitado: confiar só em LoCoMo (não cobre 60% da surface de memory). Rejeitado: só E2E proprietário (perde sinal comparável a outros harnesses).

**Consequences:** Phase 6 vira a maior do plano (3 tasks). Runner LoCoMo + suite E2E. Custo: ~US$ 15/run para LoCoMo + ~US$ 5 para E2E. Risco aceito: LoCoMo é benchmark recente (2024-2025) — pode mudar shape. Pin exato no `requirements.txt`.

### D13 — Streaming, MCP e hooks: bridge precisa de extensões (não basta `/v1/chat/completions`)

**Decision:** Phase 8 (MCP), Phase 9 (hooks), Phase 12 (streaming) requerem extensões à bridge:
- **MCP:** bridge aceita parâmetro `_theokit_mcp` no body OpenAI que NÃO é OpenAI-padrão. Mapeado para `Agent.create({ mcpServers: [...] })`. Tolerado porque BFCL/τ² ignoram campos desconhecidos.
- **Hooks:** mesma técnica — `_theokit_hooks` no body.
- **Streaming:** novo endpoint `POST /v1/chat/completions` com header `Accept: text/event-stream` retorna SSE conforme spec OpenAI; também emite custom event `theokit.step` por callback `onStep`.

**Rationale:** Camadas B e C precisam medir capacidades que não fazem parte do request OpenAI canônico. Reproduzir o input model via campo extra (`_theokit_*`) é mais simples que criar endpoint paralelo. Streaming SSE é parte do contrato OpenAI — não é extensão, é completude.

**Consequences:** Bridge ganha ~80 linhas adicionais. Documentar campos `_theokit_*` no `evals/README.md`. Risco: usuário tenta usar a bridge fora do contexto de eval e bate em campo extra — mitigado: bridge só roda em `localhost`, sem deploy público.

### D14 — Hooks/Skills/Subagents/MCP: mini-suites com matriz fixa de fixtures

**Decision:** Mini-suites (Camada B) são fixtures versionadas em `evals/suites/{capability}/cases/*.json`. Cada caso tem: `name`, `setup` (config do agent), `prompt`, `assert` (regex / contains / tool_called / function da JS). Suite runner (Node, ~150 linhas) executa cada caso, conta pass/fail, gera `summary.json` no mesmo formato dos benchmarks padrão (`{ pass_rate, by_category, num_cases }`).

**Rationale:** Não há benchmark padrão de "agent invoca hook X corretamente". Construir benchmark grande do zero seria YAGNI: 10-15 fixtures por capacidade cobrem 80% da surface. JSON declarativo facilita adicionar casos sem mexer no runner. Rejeitado: usar vitest direto (mistura "teste de integração" com "eval" e suja a suite de testes do SDK). Rejeitado: framework de eval externo (DeepEval, etc.) — adicionaria dep só para 4 suites simples.

**Consequences:** Cada Phase 8-11 ganha task de "definir N fixtures" + task de "implementar suite runner" + task de "rodar e congelar baseline". Runner é compartilhado entre as 4 suites (reutilização). Custo: ~US$ 2-5 por suite por run.

### D15 — Phase 14 (matriz multi-modelo) congelada como gate antes do lançamento

**Decision:** A matriz 3 modelos × N benchmarks (Phase 14) é executada **uma vez por release**, não em CI nightly. Resultado vira tabela publicada no README do SDK no momento do lançamento. CI nightly continua com 1 modelo.

**Rationale:** Matriz 3×N custa ~US$ 240/run (3x do nightly), excessivo para CI diário. Mas o número de marketing/maturidade ("o SDK funciona com Claude, GPT e Gemini") precisa estar congelado e auditável antes do launch. Roda manualmente via `pnpm eval:matrix` quando o time decide; resultado vira artifact + linha no README.

**Consequences:** Phase 14 entrega script + procedimento documentado, NÃO entrega CI automático. Aceitável para o objetivo de gate de lançamento (Phase 14 só precisa rodar uma vez antes do release real).

### D16 — Cron, Theokit namespace, Send overrides, Erros tipados: contract tests em vitest, não eval

**Decision:** Phase 15 NÃO usa bridge nem runners Python. Implementa contract tests em `evals/contract/*.test.ts` (vitest reutilizando o workspace SDK) que: cria Cron, lista, deleta; chama `Theokit.me()`, `Theokit.models.list()`, `Theokit.repositories.list()`; envia request com `model` override no `send()`; asserta que cada classe de erro pública (`TheokitAgentError` e descendentes) é lançada nos cenários documentados em `docs.md`.

**Rationale:** Não são capacidades agentic — não fazem sentido em benchmark com score. São contratos de API que precisam funcionar. Contract test em vitest é a ferramenta certa (KISS). Rejeitado: forçar via bridge — não há "prompt" para Cron.list ou Theokit.me. Rejeitado: ignorar essas capacidades — fariam parte do "TODO o sistema" se omitidas.

**Consequences:** Phase 15 não roda no nightly do bridge (rápido demais — vitest já está no `pnpm test`). Vira parte de `pnpm test` regular com flag `EVAL_CONTRACT=1` para incluir casos que requerem `OPENROUTER_API_KEY` (`Theokit.me()` real). Custo zero em tokens (chamadas a catálogo/list não consomem LLM).

### D18 — Execução de código gerado em HumanEval requer Docker sandbox

**Decision:** Phase 11 (HumanEval ablation) executa código gerado pelo LLM **exclusivamente dentro de container Docker descartável** (`python:3.11-slim`), com: timeout 30s por problema, sistema de arquivos read-only exceto `/tmp` (tmpfs), sem rede, com kill aggressive (`docker run --rm --network none --read-only --tmpfs /tmp --memory 512m --pids-limit 64`).

**Rationale:** Reportado em edge case review (EC-19). HumanEval = 164 problemas com código gerado por LLM. Executar diretamente no host CI tem dois riscos: (a) segurança — código pode invocar `os.system`, escrever em paths sensíveis, abrir conexões; (b) confiabilidade — loop infinito ou alocação descontrolada trava o runner. Modelos médios geram loops infinitos em ~5% dos problemas — não é teórico. Rejeitado: confiar no sandbox built-in do `humaneval-bench` (algumas versões não isolam adequadamente); rejeitado: restricted Python (`RestrictedPython`) — covers menos do que Docker e quebra problemas que usam imports padrão.

**Consequences:** CI runner precisa Docker (GitHub Actions ubuntu-latest tem por padrão; macOS runner precisaria Colima). Cada problema custa overhead de ~0.5s para `docker run`; 164×2 = 328 invocations = ~3min extra. Custo zero em tokens (containers são free).

### D17 — Adiamento explícito de Cloud / PaaS, Resume cross-process, AppendMessage

**Decision:** Capacidades cloud (artifacts, autoCreatePR, envVars, git metadata) e cross-process (`Agent.resume()` entre máquinas) ficam **fora** do v2.0 e documentadas como gap conhecido no relatório de cobertura.

**Rationale:** Cloud depende de Theo PaaS pre-release (root CLAUDE.md confirma estado pre-release 3.49/4.0). Não há ambiente real para testar. Forçar inclusão = stub/mock, viola `no-stubs-no-mocks-no-wired`. Quando TheoCloud for GA, adicionar Phase 16 dedicada.

**Consequences:** Relatório do plano tem seção "Out of scope (documented gap)" listando essas capacidades. Honestidade extrema: o número final de cobertura é "X de Y capacidades **localmente testáveis**", não "X de Y capacidades totais".

## Dependency Graph

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 (BFCL) ──┐
              │              │             │
              │              ▼             ▼
              │          Phase 3 (τ²) ──▶ Phase 4 ──▶ Phase 5 (CI nightly v1)
              │                              │
              ▼                              │
        Phase 1.1 (bridge ext.)              │
              │                              │
              ├──▶ Phase 6 (Memory) ─────────┤
              ├──▶ Phase 7 (Context/NIAH) ───┤
              ├──▶ Phase 8 (MCP) ────────────┤
              ├──▶ Phase 9 (Hooks) ──────────┤
              ├──▶ Phase 10 (Skills) ────────┤
              ├──▶ Phase 11 (Subagents) ─────┤
              ├──▶ Phase 12 (Streaming) ─────┤
              └──▶ Phase 13 (Fallback) ──────┤
                                             ▼
                                       Phase 14 (Matriz multi-modelo)
                                             │
                                             ▼
                                       Phase 15 (Contract tests não-eval)
                                             │
                                             ▼
                                       Phase 16: Dogfood QA Full (MANDATORY)
```

- **Phase 0 → Phase 1**: estrutura antes do bridge.
- **Phase 1 → Phase 1.1**: bridge mínima antes das extensões (campos `_theokit_*` + SSE).
- **Phase 1.1 → Phases 6-13**: extensões habilitam medição de capacidades não-OpenAI-padrão.
- **Phases 6-13 paralelizáveis** entre si após 1.1 (cada uma tem runner/suite isolado).
- **Phases 2-13 → Phase 14**: matriz multi-modelo só faz sentido com todos os benchmarks/suites estáveis.
- **Phase 15 independente** (vitest, sem bridge).
- **Phase 14 + Phase 15 → Phase 16 (Dogfood)**: gate de lançamento final.

**Caminho crítico** (não-paralelizável): 0 → 1 → 1.1 → (qualquer Phase 6-13 — escolhida como mais longa) → 14 → 16. Estimativa: 6-8 semanas se 2 engenheiros paralelizam Phases 6-13. Sequencial: ~14 semanas.

---

## Phase 0: Setup e Estrutura

**Objective:** criar a estrutura de diretórios e scripts pnpm sem implementação ainda — só os esqueletos.

### T0.1 — Criar diretório `evals/` e atualizar `.gitignore`

#### Objective
Estabelecer o layout físico do sistema de eval e marcar caminhos efêmeros como gitignored.

#### Evidence
Nenhum diretório `evals/` existe hoje (`ls` confirmou). Sem estrutura, os arquivos serão criados ad-hoc e divergem.

#### Files to edit
```
evals/README.md                  (NEW) — explica propósito e layout do diretório
evals/bridge/                    (NEW dir) — bridge HTTP TS
evals/runners/                   (NEW dir) — runners Python (scripts shell)
evals/baselines/                 (NEW dir) — baselines JSON versionados
evals/baselines/.gitkeep         (NEW) — força commit do dir vazio
evals/results/                   (NEW dir, gitignored) — outputs por run
evals/scripts/                   (NEW dir) — scripts TS de orquestração
.gitignore                       (EDIT) — adiciona `evals/results/` e `evals/.venv/`
```

#### Deep file dependency analysis
- `.gitignore` hoje já cobre `node_modules`, `dist`, `.env` — basta apêndice.
- Nada referencia `evals/` ainda, então criação é puro greenfield.
- Downstream: todas as fases subsequentes referenciam esses caminhos.

#### Deep Dives
Layout final esperado:
```
evals/
├── README.md
├── bridge/
│   ├── server.ts
│   ├── translate.ts
│   └── package.json (workspace member? — ver T0.2)
├── runners/
│   ├── bfcl-v3.sh
│   └── tau2-retail.sh
├── baselines/
│   ├── bfcl-v3.json     (commitado após Phase 4)
│   └── tau2-retail.json (commitado após Phase 4)
├── results/             (gitignored)
└── scripts/
    ├── compare.ts
    └── report.ts
```

#### Tasks
1. Criar `evals/` com `mkdir -p` para todos os subdirs.
2. Escrever `evals/README.md` (≤ 50 linhas) explicando propósito e ponteiros para o plano.
3. Adicionar `.gitkeep` em `evals/baselines/` (mantém dir vazio versionado).
4. Editar `.gitignore` raiz adicionando `evals/results/` e `evals/.venv/`.

#### TDD
```
RED:     N/A — task estrutural sem comportamento testável
GREEN:   N/A
REFACTOR: None expected
VERIFY:  ls -la evals/ && grep -E '^evals/' .gitignore
```

#### Acceptance Criteria
- [ ] `evals/` existe com 5 subdirs (bridge, runners, baselines, results, scripts).
- [ ] `evals/README.md` ≤ 50 linhas, lista os 4 ADRs principais (D1-D4) e aponta para este plano.
- [ ] `evals/baselines/.gitkeep` versionado.
- [ ] `.gitignore` contém `evals/results/` e `evals/.venv/`.
- [ ] `git status` não mostra arquivos não-rastreados em `evals/baselines/`.

#### DoD
- [ ] `ls evals/{bridge,runners,baselines,results,scripts}` retorna OK.
- [ ] `cat .gitignore | grep evals/results` retorna match.
- [ ] Nenhum impacto em `pnpm test` (continua verde).

---

### T0.2 — Adicionar scripts pnpm e workspace config

#### Objective
Expor comandos `pnpm eval:bridge`, `pnpm eval:bfcl`, `pnpm eval:tau2`, `pnpm eval:compare`, `pnpm eval:nightly` no root `package.json`.

#### Evidence
Hoje `package.json` root tem 18 scripts mas nenhum relacionado a eval. Sem entry points, runs futuros viram comandos ad-hoc não-documentados.

#### Files to edit
```
package.json                     (EDIT) — adiciona 5 scripts em `scripts`
pnpm-workspace.yaml              (NÃO editar — evals/ não é workspace TS)
```

#### Deep file dependency analysis
- `package.json` root é minimalista (root é private, agrupa packages/*).
- `pnpm-workspace.yaml` lista só `packages/*`. NÃO adicionar `evals/*` aqui — bridge é script TS executado via `tsx`, não pacote publicável.
- Scripts apontam para arquivos que ainda não existem (criados em Phase 1+). Aceitável — `pnpm run` só falha quando invocado.

#### Deep Dives
Scripts a adicionar (12 scripts cobrindo Phases 1-15):
```json
{
  "eval:bridge": "tsx evals/bridge/server.ts",
  "eval:bfcl": "bash evals/runners/bfcl-v3.sh",
  "eval:tau2": "bash evals/runners/tau2-retail.sh",
  "eval:locomo": "bash evals/runners/locomo.sh",
  "eval:niah": "tsx evals/suites/niah/run.ts",
  "eval:humaneval": "bash evals/runners/humaneval.sh",
  "eval:suite": "tsx evals/suites/runner.ts",
  "eval:compare": "tsx evals/scripts/compare.ts",
  "eval:nightly": "tsx evals/scripts/nightly.ts",
  "eval:matrix": "tsx evals/scripts/matrix.ts",
  "eval:report": "tsx evals/scripts/report.ts",
  "test:contract": "pnpm --filter @usetheo/sdk exec vitest run evals/contract/",
  "test:suites": "pnpm --filter @usetheo/sdk exec vitest run evals/suites/tests/"
}
```

Uso de `eval:suite`: aceita argumento posicional indicando qual suite rodar (`pnpm eval:suite memory`, `pnpm eval:suite mcp`, etc.).

`tsx` já está em devDependencies (linha 41 do `package.json` root) — sem nova dep.

#### Tasks
1. Editar `package.json` adicionando os 5 scripts em `scripts`.
2. Verificar com `pnpm run` (lista todos) que aparecem.
3. NÃO criar os arquivos referenciados ainda — Fase 1+.

#### TDD
```
RED:     N/A — config sem comportamento
GREEN:   N/A
REFACTOR: None expected
VERIFY:  pnpm run | grep -E 'eval:(bridge|bfcl|tau2|compare|nightly)'
```

#### Acceptance Criteria
- [ ] 5 scripts pnpm presentes em `package.json` root.
- [ ] `pnpm run` lista todos sob a key correta.
- [ ] `pnpm test` continua verde.
- [ ] `pnpm typecheck` continua verde.

#### DoD
- [ ] `pnpm run eval:bridge` falha com "Cannot find module" (esperado, arquivo ainda não existe — confirma que script está registrado).
- [ ] Nenhum impacto em quality gates G1-G10.

---

## Phase 1: Bridge OpenAI-compatible (TS)

**Objective:** servidor HTTP TS que recebe requisições no formato OpenAI Chat Completions e delega para `Agent.create({...}).send(...)`, devolvendo resposta no formato esperado por BFCL e τ².

### T1.1 — Implementar `evals/bridge/server.ts`

#### Objective
Servidor HTTP mínimo escutando em `localhost:9100` (configurável via `EVAL_BRIDGE_PORT`) que expõe `POST /v1/chat/completions` + `GET /health`.

#### Evidence
Pesquisa confirmou que tanto BFCL v3 (`bfcl-eval`) quanto τ²-bench (`tau2`) aceitam `--api-base http://localhost:9100/v1`. Sem o servidor, nenhum runner pode rodar.

#### Files to edit
```
evals/bridge/server.ts           (NEW) — entry point HTTP
evals/bridge/translate.ts        (NEW) — OpenAI ↔ SDK message translation
evals/bridge/agent-factory.ts    (NEW) — cria Agent por requisição com config padrão
evals/bridge/types.ts            (NEW) — tipos OpenAI minimal (Pydantic-like)
```

#### Deep file dependency analysis
- `server.ts` importa de `@usetheo/sdk` (via workspace path resolution). Mudanças no `Agent.send` API quebram aqui — coberto pelo `pnpm typecheck`.
- `translate.ts` mapeia:
  - Input: `{ messages, tools, model, ...openai_fields }` → `Agent.create({ tools, model, ... })` + `agent.send({ messages })`.
  - Output: `Run` final → `{ choices: [{ message: { role, content, tool_calls } }], usage: { ... } }`.
- `agent-factory.ts` lê env vars (`OPENROUTER_API_KEY`, modelo padrão) e produz `Agent` por request — não pool/reuse na Fase 1 (KISS).
- Downstream: T2.1 e T3.1 dependem do server estar UP.

#### Deep Dives

**Estrutura do server (≤ 200 linhas — sobe de 150 para acomodar fail-fast e EADDRINUSE):**
```ts
import { createServer } from 'node:http';
import { Agent } from '@usetheo/sdk';
import { translateRequest, translateResponse } from './translate.js';
import { buildAgent } from './agent-factory.js';

const PORT = Number(process.env.EVAL_BRIDGE_PORT ?? 9100);

// EC-11: fail fast se API key ausente — não esperar 1ª request
if (!process.env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY missing — bridge cannot serve LLM requests');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }

  let agent: Agent | undefined;
  try {
    const body = await readJson(req); // EC-3: throws BadJsonError → HTTP 400
    const sdkRequest = translateRequest(body); // EC-2: já cobre tool history; throws on stream:true
    agent = await buildAgent({ tools: sdkRequest.tools, model: sdkRequest.model });
    const run = await agent.send({ messages: sdkRequest.messages });
    const openaiResponse = translateResponse(run, body.model);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(openaiResponse));
  } catch (err) {
    const status = err instanceof BadJsonError ? 400 : err instanceof UnsupportedStreamError ? 501 : 500;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: String((err as Error)?.message ?? err) } }));
  } finally {
    // EC-4: dispose error não pode mascarar erro original
    if (agent) await agent.dispose().catch(() => {});
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`port ${PORT} in use — set EVAL_BRIDGE_PORT to override`); // EC-12
    process.exit(2);
  }
  throw err;
});
server.listen(PORT, () => console.log(`bridge :${PORT}`));
```

**Edge cases tratados em `translate.ts`:**
- Tools no formato OpenAI `{ type: 'function', function: { name, parameters } }` → `Agent.create({ tools: [...] })` no formato do SDK.
- **(EC-2 / D10) Histórico com tool calls no INPUT**: mensagens `{ role: "assistant", tool_calls: [...] }` e `{ role: "tool", tool_call_id, content }` mapeadas para o shape correspondente do `Agent.send({ messages })`. Sem isso, BFCL multi_turn e τ² colapsam.
- Tool calls no output: Run pode ter `toolCalls` em `agent_trace` → mapear para `choices[0].message.tool_calls`.
- `usage`: somar `input_tokens + output_tokens` dos eventos do Run.
- Sem streaming na Fase 1 — `stream: true` lança `UnsupportedStreamError` → HTTP 501.

**Invariantes:**
- Server NÃO retém estado entre requests (cada call = novo Agent + dispose).
- **(EC-1 / D9) Cada Agent é stateless**: `agent-factory` força `memory: undefined` e `context: undefined`. Concorrência (BFCL paralelo, τ² agent+user no mesmo bridge) não pode contaminar tasks entre si.
- Sem rate limit interno — o caller controla concorrência.
- Erros do SDK viram HTTP 500 com payload `{ error: { message } }` no formato OpenAI; JSON malformado vira 400; streaming vira 501; port em uso vira exit 2 no startup.

#### Tasks
1. Escrever `types.ts` com interfaces `OpenAIChatRequest`, `OpenAIChatResponse`, `OpenAITool`, e error classes `BadJsonError` + `UnsupportedStreamError`.
2. Escrever `translate.ts` com `translateRequest` e `translateResponse` puras (sem side effects). **Cobrir D10 explicitamente**: parsing de mensagens `assistant`-com-`tool_calls` e `tool`-role do histórico.
3. Escrever `agent-factory.ts` com `buildAgent({ tools, model })` — **passar `memory: undefined` e `context: undefined` sempre (D9)**. Lê apenas `OPENROUTER_API_KEY` e `EVAL_MODEL` do env.
4. Escrever `server.ts` com loop HTTP minimal, **fail-fast em env var ausente (EC-11)** e **handler `error` para EADDRINUSE (EC-12)**.
5. `await agent.dispose().catch(() => {})` no `finally` (EC-4) para evitar leak e preservar erro original.

#### TDD

**Testes de tradução (`translate.test.ts`):**
```
RED:     test_translate_request_basic — converte OpenAI request básica em SDK shape (sem tools)
RED:     test_translate_request_with_tools — função tools mapeadas corretamente
RED:     test_translate_request_with_assistant_tool_calls — (EC-2 / D10) mensagem assistant com tool_calls preservada no histórico do SDK
RED:     test_translate_request_with_tool_role_messages — (EC-2 / D10) mensagem role:"tool" com tool_call_id mapeada para o shape do SDK
RED:     test_translate_response_basic — Run sem tool_calls vira choices[0].message com content
RED:     test_translate_response_with_tool_calls — Run com tool calls vira choices[0].message.tool_calls
RED:     test_translate_response_usage — usage.prompt_tokens + usage.completion_tokens populados
RED:     test_translate_request_rejects_streaming — body.stream=true lança UnsupportedStreamError
```

**Testes de factory (`agent-factory.test.ts`):**
```
RED:     test_factory_omits_memory — (EC-1 / D9) buildAgent NÃO passa memory para Agent.create (asserta options.memory === undefined)
RED:     test_factory_omits_context — (EC-1 / D9) buildAgent NÃO passa context para Agent.create
```

**Testes de servidor (`server.test.ts` — usa http supertest contra processo spawnado ou Agent mockado):**
```
RED:     test_server_fails_fast_on_missing_api_key — (EC-11) sem OPENROUTER_API_KEY, server.ts exit 1 antes de listen
RED:     test_server_reports_port_conflict — (EC-12) EADDRINUSE log claro + exit 2
RED:     test_server_rejects_invalid_json — (EC-3) POST com body "{not valid" → HTTP 400, payload OpenAI-shaped
RED:     test_server_preserves_error_when_dispose_fails — (EC-4) Agent mock cujo send=erroA e dispose=erroB → resposta contém erroA
RED:     test_server_handles_concurrent_requests — (EC-5) 10 requests paralelos retornam 200 sem cross-contamination de tool_calls; correlação id↔resposta preservada
```

```
GREEN:   Implementar translate.ts, agent-factory.ts e server.ts cobrindo todos os RED tests acima
REFACTOR: extrair helpers se duplicação aparecer (KISS — provavelmente nenhuma na Fase 1)
VERIFY:  pnpm --filter @usetheo/sdk exec vitest run evals/bridge/tests/
```

Nota: tests do bridge vivem em `evals/bridge/tests/` e rodam via `vitest` invocado pelo workspace SDK (mais simples que criar workspace separado para evals).

#### Acceptance Criteria
- [ ] `pnpm eval:bridge` inicia servidor em `:9100` em ≤ 1s.
- [ ] **(EC-11)** Sem `OPENROUTER_API_KEY` no env, `pnpm eval:bridge` exit 1 imediatamente com mensagem clara.
- [ ] **(EC-12)** Com `:9100` já em uso, `pnpm eval:bridge` exit 2 com hint `EVAL_BRIDGE_PORT`.
- [ ] `curl http://localhost:9100/health` retorna `{"status":"ok"}`.
- [ ] `curl -X POST http://localhost:9100/v1/chat/completions -d '{...}'` retorna 200 com resposta OpenAI-shaped real do Claude (via OpenRouter).
- [ ] `tools` no request são repassadas ao `Agent.create()`.
- [ ] **(EC-2)** Request com histórico contendo `assistant`/`tool_calls` + `tool`-role retorna resposta coerente com o histórico (asserção via prompt fixture: "what was my previous tool call?" responde corretamente).
- [ ] `tool_calls` no response são populados quando o modelo invoca tools.
- [ ] Streaming (`stream: true`) retorna HTTP 501.
- [ ] JSON malformado retorna HTTP 400 (não 500).
- [ ] **(EC-1)** Factory inspecionado por teste confirma `memory: undefined` e `context: undefined`.
- [ ] Pass: `pnpm test` continua verde em packages/sdk.
- [ ] Pass: `pnpm typecheck` verde.
- [ ] Pass: `pnpm check` (Biome lint) verde.
- [ ] LoC: cada arquivo do bridge ≤ 200 linhas (KISS).

#### DoD
- [ ] Todos os testes (`translate.test.ts` + `agent-factory.test.ts` + `server.test.ts`) passam — total ≥ 14 testes RED→GREEN.
- [ ] Smoke manual: `pnpm eval:bridge` + `curl` com payload BFCL-like multi_turn devolve resposta que respeita histórico de tool calls.
- [ ] Smoke manual de concorrência: `ab -n 10 -c 5` (ou equivalente) retorna 10x 200 sem contaminação cruzada.
- [ ] Zero novas dependências no `package.json` (D3).
- [ ] `pnpm quality:dead` (knip) não acusa código órfão.

---

## Phase 2: Runner BFCL v3

**Objective:** script que roda `bfcl-eval` contra a bridge e produz `evals/results/{timestamp}/bfcl-v3.json` estruturado.

### T2.1 — Implementar `evals/runners/bfcl-v3.sh`

#### Objective
Script shell que (1) garante venv Python + `bfcl-eval` instalado, (2) verifica que bridge está UP, (3) roda BFCL v3 nas categorias `simple`, `multiple`, `parallel`, `multi_turn`, (4) move resultados para `evals/results/{timestamp}/bfcl-v3/`.

#### Evidence
BFCL v3 docs (Berkeley Gorilla) confirmam que `bfcl-eval` aceita `--api-base` + `--model`. Sem o script, runs são manuais e não-reproduzíveis.

#### Files to edit
```
evals/runners/bfcl-v3.sh         (NEW) — orquestração shell
evals/runners/requirements.txt   (NEW) — pip deps (bfcl-eval, etc.)
evals/runners/.venv-setup.sh     (NEW) — cria venv e instala deps idempotentemente
```

#### Deep file dependency analysis
- `bfcl-v3.sh` invoca `.venv-setup.sh` no início (idempotente — se venv existe, skip).
- `requirements.txt` lista `bfcl-eval>=3.0.0` (versão atual da Berkeley).
- Downstream: T4.1 (comparator) consome o JSON produzido.
- Risco: BFCL pode mudar formato do JSON entre minor versions — pinar versão exata.

#### Deep Dives

**Estrutura do script (≤ 120 linhas — sobe de 100 para acomodar timeout):**
```bash
#!/usr/bin/env bash
set -euo pipefail

EVAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP="${EVAL_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
RESULT_DIR="$EVAL_DIR/results/$TIMESTAMP/bfcl-v3"
BRIDGE_URL="${EVAL_BRIDGE_URL:-http://localhost:9100/v1}"
MODEL="${EVAL_MODEL:-anthropic/claude-sonnet-4-5}"
BFCL_TIMEOUT="${EVAL_BFCL_TIMEOUT:-30m}"  # EC-9: previne travas em multi_turn

mkdir -p "$RESULT_DIR"
bash "$EVAL_DIR/runners/.venv-setup.sh"
source "$EVAL_DIR/.venv/bin/activate"

curl -sf "$BRIDGE_URL/health" >/dev/null \
  || { echo "bridge not running at $BRIDGE_URL"; exit 2; }

# EC-9: timeout dá exit 124 se BFCL travar
timeout "$BFCL_TIMEOUT" bfcl generate \
  --model "$MODEL" \
  --test-category simple,multiple,parallel,multi_turn \
  --api-base "$BRIDGE_URL" \
  --api-key "${OPENROUTER_API_KEY:-dummy}" \
  --result-dir "$RESULT_DIR/raw"

bfcl evaluate --result-dir "$RESULT_DIR/raw" --output "$RESULT_DIR/summary.json"
echo "bfcl-v3 done -> $RESULT_DIR/summary.json"
```

**Estrutura do `.venv-setup.sh` (≤ 40 linhas — cobre EC-10):**
```bash
#!/usr/bin/env bash
set -euo pipefail

EVAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$EVAL_DIR/.venv"

# EC-10: detecta venv corrompido e recria
if [ ! -x "$VENV/bin/python" ] || [ ! -x "$VENV/bin/pip" ]; then
  rm -rf "$VENV"
fi

if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
fi

"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r "$EVAL_DIR/runners/requirements.txt"
```

**Edge cases:**
- Bridge não está UP → exit 2 com mensagem clara.
- `OPENROUTER_API_KEY` ausente → bridge nem inicia (EC-11 em T1.1). Runner detecta via `curl /health`.
- **(EC-9)** BFCL trava em `multi_turn` → `timeout 30m` exit 124, script falha rápido em vez de queimar CI 90min.
- **(EC-10)** Venv parcial após interrupção anterior → setup detecta `python` ausente e recria do zero.
- Categoria nova no BFCL não suportada → log warning, continua com as 4 conhecidas.

**Invariantes:**
- Idempotência: rodar duas vezes seguidas com mesmo `EVAL_TIMESTAMP` sobrescreve sem corromper.
- Idempotência do venv: `.venv-setup.sh` executado N vezes em sequência produz o mesmo estado (sem reinstalar se cache válido).
- Output em JSON único `summary.json` com schema `{ overall: number, by_category: { simple: number, ... } }`.

#### Tasks
1. Escrever `.venv-setup.sh` com **detecção de venv corrompido (EC-10)** — checar `bin/python` + `bin/pip` antes de reutilizar.
2. Escrever `requirements.txt` pinado: `bfcl-eval==3.0.x`.
3. Escrever `bfcl-v3.sh` com **`timeout 30m` wrapping o `bfcl generate` (EC-9)**.
4. Tornar ambos executáveis: `chmod +x`.
5. Validar manualmente com bridge UP e API key real.

#### TDD
```
RED:     evals/runners/tests/test_bfcl_script.sh — script roda sem erros com bridge mock retornando respostas fixas (smoke)
RED:     test_bfcl_script.sh::no_bridge — script exit 2 quando bridge offline
RED:     test_venv_setup_recreates_corrupted — (EC-10) apagar evals/.venv/bin/python e re-rodar setup recria venv do zero (asserta python funcional após)
RED:     test_venv_setup_idempotent — duas execuções consecutivas não reinstalam (assert via mtime)
GREEN:   Implementar scripts cobrindo os RED tests
REFACTOR: None expected
VERIFY:  bash evals/runners/tests/test_bfcl_script.sh && bash evals/runners/tests/test_venv_setup.sh
```

Nota: TDD shell-script é leve (testes são scripts que invocam o sob teste com fixtures). Aceitável dado que o trabalho real do runner é externo (BFCL Python).

#### Acceptance Criteria
- [ ] `pnpm eval:bridge &` + `pnpm eval:bfcl` produz `evals/results/{timestamp}/bfcl-v3/summary.json` válido.
- [ ] `summary.json` contém keys `overall`, `by_category` com pelo menos 4 categorias.
- [ ] Script falha graciosamente se bridge offline (exit 2, mensagem clara).
- [ ] Idempotência: rodar 2x com mesmo timestamp não corrompe.
- [ ] Custo medido por run: ≤ US$ 15 (anotado no README).
- [ ] Tempo de execução: ≤ 20 min.

#### DoD
- [ ] Smoke run real com OpenRouter: passa, gera summary.json válido.
- [ ] `.venv/` em `evals/` está em `.gitignore` (já coberto por T0.1).
- [ ] Pass: `pnpm test` verde.

---

## Phase 3: Runner τ²-bench (retail)

**Objective:** script equivalente para τ²-bench, domínio `retail` apenas (mais barato e maduro).

### T3.1 — Implementar `evals/runners/tau2-retail.sh`

#### Objective
Script shell que (1) garante venv com `tau2-bench`, (2) verifica bridge UP, (3) roda τ² domínio retail com 50 tasks, (4) produz `tau2-retail/summary.json`.

#### Evidence
τ²-bench (Sierra Research, github.com/sierra-research/tau2-bench) aceita `--api-base` via LiteLLM. Pesquisa confirmou custo ~US$ 20-30 por domínio em Claude Sonnet-class.

#### Files to edit
```
evals/runners/tau2-retail.sh     (NEW) — orquestração shell
evals/runners/requirements.txt   (EDIT) — adiciona tau2-bench
```

#### Deep file dependency analysis
- Reusa `.venv-setup.sh` da T2.1 (mesmo venv, deps adicionadas).
- Downstream: T4.1 (comparator).
- `tau2-bench` consome user simulator embutido — sem dependência adicional.

#### Deep Dives

**Estrutura (≤ 100 linhas):**
```bash
#!/usr/bin/env bash
set -euo pipefail

EVAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP="${EVAL_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
RESULT_DIR="$EVAL_DIR/results/$TIMESTAMP/tau2-retail"
BRIDGE_URL="${EVAL_BRIDGE_URL:-http://localhost:9100/v1}"
MODEL="${EVAL_MODEL:-anthropic/claude-sonnet-4-5}"

mkdir -p "$RESULT_DIR"
bash "$EVAL_DIR/runners/.venv-setup.sh"
source "$EVAL_DIR/.venv/bin/activate"

curl -sf "$BRIDGE_URL/health" >/dev/null \
  || { echo "bridge not running"; exit 2; }

tau2 run \
  --domain retail \
  --agent-model "$MODEL" \
  --user-model "$MODEL" \
  --agent-api-base "$BRIDGE_URL" \
  --user-api-base "$BRIDGE_URL" \
  --num-trials 1 \
  --output-dir "$RESULT_DIR/raw"

python3 "$EVAL_DIR/runners/tau2-summarize.py" \
  --input "$RESULT_DIR/raw" \
  --output "$RESULT_DIR/summary.json"
```

**Edge cases:**
- τ² usa LiteLLM internamente — flag `--agent-api-base` injeta `OPENAI_API_BASE`.
- Tasks podem timeout — `tau2` lida internamente; summarizer marca como `fail`.

**Invariantes:**
- `summary.json` shape: `{ pass_rate: number, pass_at_1: number, num_tasks: number, total_cost_usd: number }`.

#### Tasks
1. Adicionar `tau2-bench>=2.0.0` ao `requirements.txt`.
2. Escrever `tau2-retail.sh`.
3. Escrever `tau2-summarize.py` (script Python ≤ 50 linhas que reduz outputs raw a summary.json).
4. `chmod +x`.

#### TDD
```
RED:     evals/runners/tests/test_tau2_summarize.py — agrega 3 fixtures de output raw em summary com pass_rate correto
RED:     test_tau2_summarize.py::handles_partial_failures — uma task com error vira fail no count
GREEN:   Implementar tau2-summarize.py
REFACTOR: None expected
VERIFY:  python3 -m pytest evals/runners/tests/test_tau2_summarize.py
```

#### Acceptance Criteria
- [ ] `pnpm eval:tau2` produz `evals/results/{timestamp}/tau2-retail/summary.json`.
- [ ] Schema: `pass_rate`, `pass_at_1`, `num_tasks`, `total_cost_usd` presentes.
- [ ] Custo medido: ≤ US$ 30 por run.
- [ ] Tempo: ≤ 45 min.
- [ ] Bridge offline → exit 2.

#### DoD
- [ ] Smoke run real: gera summary válido.
- [ ] Pass: `pnpm test` verde (testes Python rodam separadamente).

---

## Phase 4: Baseline + Comparator + Relatório

**Objective:** mecanismo de comparar resultado atual vs baseline e produzir relatório markdown legível.

### T4.1 — Implementar `evals/scripts/compare.ts`

#### Objective
Script TS que (1) lê `evals/results/{latest}/{benchmark}/summary.json`, (2) lê `evals/baselines/{benchmark}.json`, (3) calcula delta, (4) imprime tabela e exit 1 se delta < -2pp.

#### Evidence
Sem comparador, regressões passam despercebidas — defeating o propósito do baseline (D6). Threshold 2pp justificado em D7.

#### Files to edit
```
evals/scripts/compare.ts         (NEW) — comparador
evals/scripts/types.ts           (NEW) — schemas BfclSummary, Tau2Summary, BaselineEntry
```

#### Deep file dependency analysis
- Lê JSON de paths definidos em T2.1 e T3.1.
- Downstream: T4.2 (relatório) e T5.1 (CI nightly) consomem o exit code.

#### Deep Dives

**Algoritmo:**
1. Resolver `latest` em `evals/results/` (maior timestamp).
2. **(EC-8)** Usar o MESMO timestamp `latest` para todos os benchmarks. Se um benchmark esperado não existe em `latest/{bench}/`, reportar como `missing` — NÃO procurar em timestamps anteriores.
3. Para cada benchmark esperado (`bfcl-v3`, `tau2-retail`):
   - Carregar `latest/{bench}/summary.json` e `baselines/{bench}.json`.
   - **(EC-6)** `JSON.parse` envolto em try/catch — falha vira `exit 3` com mensagem clara identificando arquivo e benchmark.
   - **(EC-7)** Validar schema antes de comparar — se `score.overall` (BFCL) ou `score.pass_rate` (τ²) ausente no result ou no baseline, `exit 3` apontando a key faltando. NÃO comparar contra `undefined`.
   - Score principal: BFCL=`overall`, τ²=`pass_rate`.
   - delta = (latest - baseline) * 100 (pontos percentuais).
4. Imprimir tabela:
   ```
   Benchmark       Baseline    Latest     Delta
   bfcl-v3         0.823       0.811      -1.2pp
   tau2-retail     0.640       0.590      -5.0pp  ❌
   ```
5. Exit 1 se qualquer delta < -2.0pp. Exit 0 caso contrário.

**Edge cases:**
- Baseline ausente → log warning, treat como "skip", não falha (primeira run).
- Resultado ausente para um benchmark esperado → exit 3 (erro de execução, não regressão).
- **(EC-6)** summary.json inválido → exit 3 com path do arquivo; NÃO degradar silenciosamente para "sem regressão".
- **(EC-7)** Schema incompleto (key faltando) → exit 3 com identificação da key.
- **(EC-8)** Benchmarks em timestamps diferentes → usa apenas o latest, missing vira erro explícito.
- Delta positivo > +5pp → log "improvement detected — consider updating baseline".

#### Tasks
1. Escrever `types.ts`.
2. Escrever `compare.ts` (≤ 150 linhas).
3. Adicionar lógica de "primeira run" (sem baseline = não falha).

#### TDD
```
RED:     evals/scripts/tests/compare.test.ts::test_regression_detected — delta -3pp → exit code 1
RED:     compare.test.ts::test_within_tolerance — delta -1.5pp → exit code 0
RED:     compare.test.ts::test_improvement — delta +5pp → exit code 0, warning log
RED:     compare.test.ts::test_missing_baseline — sem baseline → exit code 0, info log
RED:     compare.test.ts::test_missing_result — sem result → exit code 3
RED:     compare.test.ts::test_malformed_summary_json — (EC-6) summary.json com JSON inválido → exit code 3, mensagem identifica qual benchmark; NÃO mascarar como "sem regressão"
RED:     compare.test.ts::test_baseline_missing_required_keys — (EC-7) baseline sem score.overall (BFCL) ou score.pass_rate (τ²) → exit code 3, log identifica key faltando
RED:     compare.test.ts::test_inconsistent_timestamps — (EC-8) results/ tem t1/bfcl-v3/ e t0/tau2-retail/ (t0<t1); usa t1 para os dois e reporta τ² como "missing" em vez de comparar contra t0
GREEN:   Implementar compare.ts
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/sdk exec vitest run evals/scripts/tests/compare.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm eval:compare` lê automaticamente `latest` em `evals/results/`.
- [ ] Tabela impressa no stdout com colunas Benchmark/Baseline/Latest/Delta.
- [ ] Exit 1 quando delta < -2pp em qualquer benchmark.
- [ ] Exit 0 em primeira run (sem baseline).
- [ ] **(EC-6)** Exit 3 com mensagem clara quando summary.json malformado — testado com fixture corrompida.
- [ ] **(EC-7)** Exit 3 quando key obrigatória faltando em baseline ou result — testado.
- [ ] **(EC-8)** Quando τ² ausente em `latest` mas presente em timestamp anterior, reporta `missing` e exit 3 (não compara contra o run antigo).
- [ ] LoC: `compare.ts` ≤ 180 linhas (sobe de 150 para acomodar validação de schema e tratamento de JSON inválido).

#### DoD
- [ ] 8 testes passam (5 originais + EC-6 + EC-7 + EC-8).
- [ ] Smoke manual com fixtures conhecidas confirma exit codes para os 3 modos de falha.

---

### T4.2 — Congelar baselines iniciais

#### Objective
Após Phase 2 e Phase 3 produzirem 3 runs consecutivos estáveis (variação ≤ 1pp entre runs), congelar a mediana como baseline em `evals/baselines/`.

#### Evidence
Sem baseline, comparator não tem referência. Mediana de 3 runs mitiga ruído de LLM.

#### Files to edit
```
evals/baselines/bfcl-v3.json     (NEW — versionado em commit explícito)
evals/baselines/tau2-retail.json (NEW — versionado em commit explícito)
evals/baselines/README.md        (NEW) — explica como atualizar baseline
```

#### Deep file dependency analysis
- Arquivos pequenos (~10 linhas cada), formato JSON.
- Downstream: T4.1 e T5.1 dependem da existência.

#### Deep Dives

**Schema `bfcl-v3.json`:**
```json
{
  "benchmark": "bfcl-v3",
  "model": "anthropic/claude-sonnet-4-5",
  "captured_at": "2026-05-20T12:00:00Z",
  "sdk_version": "0.0.0",
  "sdk_commit": "abc1234",
  "score": {
    "overall": 0.823,
    "by_category": {
      "simple": 0.94,
      "multiple": 0.86,
      "parallel": 0.78,
      "multi_turn": 0.71
    }
  },
  "cost_usd": 11.40,
  "runs_averaged": 3
}
```

**Schema `tau2-retail.json`:**
```json
{
  "benchmark": "tau2-retail",
  "model": "anthropic/claude-sonnet-4-5",
  "captured_at": "2026-05-20T12:00:00Z",
  "sdk_version": "0.0.0",
  "sdk_commit": "abc1234",
  "score": { "pass_rate": 0.640, "pass_at_1": 0.640 },
  "cost_usd": 27.50,
  "runs_averaged": 3
}
```

#### Tasks
1. Rodar `pnpm eval:bridge` + `pnpm eval:bfcl` 3 vezes consecutivas.
2. Rodar `pnpm eval:tau2` 3 vezes consecutivas.
3. Calcular mediana das 3 runs por categoria.
4. Escrever JSONs em `evals/baselines/`.
5. Escrever `README.md` explicando processo de atualização.
6. Commit explícito separado: `chore(evals): freeze initial baselines for bfcl-v3 + tau2-retail`.

#### TDD
```
RED:     N/A — task de configuração com evidência empírica
GREEN:   N/A
REFACTOR: None expected
VERIFY:  pnpm eval:compare com baselines presentes não acusa regressão
```

#### Acceptance Criteria
- [ ] 3 runs consecutivos com variação ≤ 1pp em cada benchmark.
- [ ] `bfcl-v3.json` e `tau2-retail.json` versionados.
- [ ] README de baselines documenta: quando atualizar, como recalcular, regra de aprovação.
- [ ] `pnpm eval:compare` exit 0 quando rodado contra o run que gerou o baseline.

#### DoD
- [ ] Baselines em Git no commit dedicado.
- [ ] Comparator validado contra ambos.

---

## Phase 5: CI Nightly + Dogfood

**Objective:** workflow GitHub Actions que roda pipeline completo 1x/dia, publica artifact, falha em regressão.

### T5.1 — Workflow `.github/workflows/evals-nightly.yml`

#### Objective
Cron 1x/dia em `feat/sdk-implementation` (e `main` quando aplicável) que: instala deps, inicia bridge, roda BFCL + τ², compara, publica artifact, falha se regressão.

#### Evidence
Sem CI, evals viram trabalho manual e nightly não acontece — perde-se o gate.

#### Files to edit
```
.github/workflows/evals-nightly.yml   (NEW) — workflow YAML
evals/scripts/nightly.ts              (NEW) — orquestração que inicia bridge, roda runners, mata bridge
```

#### Deep file dependency analysis
- Workflow consome scripts pnpm definidos em T0.2.
- `nightly.ts` orquestra: spawn bridge em background → wait health → run bfcl → run tau2 → compare → kill bridge.
- Risco: GitHub Actions free tier tem 6h timeout — pipeline esperado < 1.5h, OK.

#### Deep Dives

**Workflow YAML:**
```yaml
name: Evals Nightly

on:
  schedule:
    - cron: '0 6 * * *'  # 06:00 UTC daily
  workflow_dispatch:

jobs:
  evals:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    env:
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      EVAL_MODEL: anthropic/claude-sonnet-4-5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.15.0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22.12', cache: 'pnpm' }
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm eval:nightly
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: eval-results-${{ github.run_id }}
          path: evals/results/
          retention-days: 90
```

**`nightly.ts` (≤ 220 linhas — sobe de 120 para acomodar continue-on-error e agregação de falhas per EC-21):**

```ts
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z';
process.env.EVAL_TIMESTAMP = TIMESTAMP;
const FAILURES: { runner: string; error: string; durationMs: number }[] = [];

// EC-21: ordem fixa, mas falha em um runner NÃO aborta os outros
const RUNNERS = [
  { name: 'bfcl-v3',       cmd: 'bash evals/runners/bfcl-v3.sh' },
  { name: 'tau2-retail',   cmd: 'bash evals/runners/tau2-retail.sh' },
  { name: 'locomo',        cmd: 'bash evals/runners/locomo.sh' },
  { name: 'niah',          cmd: 'tsx evals/suites/niah/run.ts' },
  { name: 'suite:memory',  cmd: 'pnpm eval:suite memory' },
  { name: 'suite:mcp',     cmd: 'pnpm eval:suite mcp' },
  { name: 'suite:hooks',   cmd: 'pnpm eval:suite hooks' },
  { name: 'suite:skills',  cmd: 'pnpm eval:suite skills' },
  { name: 'humaneval',     cmd: 'bash evals/runners/humaneval.sh' },
  { name: 'suite:streaming', cmd: 'pnpm eval:suite streaming' },
  { name: 'suite:fallback',  cmd: 'pnpm eval:suite fallback' },
];

const bridge = spawn('tsx', ['evals/bridge/server.ts'], { stdio: 'inherit' });
try {
  // wait for health
  for (let i = 0; i < 30; i++) {
    try { execSync('curl -sf http://localhost:9100/health'); break; }
    catch { await sleep(1000); }
  }

  // EC-21: try/catch per runner; nunca aborta sequência
  for (const r of RUNNERS) {
    const start = Date.now();
    try {
      execSync(r.cmd, { stdio: 'inherit' });
    } catch (err) {
      FAILURES.push({
        runner: r.name,
        error: String((err as Error).message ?? err).slice(0, 500),
        durationMs: Date.now() - start,
      });
    }
  }

  // Persist failures regardless of compare outcome
  writeFileSync(
    `evals/results/${TIMESTAMP}/FAILURES.json`,
    JSON.stringify({ run: TIMESTAMP, failures: FAILURES }, null, 2),
  );

  // Compare against baselines (only for runners that succeeded)
  try { execSync('tsx evals/scripts/compare.ts', { stdio: 'inherit' }); }
  catch (err) { FAILURES.push({ runner: 'compare', error: String(err), durationMs: 0 }); }

  // Generate aggregated REPORT.md (always — even partial)
  execSync('tsx evals/scripts/report.ts', { stdio: 'inherit' });
} finally {
  bridge.kill('SIGTERM');
}

// EC-21: exit 1 só no FINAL — depois de rodar tudo
if (FAILURES.length > 0) {
  console.error(`\nNightly completed with ${FAILURES.length} failures:`);
  for (const f of FAILURES) console.error(`  - ${f.runner}: ${f.error}`);
  process.exit(1);
}
```

**Princípio (resolve EC-21):**
- Ordem é fixa, mas independente — falha em runner X não bloqueia X+1.
- Toda falha vai para `FAILURES.json` no diretório de resultados (auditável, persistente).
- `compare.ts` roda contra o que conseguiu rodar (runners ausentes em latest são tratados como missing pelos próprios edges EC-7/EC-8 já cobertos em T4.1).
- `report.ts` gera REPORT.md mesmo com falhas parciais — leitor vê quais fases passaram e quais não.
- Exit 1 ocorre apenas no FINAL, após tudo rodar e relatório ser gerado.

#### Tasks
1. Escrever `nightly.ts` (orquestração).
2. Escrever workflow YAML.
3. Adicionar `OPENROUTER_API_KEY` aos GitHub Secrets do repo (manual, antes de mergear).
4. Testar via `workflow_dispatch` antes de habilitar cron.

#### TDD
```
RED:     evals/scripts/tests/nightly.test.ts::starts_and_kills_bridge — mock spawn confirma sinal SIGTERM enviado mesmo em erro
RED:     nightly.test.ts::test_one_runner_failure_does_not_block_others — (EC-21) bfcl mockado para falhar; tau2/locomo/etc seguem rodando; FAILURES.json contém apenas bfcl
RED:     nightly.test.ts::test_failures_persisted_to_disk — FAILURES.json existe no diretório de resultados com schema { run, failures: [...] }
RED:     nightly.test.ts::test_report_generated_with_partial_results — REPORT.md existe mesmo com falhas; lista runners ausentes
RED:     nightly.test.ts::test_exit_1_only_at_end — runner 1 falha; runners 2-11 ainda executam; processo só exit 1 após o último
GREEN:   Implementar nightly.ts
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/sdk exec vitest run evals/scripts/tests/nightly.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm eval:nightly` funciona localmente.
- [ ] **(EC-21)** Uma falha em runner intermediário NÃO aborta os subsequentes — verificado via teste com bfcl mockado.
- [ ] **(EC-21)** `FAILURES.json` persistido em cada run com schema `{ run, failures: [{ runner, error, durationMs }] }`.
- [ ] **(EC-21)** `REPORT.md` gerado mesmo quando há falhas parciais; lista runners ausentes explicitamente.
- [ ] Workflow `evals-nightly` agendado 06:00 UTC.
- [ ] Workflow `workflow_dispatch` manual testado verde no primeiro dia.
- [ ] Artifact `eval-results-*` publicado com 90 dias retention (inclui FAILURES.json).
- [ ] Workflow falha (exit 1) **apenas no final**, depois de rodar tudo — quando comparator detecta regressão > 2pp OU quando há ≥ 1 falha de runner.

#### DoD
- [ ] Workflow rodou pelo menos 1x verde via `workflow_dispatch`.
- [ ] Smoke manual: matar `bfcl-v3.sh` mid-run (kill -9); nightly continua, FAILURES.json contém bfcl, outros runners completam, REPORT.md tem seção "Partial run".
- [ ] Secret `OPENROUTER_API_KEY` configurado.
- [ ] README de `evals/` atualizado com link para artifacts.

---

### T1.1.b — Extensões da bridge: campos `_theokit_*` + endpoint SSE

#### Objective
Estender a bridge mínima da T1.1 para suportar (a) injeção de configs do SDK via campos não-OpenAI no body (`_theokit_mcp`, `_theokit_hooks`, `_theokit_skills`, `_theokit_subagents`, `_theokit_memory`, `_theokit_context`); (b) endpoint SSE retornando `data:` chunks no formato OpenAI streaming + custom events `theokit.step` quando `_theokit_capture_steps: true`.

#### Evidence
Phases 6-13 precisam medir capacidades que NÃO existem no contrato OpenAI canônico (MCP, hooks, skills, subagents, streaming callbacks). Sem extensões, suites comportamentais (Camada B) ficariam impossibilitadas.

#### Files to edit
```
evals/bridge/server.ts           (EDIT) — adiciona handler streaming + parse de campos _theokit_*
evals/bridge/translate.ts        (EDIT) — extrai _theokit_* do body antes de translateRequest
evals/bridge/agent-factory.ts    (EDIT) — aceita mcpServers, hooks, skills, subagents, memory, context como params
evals/bridge/sse.ts              (NEW)  — writer SSE (≤ 80 linhas)
evals/bridge/types.ts            (EDIT) — adiciona TheokitExtensions interface
```

#### Deep file dependency analysis
- `server.ts` ganha branch para `Accept: text/event-stream` ou `stream: true` → instancia stream writer.
- `agent-factory.ts` deixa de forçar `memory: undefined` quando body explicitamente pede `_theokit_memory: { manager: "file", path: "..." }` — D9 continua válido como **default**, mas é overridable por evals que MEDEM memory (D12 exige isso).
- `sse.ts` é puro writer: recebe Run events, formata como SSE.
- Downstream: Phases 6-13 dependem deste arquivo.

#### Deep Dives

**Schema do body estendido (compatível com OpenAI — campos extras ignorados por clients padrão):**
```ts
interface OpenAIChatRequest {
  model: string;
  messages: Message[];
  tools?: OpenAITool[];
  stream?: boolean;
  // ... outros campos OpenAI
  _theokit_mcp?: McpServerConfig[];
  _theokit_hooks?: HookConfig[];
  _theokit_skills?: SkillConfig[];
  _theokit_subagents?: SubagentConfig[];
  _theokit_memory?: MemoryConfig;
  _theokit_context?: ContextConfig;
  _theokit_capture_steps?: boolean;
}
```

**SSE handler:**
```ts
if (req.headers.accept === 'text/event-stream' || body.stream === true) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const stream = await agent.send({
    messages: sdkRequest.messages,
    onDelta: (d) => writeSSE(res, 'data', deltaToOpenAIChunk(d)),
    onStep: (s) => body._theokit_capture_steps && writeSSE(res, 'theokit.step', s),
  });
  writeSSE(res, 'data', '[DONE]');
  res.end();
  return;
}
```

**Override de defaults:**
- Default (sem `_theokit_*`): factory aplica D9 (memory + context undefined). Mantém Phases 2-3 intactas.
- Com `_theokit_memory: {...}`: factory passa essa config para `Agent.create()`. Suite de memory pode setar path único por caso (`_theokit_memory: { manager: "file", path: "/tmp/eval-${uuid}" }`) — preserva isolamento sem desabilitar a feature.

#### Tasks
1. Estender `types.ts` com `TheokitExtensions` interface.
2. Refatorar `translate.ts` para extrair `_theokit_*` antes do parsing OpenAI.
3. Refatorar `agent-factory.ts` para aceitar extensions opcionais (memory/context override D9 quando explícitos).
4. Adicionar branch SSE em `server.ts` + `sse.ts`.
5. Garantir que requests sem `_theokit_*` continuam batendo nos paths originais (Phases 2-3 não regridem).

#### TDD
```
RED:     bridge/tests/extensions.test.ts::test_theokit_mcp_is_passed_to_agent — _theokit_mcp no body chega como mcpServers no Agent.create mock
RED:     extensions.test.ts::test_theokit_hooks_is_passed
RED:     extensions.test.ts::test_theokit_skills_is_passed
RED:     extensions.test.ts::test_theokit_subagents_is_passed
RED:     extensions.test.ts::test_theokit_memory_overrides_d9_default
RED:     extensions.test.ts::test_theokit_context_overrides_d9_default
RED:     extensions.test.ts::test_default_still_omits_memory — sem _theokit_memory, factory ainda força undefined (D9 default holds)
RED:     extensions.test.ts::test_theokit_mcp_rejects_non_array — (EC-23) _theokit_mcp: "string" → HTTP 400 com mensagem
RED:     extensions.test.ts::test_theokit_hooks_rejects_non_array — análogo para hooks
RED:     extensions.test.ts::test_theokit_memory_rejects_non_object — _theokit_memory: 42 → HTTP 400
RED:     bridge/tests/sse.test.ts::test_sse_writes_openai_chunks — stream:true devolve text/event-stream com data: chunks válidos
RED:     sse.test.ts::test_sse_emits_theokit_step_when_requested — _theokit_capture_steps:true emite event theokit.step
RED:     sse.test.ts::test_sse_emits_done_at_end
RED:     sse.test.ts::test_sse_cancels_on_client_disconnect — (EC-24) client fecha conexão; server invoca AbortController → agent.send é cancelado (verificado por mock)
RED:     sse.test.ts::test_sse_server_timeout_5min — (EC-25) agent que demora > 5min é abortado; conexão fechada com erro 504; reduce timeout via env EVAL_SSE_TIMEOUT_MS para testar em segundos
GREEN:   Implementar extensões cobrindo todos os RED
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/sdk exec vitest run evals/bridge/tests/extensions.test.ts evals/bridge/tests/sse.test.ts
```

#### Acceptance Criteria
- [ ] Campo `_theokit_mcp` no body chega em `Agent.create({ mcpServers })`.
- [ ] Campo `_theokit_memory` override do default D9 — testado com path único por caso.
- [ ] **(EC-23)** Tipagem inválida em qualquer `_theokit_*` retorna HTTP 400 com mensagem clara; nunca cast inseguro.
- [ ] `stream: true` retorna `200 text/event-stream` (não mais 501 da T1.1).
- [ ] **(EC-24)** Client disconnect (`res.on('close')`) cancela `agent.send` via AbortController — verificado em teste.
- [ ] **(EC-25)** SSE keep-alive tem timeout server-side (default 5min, override `EVAL_SSE_TIMEOUT_MS`).
- [ ] BFCL e τ² continuam passando (Phases 2-3 não regridem — requests sem `_theokit_*` usam path original).
- [ ] LoC: cada arquivo ≤ 250 linhas.

#### DoD
- [ ] 15 testes passam (10 originais + 3 tipagem + 2 SSE robustez).
- [ ] Smoke regressão: `pnpm eval:bfcl` continua produzindo summary correto.
- [ ] `pnpm quality:dead` sem código órfão.

---

## Phase 6: Memory (LoCoMo + Active/Dreaming/Search E2E)

**Objective:** medir todas as 4 frentes de memory expostas em `docs.md`: file manager básico, search, dreaming (consolidation), active memory (auto-write).

### T6.1 — Runner LoCoMo

#### Objective
Executar LoCoMo (Long-Conversation Memory benchmark, Park et al. 2024) contra a bridge com `_theokit_memory: { manager: "file" }` ativado, produzindo `evals/results/{ts}/locomo/summary.json`.

#### Evidence
LoCoMo é o benchmark padrão da literatura para memory em conversas longas (até 600 turns). Sem ele, falta sinal comparável de quanto o `memory.manager: file` recupera fatos corretamente.

#### Files to edit
```
evals/runners/locomo.sh                    (NEW)
evals/runners/requirements.txt             (EDIT) — adiciona locomo-eval (TBD: confirmar pacote pip oficial)
evals/runners/locomo-summarize.py          (NEW) — reduz output raw a summary.json
```

#### Tasks
1. Confirmar pacote pip oficial do LoCoMo (research gate antes de implementar; alternativa: `pip install git+https://github.com/snap-research/locomo` se não houver pacote).
2. Escrever `locomo.sh` análogo a `bfcl-v3.sh` mas passando `_theokit_memory` ativado.
3. Escrever summarizer.

#### TDD
```
RED:     test_locomo_summarize.py::aggregates_fixtures_correctly
RED:     test_locomo_summarize.py::handles_missing_runs
RED:     test_locomo_runner.sh::test_locomo_runner_sets_theokit_memory — (EC-27) capturar requests da bridge durante run; cada um deve ter _theokit_memory.manager = "file" e path único por conversation (path NÃO compartilhado entre conversations)
RED:     test_locomo_runner.sh::test_locomo_fails_clearly_when_memory_disabled — sem _theokit_memory, runner falha rápido em vez de medir LLM cru (que daria score baixo enganoso)
GREEN:   Implementar
VERIFY:  pytest evals/runners/tests/test_locomo_summarize.py && bash evals/runners/tests/test_locomo_runner.sh
```

#### Acceptance Criteria
- [ ] `pnpm eval:locomo` produz `summary.json` com `{ recall_at_k, num_conversations }`.
- [ ] **(EC-27)** Cada conversation do LoCoMo passa `_theokit_memory: { manager: "file", path: "<unique-per-conversation>" }` via `--extra-body` ou mecanismo do client LoCoMo.
- [ ] **(EC-27)** Sem o flag de memory ativo, runner falha rápido (não fica medindo silenciosamente sem SDK memory).
- [ ] Custo: ≤ US$ 15 por run.
- [ ] Tempo: ≤ 40 min.

#### DoD
- [ ] Pacote LoCoMo identificado e pinado.
- [ ] Suite de mocks valida summarizer.

### T6.2 — Suite E2E proprietária: Active Memory + Dreaming + Search

#### Objective
Suite Camada B (D14) com fixtures cobrindo: (a) Active Memory auto-write entre runs do mesmo workspace; (b) Memory Search retorna facts recém-escritos; (c) Dreaming consolida facts em narrativa.

#### Files to edit
```
evals/suites/memory/cases/*.json    (NEW — 10 fixtures, formato com steps[])
evals/suites/runner.ts              (NEW — shared runner com suporte multi-step, ≤ 250 linhas)
evals/suites/memory/summarize.ts    (NEW — reduz outputs do runner a summary.json)
evals/suites/types.ts               (NEW — schema Case + Step)
```

#### Schema da fixture (resolve EC-22)

Cada caso tem **um ou mais steps** executados em sequência, mantendo estado compartilhado quando relevante (e.g., `_theokit_memory.path`):

```ts
interface Case {
  name: string;
  category: string;          // "write_read" | "search" | "dreaming" | "active_recall" | ...
  shared?: {
    memory_path?: string;     // se presente, todos os steps usam o mesmo path (active recall cross-run)
    context_path?: string;
  };
  steps: Step[];
}

interface Step {
  setup?: Record<string, unknown>;    // overrides locais do _theokit_*
  prompt: string;
  assert: Assertion;                  // contains | regex | tool_called | jsonpath
}
```

**Exemplo `cases/active_recall_basic.json`:**
```json
{
  "name": "active_recall_basic",
  "category": "active_recall",
  "shared": { "memory_path": "{{tmpdir}}/eval-${case.uuid}" },
  "steps": [
    { "prompt": "Lembre que meu nome favorito de cor é violet.", "assert": { "type": "contains", "value": "violet" } },
    { "prompt": "Qual minha cor favorita?", "assert": { "type": "contains", "value": "violet" } }
  ]
}
```

Runner garante: (1) `{{tmpdir}}` resolvido para path único por caso; (2) `${case.uuid}` interpolado uma vez por caso, NÃO por step; (3) cleanup do path após todos os steps; (4) erro em qualquer step marca o caso inteiro como `fail` com info do step que quebrou.

#### Tasks
1. Definir 10 fixtures cobrindo:
   - `write_read_basic` (1 step) — write fact, asserir resposta.
   - `active_recall_basic` (2 steps) — cross-run recall, schema acima.
   - `active_recall_3_facts` (4 steps) — múltiplos facts, ordem aleatória de recall.
   - `search_by_keyword` (2 steps) — write + search.
   - `search_semantic` (2 steps) — write fact + busca por sinônimo.
   - `dreaming_consolidation` (3 steps) — write 5 facts + trigger dream + recall.
   - `memory_dispose_resume` (3 steps) — write, dispose, novo agent no mesmo path, recall.
   - `conflict_resolution` (3 steps) — fact A, fact contradictory A', recall escolhe mais recente.
   - `empty_memory_no_hallucination` (1 step) — pergunta sobre fact nunca escrito → agent admite não saber.
   - `memory_isolated_between_cases` (1 step) — usado para asserir que paths diferentes NÃO compartilham fact.
2. Implementar `suites/types.ts` com `Case`, `Step`, `Assertion`.
3. Implementar `suites/runner.ts` com:
   - Carrega cases dum diretório.
   - Resolve `shared.memory_path` template (gera UUID por caso).
   - Por caso: itera steps; entre steps mantém `_theokit_memory.path`; trata erro como fail com step index.
   - Cleanup: `rm -rf` do `memory_path` após terminar.
4. Implementar `memory/summarize.ts`.

#### TDD
```
RED:     suites/tests/runner.test.ts::executes_single_step_case
RED:     runner.test.ts::executes_multi_step_case_with_shared_memory_path — (EC-22) 2 steps, mesmo path, fact escrito em step 1 visível em step 2
RED:     runner.test.ts::reports_step_index_on_failure — falha no step 2 reporta "case X failed at step 2"
RED:     runner.test.ts::cleans_up_memory_path_after_case — (EC-26) path único por caso; após run, dir não existe
RED:     runner.test.ts::test_memory_path_unique_per_case — 100 cases paralelos não compartilham path (EC-26)
RED:     runner.test.ts::test_dispose_failure_isolated — (EC-28) caso A com dispose mockado lançando; caso B subsequente roda limpo
RED:     memory/tests/active_recall_fixture_works — fixture específica passa contra bridge mock
GREEN:   Implementar
VERIFY:  pnpm test:suites
```

#### Acceptance Criteria
- [ ] 10 fixtures em `evals/suites/memory/cases/` no schema multi-step.
- [ ] Runner suporta steps[] com `shared.memory_path` template interpolado por caso (EC-22).
- [ ] Path único por caso garantido (EC-26).
- [ ] Cleanup pós-caso confirma `memory_path` removido.
- [ ] Dispose lançando em caso A não contamina caso B (EC-28).
- [ ] Runner reporta `{ pass_rate, num_cases, by_category }` + lista de falhas com step index.
- [ ] Custo: ≤ US$ 5 por run.

#### DoD
- [ ] Suite executável via `pnpm eval:suite memory`.
- [ ] Fixtures versionadas; runner reutilizável (Phases 8-11).
- [ ] Schema `Case`/`Step` documentado em `evals/README.md`.

---

## Phase 7: Context Manager (Needle-in-a-Haystack adaptado)

**Objective:** validar que `context: { manager: "file" }` injeta sources no system prompt e o LLM consegue recuperar fatos das sources.

### T7.1 — Runner NIAH adaptado

#### Objective
Implementar variante simplificada do Needle-in-a-Haystack: gerar `haystack.txt` de N tokens contendo `needle` em posição variável, configurar agent via `_theokit_context: { manager: "file", sources: ["haystack.txt"] }`, perguntar ao agent o conteúdo do needle, medir pass_rate.

#### Files to edit
```
evals/runners/niah.sh                  (NEW)
evals/suites/niah/cases/*.json         (NEW — 15 fixtures: 3 tamanhos × 5 posições)
evals/suites/niah/generate.ts          (NEW — gera haystack + needle)
```

#### Tasks
1. Implementar gerador de haystack (texto random com needle em posição K).
2. Definir 15 casos: tamanhos 1K, 4K, 16K tokens × posições 0%, 25%, 50%, 75%, 100%.
3. Reutilizar `suites/runner.ts` da T6.2 para execução.

#### TDD
```
RED:     niah/tests/generate.test.ts::needle_at_position_K_appears_in_haystack
RED:     niah/tests/asserts_recall_correct — fixture com needle="42" → resposta contém "42"
RED:     niah/tests/test_niah_generator_seeded — (EC-29) gerar haystack 2x com mesma seed (`{ seed: 42 }`) → SHA256 idêntico; sem seed → erro tipado
RED:     niah/tests/test_baseline_uses_committed_seed — baseline congelado tem campo `seed` que reproduz exatamente o haystack do baseline
GREEN:   Implementar
VERIFY:  pnpm test:suites
```

#### Acceptance Criteria
- [ ] 15 fixtures rodam contra bridge.
- [ ] **(EC-29)** Geração de haystack determinística via seed obrigatório no fixture; baseline reproduzível byte-a-byte.
- [ ] pass_rate ≥ 0.9 para haystacks ≤ 4K tokens (modelo deveria nunca falhar nesse regime).
- [ ] Custo: ≤ US$ 3 por run.

#### DoD
- [ ] Suite executável; baseline congelado.

---

## Phase 8: MCP Servers (E2E binário)

**Objective:** validar que bridge + SDK consegue invocar tools de servidores MCP reais (stdio e http).

### T8.1 — Suite MCP com servidores oficiais

#### Objective
Suite Camada B configurando agents com 3 servidores MCP oficiais (filesystem, sequential-thinking, fetch), validando que tools expostos pelo MCP aparecem disponíveis ao agent e são invocados nos prompts certos.

#### Files to edit
```
evals/suites/mcp/cases/*.json          (NEW — 12 fixtures: 4 por servidor)
evals/suites/mcp/setup-servers.sh      (NEW) — `npx -y @modelcontextprotocol/server-filesystem` etc.
```

#### Tasks
1. Identificar 3 servidores MCP estáveis e Apache-2.0/MIT (filesystem, sequential-thinking, fetch — todos oficiais).
2. Definir 12 fixtures: tarefas que exigem cada tool exposto por cada servidor.
3. Setup script garante que os servidores estão executáveis (`npx -y` lazy install).
4. Cada fixture inclui `_theokit_mcp: [...]` no body.

#### TDD
```
RED:     mcp/tests/filesystem_read_works — agent lê arquivo via MCP filesystem
RED:     mcp/tests/sequential_thinking_invoked — prompt complexo dispara o tool
RED:     mcp/tests/fetch_http_url_works
RED:     mcp/tests/test_mcp_filesystem_uses_isolated_tmpdir — (EC-32) cada caso recebe `mktemp -d /tmp/mcp-eval.XXXXXX`; cleanup pós-caso confirma diretório removido
RED:     mcp/tests/test_mcp_server_crash_marks_case_as_fail — (EC-31) mock MCP server que sai com exit 1; case marcado fail; suite continua com próximos cases (não aborta)
RED:     mcp/tests/test_mcp_server_unresponsive_times_out — server roda mas não responde; case fail por timeout (default 60s)
GREEN:   Implementar
VERIFY:  pnpm test:suites
```

#### Acceptance Criteria
- [ ] 12 fixtures, 3 servidores.
- [ ] **(EC-32)** Cada fixture filesystem usa tmpdir isolado; cleanup confirmado.
- [ ] **(EC-31)** Servidor MCP crashed → case `fail` com erro tipado; suite NÃO aborta.
- [ ] **(EC-30)** Workflow CI usa `actions/cache@v4` para `~/.npm` (cache do `npx -y`) — documentado em T5.1.
- [ ] pass_rate ≥ 0.85 (MCP é determinístico; falhas indicam wiring bug).
- [ ] Custo: ≤ US$ 5 por run.

#### DoD
- [ ] Suite roda em CI sem precisar de Docker (npx funciona em GH Actions).
- [ ] Cache npm reduz tempo do 2º run de CI em ≥ 50% (verificado).

---

## Phase 9: Hooks (Suite comportamental)

**Objective:** validar que hooks (pre/post tool, pre/post message) disparam nos momentos certos e podem modificar/bloquear ações.

### T9.1 — Suite Hooks

#### Objective
Suite Camada B com fixtures que: registram hooks **por nome** (referência em string), executam prompt que dispara situação coberta pelo hook, asserem que o hook foi chamado E que efeito esperado ocorreu (bloqueio, modificação, log).

#### Resolução EC-18: hooks-registry como pré-cadastro nome→função

Fixtures JSON **NÃO** carregam funções TypeScript inline (impossível). Em vez disso, a bridge tem um registry de hooks pré-implementados, e fixtures referenciam por **nome (string)**.

**Fluxo:**
1. `evals/bridge/hooks-registry.ts` exporta `REGISTERED_HOOKS: Record<string, HookConfig>` com hooks pré-implementados (log-pre-tool, log-post-tool, block-on-keyword, modify-message-uppercase, etc.).
2. Bridge ao ver `_theokit_hooks: ["log-pre-tool", "block-on-keyword"]` no body, resolve cada string contra o registry e passa as `HookConfig` resolvidas para `Agent.create({ hooks })`.
3. Hook desconhecido → HTTP 400 com nome inválido (NÃO assumir/criar silenciosamente).

**ADR inline para esta decisão** (não cria D novo, é refinamento de D14):
> Hooks/Skills/Subagents seguem o mesmo padrão: fixture passa **nomes (strings)**, bridge resolve contra registry pré-cadastrado. Tudo que não é JSON-serializável vira referência por nome. Rejeitado: serializar código JS em string (XSS/eval risk); rejeitado: arquivos `.ts` referenciados por path (acopla fixture a layout do repo).

#### Files to edit
```
evals/bridge/hooks-registry.ts         (NEW — registry público de hooks pré-cadastrados, ≤ 150 linhas)
evals/bridge/agent-factory.ts          (EDIT) — resolve _theokit_hooks: string[] contra REGISTERED_HOOKS
evals/suites/hooks/cases/*.json        (NEW — 12 fixtures referenciando hooks por nome)
evals/suites/hooks/log-store.ts        (NEW) — utilidade compartilhada de log por case (path único)
```

#### Tasks
1. Implementar `hooks-registry.ts` exportando 8 hooks pré-cadastrados:
   - `log-pre-tool`, `log-post-tool`, `log-pre-message`, `log-post-message` — escrevem em log-store path do case.
   - `block-on-keyword` (parametrizado) — bloqueia tool quando prompt contém keyword.
   - `modify-message-uppercase` — modifica output.
   - `count-tool-invocations` — incrementa contador no log-store.
   - `noop-fast` — hook trivial para baseline de overhead.
2. Implementar `log-store.ts` com `getLogPath(caseId)`, `appendLog(caseId, entry)`, `readLog(caseId)`. **Path por caso** (resolve EC potencial colisão).
3. Atualizar `agent-factory.ts` para aceitar `_theokit_hooks: string[]` e resolver via registry; nome desconhecido → erro tipado.
4. Definir 12 fixtures cobrindo: hook fired N vezes, hook bloqueia tool, hook modifica prompt, múltiplos hooks ordenados, hook async timeout, hook desconhecido (negative test).

#### TDD
```
RED:     bridge/tests/hooks-registry.test.ts::test_resolves_hook_by_name
RED:     hooks-registry.test.ts::test_unknown_hook_throws_typed_error — _theokit_hooks: ["does-not-exist"] → HTTP 400 com nome
RED:     hooks/tests/pre_tool_hook_fires_before_tool — log mostra ordem correta
RED:     hooks/tests/post_message_hook_modifies_text
RED:     hooks/tests/pre_tool_hook_can_block — tool não é invocado quando hook retorna `{ block: true }`
RED:     hooks/tests/test_hook_log_isolated_per_case — (EC-33 collision) 100 cases paralelos têm logs separados; nenhum corrompe outro
RED:     hooks/tests/test_hook_async_timeout — (EC-33) hook que excede 1s é abortado, case marcado fail (não trava runner)
GREEN:   Implementar
VERIFY:  pnpm test:suites
```

#### Acceptance Criteria
- [ ] 12 fixtures referenciando hooks por nome string.
- [ ] `REGISTERED_HOOKS` exporta ≥ 8 hooks documentados em comentário.
- [ ] Hook desconhecido → HTTP 400 imediato (EC-18).
- [ ] Hook async > 1s → aborted, case fail (EC-33).
- [ ] Log path por caso (sem colisão paralela).
- [ ] pass_rate ≥ 0.9.
- [ ] Custo: ≤ US$ 3 por run.

#### DoD
- [ ] Hooks documentados em `docs.md` cobertos por ≥ 1 fixture cada.
- [ ] `hooks-registry.ts` é referenciado também por T10.1 (skills) e T11.1 (subagents) como template do mesmo padrão.

---

## Phase 10: Skills (Suite comportamental)

**Objective:** validar que skills carregadas via `_theokit_skills` aparecem ao LLM (metadata + nome) e o agent referencia/usa quando relevante.

### T10.1 — Suite Skills

#### Files to edit
```
evals/suites/skills/cases/*.json       (NEW — 10 fixtures)
evals/suites/skills/fixtures/*.md      (NEW) — skills SKILL.md de exemplo
```

#### Tasks
1. Criar 5 skills fixture em `evals/suites/skills/fixtures/*.md` com frontmatter completo (name, description, capabilities).
2. 10 fixtures: agent com 0/1/3/5 skills carregadas; prompts "list your skills", "do task that needs skill X", "do task without matching skill".
3. Asserts: response contém nome da skill esperada; agent não inventa skill ausente.

#### TDD
```
RED:     skills/tests/agent_lists_loaded_skills — prompt "list skills" inclui o nome correto
RED:     skills/tests/agent_invokes_skill_when_relevant
RED:     skills/tests/agent_does_not_hallucinate_skills_when_none_loaded
RED:     skills/tests/test_skill_invalid_frontmatter_throws_typed — (EC-34) SKILL.md com YAML mal-formado (e.g., `name: [unclosed`) → erro tipado do SDK (`SkillFrontmatterError` ou equivalente), NÃO exception genérica do parser YAML
RED:     skills/tests/test_skill_missing_required_field_throws_typed — frontmatter sem `name` ou `description` → erro tipado identificando campo faltando
GREEN:   Implementar
VERIFY:  pnpm test:suites
```

#### Acceptance Criteria
- [ ] 10 fixtures.
- [ ] **(EC-34)** Frontmatter inválido produz erro tipado (não stack trace de YAML); nome do campo faltando vem na mensagem.
- [ ] pass_rate ≥ 0.85.
- [ ] Custo: ≤ US$ 3.

#### DoD
- [ ] Frontmatter cobre os campos documentados em `docs.md`.
- [ ] Classe de erro de frontmatter (se ainda não existe no SDK) registrada como gap em `docs.md` (ou usada classe existente).

---

## Phase 11: Subagents (HumanEval delta com/sem subagents)

**Objective:** medir contribuição marginal de subagents — rodar HumanEval em duas configurações (sem subagents vs. com planner+executor subagents) e reportar delta de pass@1.

### T11.1 — Runner HumanEval ablation (com Docker sandbox per D18)

#### Files to edit
```
evals/runners/humaneval.sh                     (NEW) — roda HumanEval 2x (control vs. with-subagents)
evals/runners/humaneval-summarize.py           (NEW) — reduz aos dois números + delta
evals/runners/humaneval-sandbox/Dockerfile     (NEW — D18) — python:3.11-slim com timeout helper
evals/runners/humaneval-sandbox/exec.sh        (NEW) — wrapper que invoca `docker run` por problema
evals/bridge/subagents-registry.ts             (NEW) — mesmo padrão de hooks-registry (resolve EC-18 para subagents)
```

#### Sandbox protocol (D18)

Cada code-eval invocation:
```bash
echo "$GENERATED_CODE" | docker run --rm -i \
  --network none --read-only --tmpfs /tmp \
  --memory 512m --pids-limit 64 \
  --user nobody \
  humaneval-sandbox:latest \
  timeout 30 python3 -c "import sys; exec(sys.stdin.read())"
```

- `--network none` — código não acessa internet.
- `--read-only` + `--tmpfs /tmp` — escrita só em `/tmp` (volátil).
- `--memory 512m` + `--pids-limit 64` — bloqueia fork bombs.
- `timeout 30` — kill após 30s (resolve EC-35).
- `--user nobody` — sem privilegios.

#### Tasks
1. **Resolver subagents-registry** (mesmo padrão de hooks-registry — EC-18 aplicado a subagents): pré-cadastrar 3 subagents (`planner`, `executor`, `reviewer`) referenciados por nome em `_theokit_subagents: ["planner", "executor"]`.
2. Configurar `humaneval-bench` (Python, pip pinado) apontando para bridge.
3. **Construir imagem `humaneval-sandbox`** com Dockerfile minimal.
4. Implementar `exec.sh` wrapper que: lê código gerado, monta volume tmpfs, invoca docker, captura stdout/exit code, retorna no formato esperado por humaneval-bench.
5. Rodada 1 (control): sem `_theokit_subagents`.
6. Rodada 2 (treatment): `_theokit_subagents: ["planner", "executor"]`.
7. Summarizer reporta: `pass_at_1_control`, `pass_at_1_treatment`, `delta_pp`, `num_timeouts`, `num_sandbox_errors`.

#### TDD
```
RED:     test_humaneval_summarize.py::reports_delta_correctly
RED:     test_humaneval_summarize.py::reports_timeout_count — (EC-35) problemas com timeout aparecem em num_timeouts
RED:     humaneval-sandbox/tests/sandbox_blocks_network — `import socket; socket.gethostbyname("google.com")` falha
RED:     sandbox_blocks_disk_write — escrita em `/etc/foo` falha; escrita em `/tmp/foo` OK
RED:     sandbox_kills_infinite_loop — `while True: pass` → killed em ≤ 30s (EC-35)
RED:     sandbox_kills_fork_bomb — `:(){:|:&};:` (em Python) falha por pids-limit
RED:     bridge/tests/subagents-registry.test.ts::resolves_by_name — _theokit_subagents: ["planner"] mapeia para SubagentConfig pré-cadastrado
RED:     subagents-registry.test.ts::unknown_name_throws — _theokit_subagents: ["does-not-exist"] → HTTP 400
GREEN:   Implementar Dockerfile + exec.sh + summarizer + subagents-registry
VERIFY:  pytest + pnpm test
```

#### Acceptance Criteria
- [ ] Dockerfile `humaneval-sandbox` build em < 60s no CI.
- [ ] `exec.sh` invoca docker com TODAS as flags de D18 (verificável via `docker inspect` do container).
- [ ] Código com `import socket` falha por --network none.
- [ ] Loop infinito é morto em ≤ 30s (EC-35).
- [ ] Fork bomb morre por pids-limit (não derruba o host).
- [ ] `summary.json` contém os 5 campos (acrescenta num_timeouts + num_sandbox_errors).
- [ ] Custo: ≤ US$ 25 por run (HumanEval = 164 problemas × 2 rodadas).
- [ ] Tempo: ≤ 60 min (sobe de 50 para acomodar overhead Docker ~3min).
- [ ] Subagents pré-cadastrados em `subagents-registry.ts` documentados.

#### DoD
- [ ] Delta reportado faz parte do relatório de cobertura.
- [ ] Sandbox flags conferem com D18 (auditável).
- [ ] CI macOS skip explícito se Docker não disponível (com mensagem clara, não falha silenciosa).

---

## Phase 12: Streaming + Performance

**Objective:** medir TTFT (time to first token), TPOT (tokens per output token), e validar que `onStep`/`onDelta` callbacks disparam quando o caller pede.

### T12.1 — Suite Streaming + Perf

#### Files to edit
```
evals/suites/streaming/cases/*.json    (NEW — 8 fixtures)
evals/suites/streaming/measure.ts      (NEW) — abre SSE, mede TTFT/TPOT/step_count
```

#### Tasks
1. 8 fixtures: prompts de 100/500/2000/4000 tokens × com/sem tools.
2. `measure.ts` abre conexão SSE contra bridge, cronometra primeiro `data:`, conta deltas, valida que `theokit.step` events foram emitidos quando `_theokit_capture_steps: true`.

#### TDD
```
RED:     streaming/tests/measures_ttft_correctly — TTFT ≥ 0 e ≤ 30s
RED:     streaming/tests/counts_step_events
RED:     streaming/tests/test_streaming_perf_runs_n_warmups — (EC-36) measure.ts faz 1 warmup descartado + N medições por fixture; warmup NÃO entra no cálculo
RED:     streaming/tests/test_streaming_reports_p50_p95 — output contém `{ p50, p95 }` por fixture (não apenas single TTFT)
RED:     streaming/tests/test_streaming_runs_3_repetitions_by_default — default N=3; configurável via `EVAL_STREAMING_REPS`
GREEN:   Implementar
VERIFY:  pnpm test:suites
```

#### Acceptance Criteria
- [ ] TTFT p50 < 2s e p95 < 5s.
- [ ] **(EC-36)** Cada fixture roda 1 warmup + 3 medições; warmup descartado; resultado expõe p50/p95.
- [ ] onStep fire count > 0 para qualquer prompt > 50 tokens.
- [ ] Custo: ≤ US$ 5 (8 fixtures × 4 runs cada = 32 chamadas total).

#### DoD
- [ ] Perf metrics no relatório de cobertura com IC explícito.

---

## Phase 13: Provider Fallback (Chaos test)

**Objective:** validar que `providers.routes` com `fallback: ["primary", "secondary"]` realmente assume secondary quando primary falha (5xx ou rede).

### T13.1 — Suite Fallback Chaos

#### Files to edit
```
evals/suites/fallback/cases/*.json     (NEW — 6 fixtures)
evals/suites/fallback/mock-primary.ts  (NEW) — mini-server HTTP que retorna 5xx no path /v1/chat/completions
```

#### Tasks
1. Subir `mock-primary` em `:9101` configurado para falhar (500, timeout, ou rate limit).
2. Configurar agent com `providers.routes` = `[mock-primary, real-openrouter]`.
3. 6 fixtures: primary 500, primary timeout, primary 429, primary 401 (não-retryable), secondary também falha, fallback chain de 3 níveis.
4. Asserts: Run conclui com status `finished` quando há provider viável; erro tipado quando não há.

#### TDD
```
RED:     fallback/tests/primary_5xx_falls_back_to_secondary
RED:     fallback/tests/primary_401_does_not_retry — 401 é erro definitivo, não tenta secondary
RED:     fallback/tests/all_fail_returns_typed_error
RED:     fallback/tests/test_mock_primary_uses_dynamic_port — (EC-37) server escuta em `:0`; suite lê porta atribuída pelo kernel via `address()` e exporta como env var
RED:     fallback/tests/test_mock_primary_cleanup_on_exit — (EC-38) trap SIGINT/SIGTERM/EXIT no script; após suite, `pgrep` confirma zero processos remanescentes
RED:     fallback/tests/test_mock_primary_killed_even_on_test_failure — vitest test que lança ainda mata mock antes de sair
GREEN:   Implementar
VERIFY:  pnpm test:suites
```

#### Acceptance Criteria
- [ ] 6 fixtures.
- [ ] **(EC-37)** Mock primary usa porta dinâmica via `:0`; porta exposta para suite via env. Múltiplos jobs CI paralelos não conflitam.
- [ ] **(EC-38)** Trap SIGINT/SIGTERM/EXIT garante cleanup mesmo em falha; smoke confirma 0 orphan processes.
- [ ] pass_rate = 1.0 (chaos test é determinístico — se falha, é bug do SDK).
- [ ] Custo: ≤ US$ 2.

#### DoD
- [ ] Mock primary não interfere com outras suites (verificado: rodar fallback + memory back-to-back sem reuse de porta).

---

## Phase 14: Multi-modelo (matriz 3×N pré-launch)

**Objective:** rodar suite completa contra 3 modelos (Claude Sonnet 4.5, GPT-4o, Gemini 2.5 Flash) e publicar tabela auditável no README do SDK no momento do lançamento.

### T14.1 — Script `pnpm eval:matrix`

#### Files to edit
```
evals/scripts/matrix.ts                (NEW) — orquestrador 3 modelos × benchmarks core
evals/scripts/matrix-report.ts         (NEW) — gera markdown table
```

#### Tasks
1. Definir conjunto "core" para matriz: BFCL + τ²-retail + LoCoMo + NIAH + HumanEval-ablation (5 benchmarks; ~US$ 80 × 3 modelos = ~US$ 240).
2. Script itera sobre modelos, seta `EVAL_MODEL` por execução, roda runners.
3. Report gera markdown com tabela 3 linhas × 5 colunas + delta vs Claude (baseline).

#### Acceptance Criteria
- [ ] Tabela markdown publicada em `evals/results/matrix/{date}/REPORT.md`.
- [ ] Custo: ≤ US$ 240 por matriz.
- [ ] Tempo: ≤ 4h (cabe em GH Actions free).

#### DoD
- [ ] Procedimento de release documentado: rodar matriz, commitar REPORT.md, adicionar link no README.

---

## Phase 15: Contract tests não-eval (Cron, Theokit namespace, Send overrides, Erros)

**Objective:** garantir que capacidades não-agentic (sem prompt LLM) funcionam conforme `docs.md`.

### T15.1 — Suite Contract em vitest

#### Files to edit
```
evals/contract/cron.test.ts                (NEW)
evals/contract/theokit-namespace.test.ts   (NEW)
evals/contract/send-overrides.test.ts      (NEW)
evals/contract/typed-errors.test.ts        (NEW)
evals/contract/helpers/cleanup.ts          (NEW) — cleanup utilities por suite (resolve EC-20)
evals/contract/helpers/namespace.ts        (NEW) — namespace isolado `eval-test-${uuid}` por run
```

#### Resolução EC-20: cleanup obrigatório de recursos criados

Recursos criados por contract tests (especialmente `Cron.create()`) **DEVEM** ser deletados ao fim do teste. Sem cleanup, cada execução CI deixa um cron job ativo que dispara indefinidamente, consumindo tokens e poluindo o workspace.

**Padrão obrigatório:**
```ts
// evals/contract/cron.test.ts
const createdCronIds: string[] = [];

afterEach(async () => {
  // EC-20: cleanup garantido mesmo em test failure
  for (const id of createdCronIds) {
    await Cron.delete(id).catch((e) => console.warn(`failed to cleanup cron ${id}:`, e));
  }
  createdCronIds.length = 0;
});

test("create_list_delete_roundtrip", async () => {
  const cron = await Cron.create({ ... });
  createdCronIds.push(cron.id);
  // ... asserts
});
```

**Namespace isolado:** todos os recursos criados em contract tests usam prefixo de namespace `eval-test-${runUuid}` em campos como `name`. Permite bulk-delete defensivo no `globalSetup` se cleanup individual falhar.

#### Tasks
1. **Implementar `helpers/namespace.ts`** com `getRunNamespace()` retornando `eval-test-${uuid()}` constante por run.
2. **Implementar `helpers/cleanup.ts`** com:
   - `trackForCleanup(category, id)` — registra recurso.
   - `cleanupAll(category)` — itera e deleta.
   - Helper de auto-cleanup que pode ser usado como hook do vitest.
3. **`cron.test.ts`**: cria cron job (com `name` prefixado pelo namespace), lista (filtra pelo namespace), deleta. **`afterEach` cleanup obrigatório** + **`afterAll` bulk-delete** de qualquer cron remanescente com o namespace deste run.
4. **`theokit-namespace.test.ts`**: `Theokit.me()`, `Theokit.models.list()`, `Theokit.repositories.list()` — read-only, não precisa cleanup. Mas com **gate `EVAL_CONTRACT=1`** (EC-39) porque requer API key real.
5. **`send-overrides.test.ts`**: send com `model` override usa modelo certo; `tools` override é aditivo/substituto conforme `docs.md`.
6. **`typed-errors.test.ts`**: cada classe pública de erro lançada nos cenários documentados (usa providers mockados).
7. **Globally**: setup vitest do contract path com `EVAL_CONTRACT=1` gate (vitest test.skipIf).

#### TDD
```
RED:     contract/tests/cleanup.test.ts::tracked_resources_are_deleted_after_each
RED:     cleanup.test.ts::cleanup_continues_on_individual_failure — uma deleção falha, outras continuam
RED:     cron.test.ts::create_list_delete_roundtrip
RED:     cron.test.ts::test_no_orphan_crons_after_suite — (EC-20) após suite rodar, list cron com prefixo do namespace retorna []
RED:     cron.test.ts::test_cleanup_runs_even_when_test_fails — (EC-20) test que lança ainda assim faz cleanup
RED:     theokit-namespace.test.ts::test_skipped_without_eval_contract_flag — (EC-39) sem EVAL_CONTRACT=1, suíte é skipped (não fail)
RED:     theokit-namespace.test.ts::me_returns_user_id
RED:     send-overrides.test.ts::model_override_takes_precedence
RED:     typed-errors.test.ts::InsufficientBalanceError_thrown_when_balance_zero (mock provider)
GREEN:   Implementar (tests só passam quando SDK + bridge + cleanup corretos)
VERIFY:  EVAL_CONTRACT=1 pnpm test:contract
```

#### Acceptance Criteria
- [ ] 100% das classes públicas de erro têm teste.
- [ ] 100% dos métodos `Theokit.*` têm teste.
- [ ] **(EC-20)** Após `pnpm test:contract`, list de cron jobs com prefixo do namespace deste run retorna `[]` — testado.
- [ ] **(EC-20)** Cleanup roda mesmo em test failure (verificado via teste que força throw).
- [ ] **(EC-39)** Sem `EVAL_CONTRACT=1`, suites que requerem API key real são `skipped` (não fail).
- [ ] Custo: ≤ US$ 1 (testes leves; `Theokit.me()` consome mínimo).

#### DoD
- [ ] `pnpm test:contract` integrado ao `pnpm test` regular (com gate `EVAL_CONTRACT`).
- [ ] Zero crons órfãos após 10 runs consecutivos do contract suite (smoke manual ou check no `afterAll`).
- [ ] Namespace isolado documentado em `evals/README.md`.

---

### T5.2 — Atualizar `evals/README.md` com runbook

#### Objective
Documentar como devs rodam evals localmente, como atualizar baseline, como interpretar relatórios, e os riscos conhecidos que **não** foram pré-corrigidos.

#### Files to edit
```
evals/README.md       (EDIT) — expandir para runbook completo + Risks & Mitigations
```

#### Tasks
1. Adicionar seções: "Run localmente", "Atualizar baseline", "Interpretar relatórios", "Custo e SLA".
2. Adicionar seção **"Risks & Mitigations"** cobrindo os 11 itens DOCUMENT dos dois edge case reviews:

   **Riscos do v1.1 (BFCL + τ² + comparator + CI):**
   - **R1 (EC-13) — Pin `bfcl-eval==3.0.x`**: minor changes do upstream podem mudar shape do output raw. Quando atualizar `bfcl-eval`, rodar contra fixture conhecida antes de mergear. Mitigação imediata: pin EXATO (`==3.0.5`) e atualizar via PR explícito.
   - **R2 (EC-14) — `tau2-summarize.py` depende do schema do tau2**: Sierra pode mudar entre versões. Mesmo padrão: pin exato + teste de parsing que falha rápido se shape mudar.
   - **R3 (EC-15) — Variação > 1pp entre 3 runs no baseline freeze**: se não atingir estabilidade, opções (não pré-decididas): aumentar n para 6 (mediana mais robusta), forçar `temperature: 0`, ou documentar variância maior. Decidir caso a caso quando ocorrer.
   - **R4 (EC-16) — GitHub Actions timeout 90min** (nightly): pode ficar apertado quando todas as fases v2.0 estiverem rodando. Se nightly real exceder, subir `timeout-minutes` para 240 (4h). Aceitável até 6h (limite GH free).
   - **R5 (EC-17) — OpenRouter rate limit em burst**: BFCL pode disparar 200+ requests rápido. Se aparecer `429`, adicionar `--max-workers 4` ao `bfcl generate`. Não pré-implementar — esperar evidência.

   **Riscos adicionais do v2.0 (extensões + multi-camada):**
   - **R6 (EC-40) — Bridge é eval-only, não público**: `_theokit_memory.path` aceita path arbitrário. Aceitável porque bridge roda apenas em `localhost` durante evals (sem deploy público). Nota explícita no topo do README: "bridge não é serviço — não expor. Path arbitrário em `_theokit_memory` confia no caller."
   - **R7 (EC-41) — Custo HumanEval estimado em US$ 25 é otimista**: 164 problemas × 2 rodadas × multi-turn pode estourar para US$ 50+ em modelos lentos/verbosos. Mitigação: flag `--limit N` no runner para subset; orçamento ajustável; medir custo real na primeira execução.
   - **R8 (EC-42) — TTFT depende de latência externa do provider**: variância de OpenRouter pode falsificar regressão (TTFT subiu pela network, não pelo SDK). Mitigação já no plano: warmup descartado + p50/p95 sobre N=3 medições (EC-36). Aceitar variância ≤ 15% como ruído.
   - **R9 (EC-43) — Tokenizer aproximado em NIAH (chars/4)**: tamanhos "1K/4K/16K tokens" usam aproximação. Tokenizer real varia por modelo. Margem suficiente para sinal pretendido (recall em haystacks pequenos ≥ 0.9). Não vale adicionar `tiktoken` só para isso.
   - **R10 (EC-44) — Matriz multi-modelo US$ 240 é mediana plausível**: preço por token varia até 10x entre modelos. Mitigação: primeira execução usa `--limit 50` (subset) para calibrar; orçamento revisado antes de rodar matriz completa.
   - **R11 (EC-45) — Matriz 4h perto do limite GH Actions free 6h**: se um benchmark ficar lento (rate limit), matriz pode estourar. Mitigação: matriz roda via `workflow_dispatch` manual (não cron), com retry. Documentado em D15.

3. Linkar para os dois edge case reviews:
   - `.claude/knowledge-base/reviews/edge-cases/agentic-eval-bridge-edge-cases.md` (v1.1)
   - `.claude/knowledge-base/reviews/edge-cases/agentic-eval-bridge-v2-edge-cases.md` (v2.0)

#### Acceptance Criteria
- [ ] README cobre os 4 caminhos: dev local, CI nightly, atualização de baseline, leitura de relatório.
- [ ] Seção "Risks & Mitigations" lista R1-R11 com fix-on-demand explícito.
- [ ] Tamanho ≤ 400 linhas (sobe de 250 para acomodar R6-R11 + documentação do schema `Case`/`Step` + protocolos `_theokit_*` + namespace de contract tests).

#### DoD
- [ ] Revisado por leitura — instruções reproduzíveis.
- [ ] Cada risco em R1-R11 tem uma mitigação acionável documentada (não vaga).
- [ ] Aviso explícito no topo: "bridge é eval-only — não expor publicamente".

---

## Coverage Matrix

### Surface area do `@usetheo/sdk` (mapeada contra `docs.md`)

| # | Capacidade do SDK | Camada | Fase(s) | Sinal |
|---|---|---|---|---|
| 1 | `Agent.create` + `agent.send` loop básico | A | 2 | BFCL `simple` ≥ baseline |
| 2 | `tools` option + tool_calls structured | A | 2 | BFCL `multiple` + `parallel` ≥ baseline |
| 3 | Multi-turn com tool_calls history (EC-2 / D10) | A | 3 | τ²-retail pass_rate ≥ baseline |
| 4 | Memory file manager | A | 6 | LoCoMo recall_at_k ≥ baseline |
| 5 | Memory search (keyword + semantic) | B | 6 | Suite memory: search fixtures pass |
| 6 | Memory dreaming (consolidation) | B | 6 | Suite memory: dreaming fixture pass |
| 7 | Memory active (auto-write cross-run) | B | 6 | Suite memory: active_recall fixture pass |
| 8 | Context manager (file sources + snapshot) | A | 7 | NIAH adaptado pass_rate ≥ 0.9 |
| 9 | MCP stdio servers | B | 8 | Suite MCP: 4 fixtures filesystem pass |
| 10 | MCP http servers (via setup futuro) | B | 8 | Suite MCP: fixtures fetch/sequential-thinking pass |
| 11 | Hooks pre/post tool | B | 9 | Suite hooks: fire-order fixtures pass |
| 12 | Hooks pre/post message | B | 9 | Suite hooks: modification fixtures pass |
| 13 | Hooks block (early exit) | B | 9 | Suite hooks: block fixture pass |
| 14 | Skills frontmatter + auto-inject | B | 10 | Suite skills: list + invoke fixtures pass |
| 15 | Subagents (parent/child) | A | 11 | HumanEval delta com vs sem subagents reportado |
| 16 | Streaming callbacks `onStep` | B | 12 | Suite streaming: step_count > 0 |
| 17 | Streaming callbacks `onDelta` (TTFT/TPOT) | B | 12 | TTFT p50 < 2s |
| 18 | Provider fallback chain | B | 13 | Suite chaos: 100% pass com primary mockado falhando |
| 19 | Multi-modelo (Claude / GPT / Gemini) | A | 14 | Matriz 3×5 publicada como REPORT.md |
| 20 | Cron (`Cron.create/list/delete`) | C | 15 | Contract test verde |
| 21 | Theokit namespace (`me`, `models.list`, `repositories.list`) | C | 15 | Contract test verde |
| 22 | Send overrides (`model`, `tools`, `temperature` per-request) | C | 15 | Contract test verde |
| 23 | Erros tipados (hierarchy `TheokitAgentError` + filhos) | C | 15 | Contract test verde para 100% das classes |

### Requirements de infraestrutura

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 24 | Sem régua quantitativa externa para o SDK | T0.1, T0.2 | Estrutura de evals criada |
| 25 | Bridge HTTP entre SDK (TS) e runners (Python) | T1.1, T1.1.b | Servidor OpenAI-compatible + extensões `_theokit_*` + SSE |
| 26 | Comparação automática contra baseline | T4.1 | `compare.ts` com exit 1 em regressão |
| 27 | Baselines congelados em Git | T4.2 + Phases 6-13 | JSONs versionados por benchmark/suite |
| 28 | CI nightly que falha em regressão | T5.1 | Workflow GitHub Actions + `nightly.ts` |
| 29 | Documentação operacional | T5.2 | `evals/README.md` runbook |
| 30 | Sem impacto no bundle do SDK publicado | D1, T0.1 | Tudo fora de `packages/sdk/src/` |
| 31 | Sem violação de `no-stubs-no-mocks-no-wired` | D1 | Bridge não exporta nada via `@usetheo/sdk` |
| 32 | Custo controlado (≤ US$ 80/run nightly) | Phases 2-13 | Medido por fase no relatório |
| 33 | Sem novas deps no SDK | D3 | `node:http` nativo, sem fastify/hono |
| 34 | **(EC-1)** Concorrência sem cross-contamination | D9, T1.1, T1.1.b | `memory: undefined` por default; override explícito em Phase 6 |
| 35 | **(EC-2)** Histórico de tool calls preservado no INPUT | D10, T1.1 | Translate cobre assistant+tool_calls e role:tool |
| 36 | **(EC-3,4,11,12)** Robustez do server | T1.1 | 4 testes RED + fail-fast + handler EADDRINUSE |
| 37 | **(EC-5)** Concorrência amplificada (τ² agent+user) | T1.1 | Teste concorrência 10x paralelo |
| 38 | **(EC-9,10)** Runners resilientes (timeout, venv corrompido) | T2.1 | `timeout 30m` + detecção venv parcial |
| 39 | **(EC-6,7,8)** Comparator robusto | T4.1 | 3 testes RED + validação explícita |
| 40 | **(EC-13 a EC-17)** Riscos aceitos documentados | T5.2 | Seção Risks & Mitigations com R1-R5 |

### Gaps explicitamente fora de escopo (documentados)

| Capacidade | Razão | Quando entra |
|---|---|---|
| Cloud surface (artifacts, autoCreatePR, envVars, git metadata) | Theo PaaS pre-release (D17) | Phase 16 quando TheoCloud for GA |
| `Agent.resume()` cross-process | Requer infraestrutura de persistência compartilhada (D17) | Phase 16 ou futuro |
| Comparação harness × harness (LangChain, OpenAI Agents SDK, Vercel AI) | Requer Inspect AI (D8) | `agentic-eval-bridge-v3` (plano futuro) |

### Edge cases v2.0 incorporados

| # | Edge case | Resolução | Fase |
|---|---|---|---|
| 41 | **(EC-18)** hooks-registry pattern (string→função) | Sub-task em T9.1 + extensão D14; padrão replicado em T11.1 (subagents-registry) | T9.1, T11.1 |
| 42 | **(EC-19)** HumanEval sem sandbox | ADR D18 + Dockerfile + exec.sh | T11.1 |
| 43 | **(EC-20)** Cron leak sem cleanup | `afterEach` + namespace isolado + bulk-delete `afterAll` | T15.1 |
| 44 | **(EC-21)** nightly aborta sequência em primeira falha | `try/catch` por runner + FAILURES.json + exit 1 só no final | T5.1 |
| 45 | **(EC-22)** active recall multi-run sem schema | Schema com `steps: [Step]` + `shared.memory_path` template | T6.2 |
| 46 | **(EC-23,24,25)** Robustez bridge extensions (tipagem, disconnect, SSE timeout) | 5 testes RED em T1.1.b | T1.1.b |
| 47 | **(EC-26,27,28)** Memory: path único, LoCoMo precisa memory ativo, dispose isolado | Schema steps + verify tests | T6.1, T6.2 |
| 48 | **(EC-29)** NIAH determinístico | Seed obrigatório, baseline reproduzível | T7.1 |
| 49 | **(EC-30,31,32)** MCP: cache npm, crash behavior, tmpdir isolado | actions/cache + fail behavior + mktemp | T8.1 |
| 50 | **(EC-33,34)** Hooks timeout + Skills frontmatter inválido | Timeout 1s + erro tipado | T9.1, T10.1 |
| 51 | **(EC-35,36)** HumanEval problem timeout + Streaming warmup+repeticões | timeout 30s + N=3 + warmup descartado | T11.1, T12.1 |
| 52 | **(EC-37,38)** Mock primary porta dinâmica + cleanup trap | `:0` + SIGINT/SIGTERM trap | T13.1 |
| 53 | **(EC-39)** Contract test gate `EVAL_CONTRACT=1` | vitest skipIf | T15.1 |
| 54 | **(EC-40 a EC-45)** Riscos documentados | R6-R11 em T5.2 Risks & Mitigations | T5.2 |

**Coverage: 54/54 in-scope requirements covered (100%)** — 23 capacidades de surface + 17 requirements de infra + 14 edge cases v2.0 incorporados aos blocos TDD/ADR. 3 capacidades explicitamente fora de escopo com gate de entrada documentado.

## Global Definition of Done

### Infraestrutura

- [ ] Todas as 16 fases (Phase 0-15 + Phase 16 dogfood) completas.
- [ ] Todos os testes verdes: `pnpm test` (166 pré-existentes + bridge + runner + compare + 4 contract suites + 8 suite runners = ≥ 280 total).
- [ ] Zero warnings em `pnpm check` (Biome).
- [ ] `pnpm typecheck` verde.
- [ ] `pnpm build` verde — bridge e suites não quebram build do SDK.
- [ ] `pnpm quality:dead` (knip) sem código órfão novo.
- [ ] `pnpm quality:cycles` sem ciclos novos.
- [ ] `pnpm quality:loc` — nenhum arquivo de eval excede 500 linhas (250 para arquivos do bridge).
- [ ] `pnpm quality:duplication` sem duplicação > threshold.
- [ ] `pnpm validate:publint` verde (evals não afetam pacote publicado).
- [ ] `pnpm validate:attw` verde.

### CI e baselines

- [ ] Workflow `evals-nightly` rodou ≥ 1x verde via `workflow_dispatch`.
- [ ] 8 baselines em Git: `bfcl-v3`, `tau2-retail`, `locomo`, `niah`, `mcp-suite`, `hooks-suite`, `skills-suite`, `humaneval-ablation`, `streaming-perf`, `fallback-suite`.
- [ ] `evals/README.md` cobre runbook completo + seção Risks & Mitigations + lista de gaps fora de escopo.
- [ ] Matriz multi-modelo (Phase 14) rodou ≥ 1x e produziu `REPORT.md` antes do release.

### Cobertura de surface area

- [ ] **Camada A (benchmarks padrão)**: BFCL + τ² + LoCoMo + NIAH + HumanEval-ablation publicados com scores ≥ baseline.
- [ ] **Camada B (suites comportamentais)**: memory + MCP + hooks + skills + streaming + fallback com pass_rate documentado (alvo ≥ 0.85 cada).
- [ ] **Camada C (contract tests)**: Cron + Theokit namespace + Send overrides + Erros tipados todos verdes.
- [ ] **23/23 capacidades de surface** cobertas com sinal de maturidade explícito.

### Garantias críticas de qualidade

- [ ] **MUST FIX EC-1 verificado**: teste `test_factory_omits_memory` passa; smoke concorrência 10x paralelo não corrompe estado; bridge stateless por default (D9).
- [ ] **MUST FIX EC-2 verificado**: BFCL `multi_turn` reporta score > 0 — histórico de tool calls preservado (D10).
- [ ] **Runtime-metric proof** para CADA fase:
  - BFCL: score > 0 em todas as 4 categorias (não apenas `simple`).
  - τ²-retail: pass_rate > 0.
  - LoCoMo: recall_at_k > 0.
  - NIAH: pass_rate > 0.9 em haystacks ≤ 4K.
  - Cada suite B (memory/MCP/hooks/skills/streaming/fallback): pass_rate > 0 com PELO MENOS uma fixture passando, comprovando que o caminho real foi exercitado.
  - HumanEval-ablation: `delta_pp` reportado (positivo ou negativo, mas medido).
- [ ] Custo nightly total ≤ US$ 80; matriz pré-launch ≤ US$ 240.
- [ ] **Dogfood QA PASS** — health score >= 70, zero CRITICAL.

## Phase 16: Dogfood QA Full (MANDATORY)

> Roda após todas as fases acima. Plan não está completo até passar.

**Objective:** validar que o pipeline completo (Camadas A + B + C + matriz multi-modelo) funciona como um dev real experimentaria, com setup do zero.

### Execution

```bash
# 1. clean slate
git stash && git checkout main && git pull
git checkout feat/sdk-implementation && git stash pop

# 2. setup do zero (simula novo dev)
rm -rf node_modules evals/.venv evals/results
pnpm install --frozen-lockfile
pnpm build

# 3. Camada C (rápido, sem bridge)
pnpm test:contract

# 4. Camada A + B via pipeline nightly
pnpm eval:nightly

# 5. Validar relatório agregado
test -f "evals/results/$(ls -t evals/results/ | head -1)/REPORT.md" \
  || { echo "REPORT.md não gerado"; exit 1; }

# 6. (opcional, antes de release) matriz multi-modelo
# pnpm eval:matrix
```

### Acceptance Criteria

- [ ] Setup do zero (clean clone + install) leva ≤ 15 min.
- [ ] Bridge inicia em ≤ 2s após `pnpm eval:bridge`.
- [ ] **Camada A** — 5 runners produzem summary.json válidos: BFCL, τ², LoCoMo, NIAH, HumanEval-ablation.
- [ ] **Camada B** — 6 suites produzem summary.json válidos: memory, MCP, hooks, skills, streaming, fallback.
- [ ] **Camada C** — 4 contract tests verdes.
- [ ] `compare.ts` exit 0 contra baselines congelados de TODOS os runners/suites (Phase 4 + Phases 6-13).
- [ ] **REPORT.md agregado** gerado automaticamente após nightly, com:
  - Tabela por camada (A/B/C) com score atual + baseline + delta.
  - Seção "Out of scope" listando gaps documentados (cloud, resume cross-process, harness comparison).
  - Custos totais por fase.
- [ ] Custo total observado ≤ US$ 80 (nightly).
- [ ] Tempo total ≤ 4h.
- [ ] Zero CRITICAL issues introduzidos por este plano nas suítes existentes (`pnpm test` verde).
- [ ] Zero HIGH issues em arquivos modificados (`pnpm check` verde).

### If Dogfood Fails

1. Classificar issues: causadas por este plano vs pré-existentes.
2. Identificar em qual camada/fase falhou — relatório por fase facilita debug.
3. Corrigir todos os CRITICAL e HIGH causados pelo plano antes de declarar completo.
4. Re-rodar dogfood até verde.
5. Issues pré-existentes documentadas (não bloqueiam, mas listadas em revisão).

### Gate de Lançamento (release candidate)

Antes de tagear release pública do SDK, executar adicionalmente:

```bash
pnpm eval:matrix
```

- [ ] Matriz 3×N produz `evals/results/matrix/{date}/REPORT.md` sem erros.
- [ ] Custo da matriz ≤ US$ 240.
- [ ] `REPORT.md` linkado no README do `@usetheo/sdk` na entrada de release notes.

Sem esse passo, **não há gate de maturidade pré-launch** — o release fica restrito ao baseline do nightly (1 modelo).
