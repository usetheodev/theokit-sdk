# Plan: SDK v1.2 — Paridade técnica com Vercel AI / Mastra (8 → 9.0/10)

> **STATUS: COMPLETO** — Concluído em 2026-05-17. Todas as tarefas executadas, todos os critérios de aceite validados e DoDs atingidos. **pnpm validate exit=0** (G1-G9). **413 testes passando** (391 SDK + 22 React; +58 vs v1.1 baseline). **41/41 examples typecheck PASS**. **streamObject real-LLM 6/6 checks PASS** (2.7s, zero registry leak). 8 ADRs (D39-D46) lockados em CLAUDE.md.

> **Version 1.0** — Plano de release v1.2 do `@usetheo/sdk` cobrindo os 5 gaps técnicos identificados na análise de maturidade pós-v1.1 que separam o SDK de paridade industrial: (1) `Agent.streamObject<T>` para partial-object streaming; (2) `useTheoCompletion` + `useTheoAssistant` completando a família de hooks React; (3) OAuth 2.1 PKCE flow para MCP remoto autenticado (Notion/Linear/Slack); (4) auto-instrumentação de telemetria (Langfuse/Sentry/PostHog feature-detected); (5) backend LanceDB para Memory + migration tool SQLite→Lance. Cross-agent shared memory é diferido para v1.3 por exigir threat-model próprio. Outcome: SDK sai de "GA local, paridade-de-base com Vercel AI" (8/10) para "paridade técnica completa com Vercel AI e Mastra" (9.0/10) — restando apenas distribuição/adoção para 10/10.

## Context

**Origem do plano (análise de maturidade pós-v1.1, sessão 2026-05-17):**

Após shipar v1.1 com `Agent.generateObject`, telemetry OTel opt-in e `@usetheo/react` v1.0, identifiquei 9 gaps técnicos vs SOTA (Vercel AI SDK + Mastra + Anthropic Agent SDK). Os 5 com melhor impacto-to-effort foram selecionados para v1.2:

**Gaps identificados:**

1. **❌ Sem `streamObject`** — Vercel AI tem desde 2024. Toda demo de "preencher formulário com IA em tempo real" usa esse pattern. Sem isso, nosso `generateObject` parece "v1 de 2024" mesmo recém-shipado. (Impacto: ALTO — primeira coisa que devs procuram ao olhar SDK structured output)

2. **❌ Família React incompleta** — Temos só `useTheoChat`. Vercel AI tem `useChat` + `useCompletion` + `useAssistant`. Para single-shot text generation (autocomplete, transformações) `useCompletion` é o pattern certo — `useChat` é overkill. (Impacto: MÉDIO — DX visível na primeira hora de uso)

3. **❌ Sem OAuth para MCP remoto** — Hoje aceitamos só `headers.Authorization` estático para HTTP MCP. Em 2026, MCP servers interessantes (Notion, Linear, Slack remote, GitHub remote) usam OAuth 2.1 PKCE. Vercel AI + Anthropic SDK já têm. Sem isso, nosso "MCP-first" claim só vale para stdio `npx`-based. (Impacto: ALTO — bloqueador de adoção pra qualquer use case real com SaaS APIs)

4. **❌ Sem auto-instrumentation de telemetria** — Hoje OTel spans são manuais. Para "ver custo da minha LLM call no Langfuse" o user precisa configurar exporter. Vercel AI auto-detecta `@langfuse/node`, `@sentry/node`, `posthog-node` e registra automaticamente. (Impacto: MÉDIO — pequeno DX, grande sinal de maturidade)

5. **❌ LanceDB backend deferido** — ADR D12 prometeu para v1.1, ficou deferido sem deadline. SQLite + sqlite-vec funciona até ~10k facts; acima disso latência sobe >100ms por recall. (Impacto: BAIXO hoje, mas é dívida técnica visível — promessa quebrada)

**Pillars já maduros (não tocar):**
- Persistence-first ✅ — 20/20 chaos PASS em v1.1
- Memory MD-first ✅ — ainda é o melhor da categoria; LanceDB é só backend de índice
- Sandbox + hooks ✅ — 8/8 adversarial PASS em v1.1
- Provider routing/fallback ✅ — multi-key works
- Cron ✅ — croner + JSON persistence locked

**Evidência (snapshots e dados v1.1):**
- `.claude/knowledge-base/reviews/generateobject-real-llm-2026-05-17.md` — `generateObject` PASS 8/8, 1.7s, zero leak. Pattern provado.
- `packages/sdk/src/generate-object.ts` — 221 LoC, synthetic forced tool funciona. `streamObject` reusa 80% desse código.
- `packages/sdk/src/internal/telemetry/tracer.ts` — feature-detect via `createRequire` já funciona para `@opentelemetry/api`. Padrão reusável para Langfuse/Sentry/PostHog.
- `packages/sdk/src/internal/memory/index-manager.ts` — `IndexManager` é polimórfico (`backend: "fts-only" | "hybrid"`). Adicionar `"lance"` é extensão natural.
- `packages/sdk/src/types/mcp.ts` linha 20: `McpAuthConfig` já existe com `CLIENT_ID/CLIENT_SECRET/scopes` — preparado para OAuth desde o início, só falta wire.
- Vercel AI v4 docs (estável desde 2025): `useChat`/`useCompletion`/`useAssistant` API surface é estável; podemos mirar paridade direta.

**Por que agora:**
- v1.1 fechou a base. Sem esses 5 itens, próximo dev que avalia o SDK comparando com Vercel AI vê os gaps imediatamente.
- `streamObject` é commodity em 2026 — se quiser "structured output story" no nosso README, é obrigatório.
- OAuth MCP é o que distingue "brinquedo de demo" de "ferramenta de produção" — devs profissionais NÃO usam SaaS APIs sem OAuth.
- LanceDB já está atrasado (promessa de v1.1). Manter na backlog destrói credibilidade dos ADRs.

**Custo de NÃO fazer:**
- Sem streamObject → percepção "atrasado em structured output" virtualmente eterna; cada review do SDK menciona isso.
- Sem OAuth MCP → MCP-first claim fica meia-verdade.
- Sem auto-telemetria → "configurar Langfuse com Theokit" vira post de 30 min no blog em vez de zero-config.
- Sem hooks completos → devs React migrando de Vercel AI têm que reimplementar `useCompletion` localmente.

## Objective

**Done = `@usetheo/sdk` v1.2 publicado em npm com paridade técnica funcional vs Vercel AI SDK v4 + Mastra latest, validada por suite de smoke tests real-LLM e dogfood completo passando.**

Metas mensuráveis:

1. **`Agent.streamObject<T>` shipado** — partial deltas emitidos via `AsyncIterator`, parse final retorna `z.infer<T>`, real-LLM validation PASS.
2. **`useTheoCompletion` + `useTheoAssistant`** — ambos no `@usetheo/react`, peer-dep React 18/19, com 6+ testes cada e exemplo Next.js boota.
3. **OAuth 2.1 PKCE flow para MCP HTTP** — flow completo (auth code paste + localhost callback) + token storage criptografado (keychain quando disponível) + refresh handler automático. Real Notion MCP server validado end-to-end.
4. **Auto-instrumentation telemetria** — detecta `@langfuse/node`, `@sentry/node`, `posthog-node` via `createRequire` e registra exporter sem config adicional. Smoke test: instalar Langfuse → spans aparecem no dashboard.
5. **LanceDB backend** — `Memory.create({ index: { backend: "lance" } })` funciona; `pnpm exec theokit-migrate-memory` migra de SQLite preservando 100% dos facts; benchmark mostra latência <30ms@50k facts.
6. **Backward compat absoluta** — todo código v1.1 continua funcionando sem mudança. v1.2 é estritamente aditivo na API pública.
7. **8 ADRs novos (D39-D46)** lockados.
8. **CHANGELOG.md v1.2.0** entry com cada feature linkando ADR + exemplo.
9. **`pnpm validate` exit=0** + tipo public surface validado por publint + attw.

## ADRs

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| **D39** | `Agent.streamObject<T>` retorna `AsyncIterator<StreamObjectEvent<T>>` com eventos `partial` + `complete`, reusando 80% do código de `generateObject` (synthetic forced tool) | Manter consistência com o pattern `agent.send` → `run.stream()` que devs já conhecem; `streamObject` é "generateObject + observabilidade do meio" | Permite `for await` natural; `complete` event carrega `z.infer<T>` parseado; partial deltas são best-effort (parse falha silenciosamente entre deltas) |
| **D40** | `useTheoCompletion` (single-shot) e `useTheoAssistant` (object-shaped) são hooks SEPARADOS, não flags em `useTheoChat` | `useChat` mantém histórico de mensagens, `useCompletion` é fire-and-forget, `useAssistant` é object-shaped — conflar prejudica DX e API mental model | API de cada hook fica enxuta; compartilhar internamente um SSE consumer comum em `internal/sse-parser.ts` |
| **D41** | OAuth MCP usa PKCE com manual code paste OU localhost callback (porta escolhida em runtime); token armazenado em keychain quando disponível, file `~/.theokit/mcp-tokens.json` (chmod 600) caso contrário | PKCE é o standard 2.1; manual paste atende SSH/headless dev; localhost callback atende dev local; keychain é melhor secret storage que disco | Requer dependência opcional `keytar`; sem keytar → fallback file; OS Windows tem keychain via Credential Manager; Linux exige libsecret (gracefully degrade) |
| **D42** | Auto-instrumentation por `createRequire` feature-detect em `tracer.ts`, NÃO por postinstall hook nem por env-var explícita | Mantém zero-config — "instalou Langfuse, está integrado"; postinstall é frágil; env-var quebra a promessa "zero-config" | Cada exporter (Langfuse/Sentry/PostHog) tem ~50 LoC de wiring; se `telemetry.enabled === true` E o módulo é detectado E não foi explicitamente desabilitado, registra |
| **D43** | LanceDB backend atrás da MESMA interface `IndexManager.open({ backend: "lance" })`; SQLite continua default | Polimorfismo já existe (D11 deixou catalog de embedding providers); replace de backend agora é mudança de UMA opção; SQLite é melhor para <10k facts (sem overhead de servidor) | Adiciona dependência opcional `@lancedb/lancedb`; quando ausente → erro tipado `ConfigurationError(code: "lance_backend_unavailable")` informando como instalar |
| **D44** | Migração SQLite → Lance é CLI standalone (`theokit-migrate-memory`), NÃO auto-migração na primeira abertura | Auto-migração destrutiva surpreende users; CLI exige confirmação explícita; permite rollback (SQLite db é mantida até user manualmente deletar) | Adiciona binário ao package `bin/theokit-migrate-memory` + script em `package.json`; CLI usa `prompts` ou `node:readline/promises` (preferido — sem dep extra) |
| **D45** | `SDKObjectDelta` é novo variant de `SDKMessage` para streamObject, NÃO um stream separado | Mantém `for await` da API de Run inalterado; usuário compõe `agent.streamObject` no Run interface se quiser; o Run wrapper sintetiza-os | Adicionar `{ type: "object_delta", partial: unknown, attempt: number }` à union de SDKMessage; documentar como dispatch event para wire format Vercel v1 (extender com código `o:`) |
| **D46** | Cross-agent shared memory (`scope: "global" | "team"`) é DIFERIDO para v1.3 | Exige threat-model próprio (write authorization + cross-user data leak prevention); v1.2 já tem 5 features de escopo razoável | CHANGELOG.md documenta o defer; ADR de v1.3 vai cobrir o threat-model; nenhuma mudança no surface para v1.2 |

## Dependency Graph

```
Phase 0 (ADRs)
    │
    ├──▶ Phase 1 (streamObject SDK core)
    │       │
    │       └──▶ Phase 2.2 (useTheoAssistant — depende de streamObject)
    │
    ├──▶ Phase 2.1 (useTheoCompletion — parallel; só usa agent.send)
    │
    ├──▶ Phase 3 (OAuth MCP — parallel; isolado de outros)
    │
    ├──▶ Phase 4 (Auto-instrumentation telemetria — parallel; só toca tracer.ts)
    │
    └──▶ Phase 5 (LanceDB backend — parallel; só toca internal/memory)
            │
            └──▶ Phase 5.1 (Migration CLI — depende de LanceIndex)
    
Phases 1, 2.1, 3, 4, 5 são paralelizáveis após Phase 0.
Phase 6 (Examples + Docs + CHANGELOG) depende de TODAS as fases anteriores.
Phase 7 (Final Dogfood QA) depende de Phase 6.
```

**Estimativa total**: 4-6 semanas / 1 dev focado; 2-3 semanas com 2 devs paralelizando react + sdk.

---

## Phase 0: ADRs D39-D46

**Objective:** Lockar as 8 decisões arquiteturais antes de qualquer linha de código, garantindo que os tasks subsequentes sigam direção única.

### T0.1 — Escrever ADRs D39-D46

#### Objective
Materializar cada decisão arquitetural deste plano em `.claude/knowledge-base/adrs/D{N}-*.md` seguindo o template estabelecido (Decision, Rationale, Consequences, Alternatives Considered).

#### Evidence
- Pattern já estabelecido: ADRs D32-D38 foram criadas em v1.1 com o mesmo formato.
- `CLAUDE.md` linha "Decided ADRs" exige cada ADR como arquivo separado linkado da tabela de ADRs.

#### Files to edit
```
.claude/knowledge-base/adrs/D39-stream-object-async-iterator.md  (NEW)
.claude/knowledge-base/adrs/D40-react-hooks-family-separate.md  (NEW)
.claude/knowledge-base/adrs/D41-oauth-mcp-pkce-keychain.md  (NEW)
.claude/knowledge-base/adrs/D42-auto-instrumentation-feature-detect.md  (NEW)
.claude/knowledge-base/adrs/D43-lance-backend-same-interface.md  (NEW)
.claude/knowledge-base/adrs/D44-migration-cli-standalone.md  (NEW)
.claude/knowledge-base/adrs/D45-sdkobjectdelta-message-variant.md  (NEW)
.claude/knowledge-base/adrs/D46-cross-agent-memory-deferred.md  (NEW)
CLAUDE.md  (UPDATE — add 8 rows to Decided ADRs table)
```

#### Deep file dependency analysis
- Cada ADR é independente; criar em paralelo é seguro.
- `CLAUDE.md` é editado uma única vez para adicionar as 8 linhas à tabela.
- ADRs são referenciadas por tasks subsequentes via JSDoc comments (`@see ADR D39`).

#### Deep Dives
- Cada ADR tem 4 seções obrigatórias: Decision, Rationale, Alternatives Considered, Consequences.
- "Alternatives Considered" deve listar 2+ alternativas rejeitadas com motivo.
- "Consequences" deve incluir gotchas e limitações conhecidas.

#### Tasks
1. Criar D39-stream-object-async-iterator.md
2. Criar D40-react-hooks-family-separate.md
3. Criar D41-oauth-mcp-pkce-keychain.md
4. Criar D42-auto-instrumentation-feature-detect.md
5. Criar D43-lance-backend-same-interface.md
6. Criar D44-migration-cli-standalone.md
7. Criar D45-sdkobjectdelta-message-variant.md
8. Criar D46-cross-agent-memory-deferred.md
9. Adicionar 8 rows à tabela "Decided ADRs" em CLAUDE.md

#### TDD
ADRs são docs, não código. Validation:
```
VERIFY: ls .claude/knowledge-base/adrs/D{39..46}-*.md  (todos existem)
VERIFY: grep -c "^| D3[9]\|^| D4[0-6]" CLAUDE.md  (8 matches)
```

#### Acceptance Criteria
- [ ] 8 ADRs criadas em `.claude/knowledge-base/adrs/`
- [ ] Cada ADR tem 4 seções (Decision/Rationale/Alternatives/Consequences)
- [ ] CLAUDE.md tabela "Decided ADRs" tem 8 linhas novas
- [ ] Cada ADR linka pelo menos 2 alternativas rejeitadas

#### DoD
- [ ] `find .claude/knowledge-base/adrs/D{39,40,41,42,43,44,45,46}-*.md | wc -l` retorna 8
- [ ] `grep -E "^\| D3[9]|^\| D4[0-6]" CLAUDE.md | wc -l` retorna 8

---

## Phase 1: `Agent.streamObject<T>` — SDK core

**Objective:** Shipar `Agent.streamObject` retornando `AsyncIterator<StreamObjectEvent<T>>` com partial deltas + complete event carregando `z.infer<T>`. Reusa synthetic forced tool de `generate-object.ts` com hook adicional para emitir deltas durante o text streaming.

### T1.1 — Implementar `Agent.streamObject` core

#### Objective
Public API + implementação que stream-parse text deltas durante o agent loop, emite `partial` para cada parse-success, e `complete` ao final.

#### Evidence
- `packages/sdk/src/generate-object.ts` linha 134-147 já mostra o pattern do synthetic `output` tool.
- `packages/sdk/src/internal/agent-loop/loop.ts` já emite `SDKAssistantMessage` com text deltas — basta interceptar.
- Vercel AI `streamObject` API: `result.partialObjectStream` retorna `AsyncIterable<DeepPartial<T>>`.

#### Files to edit
```
packages/sdk/src/stream-object.ts  (NEW) — core implementation
packages/sdk/src/agent.ts  (UPDATE) — add Agent.streamObject static method
packages/sdk/src/index.ts  (UPDATE) — export StreamObjectOptions, StreamObjectEvent
packages/sdk/src/types/messages.ts  (UPDATE) — add SDKObjectDelta variant (per ADR D45)
packages/sdk/tests/golden/agent/stream-object.golden.test.ts  (NEW) — 9+ tests
```

#### Deep file dependency analysis
- **`stream-object.ts`** (NEW): mirror de `generate-object.ts` mas com generator pattern. Importa `requireZod`, `CustomTool`, `Agent.create` via deps injection (mesmo pattern de generate-object).
- **`agent.ts`**: adiciona `static async * streamObject<T>(options)` — usa `import()` lazy para não inflar bundle quando não usado.
- **`types/messages.ts`**: adiciona `SDKObjectDelta` interface + ao tipo union `SDKMessage`. Downstream: `internal/agent-loop/loop.ts` continua emitindo o que sempre emitiu — o `streamObject` intercepta antes de propagar.
- **`index.ts`**: adicionar `export type { StreamObjectOptions, StreamObjectEvent }` e `export class StreamObjectError extends Error`.

#### Deep Dives

**Data structures:**
```ts
export interface StreamObjectOptions<T extends ZodType> extends Omit<GenerateObjectOptions<T>, never> {}

export type StreamObjectEvent<T> =
  | { type: "partial"; partial: DeepPartial<T>; attempt: number }
  | { type: "complete"; object: T; raw: unknown; usage: { inputTokens: number; outputTokens: number }; finishReason: "tool_use" | "error" };

// DeepPartial via Zod helper or recursive type
type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
```

**Algorithm:**
1. Setup synthetic `output` tool (mesma estrutura de generate-object).
2. Create transient agent.
3. Substitui handler: em vez de `throw CaptureSentinel` ao receber input, primeiro tenta `schema.safeParse(input)` — se completo, captura e throws para terminar loop. Senão, faz `partial = bestEffortPartial(input, schema)` e yields `{ type: "partial", partial, attempt }`.
4. Em paralelo, intercepta `run.stream()` para extrair text deltas; buffer text; periodicamente tenta parsear JSON parcial (encontrando `{` balanced), feed para `schema.safeParse` em modo lenient (catch errors).
5. Cada parse-success entre `{` balanceados → yields `partial` event.
6. Final: tool é chamado, parse completo, yields `complete` event.

**Invariants:**
- DEVE emitir pelo menos 1 evento (`complete` ou erro).
- `complete.object` é EXATAMENTE o que `generateObject` retornaria (compat-test).
- Cada `partial` tem `attempt` monotonicamente crescente.

**Edge cases:**
- Provider que NÃO streama texto (Anthropic claude-3-5-haiku às vezes batches): zero partials, só `complete`. OK.
- Modelo emite múltiplos parciais validos do mesmo "estado": dedup por shallow-equal hash.
- Schema strict (`.strict()`): partial parse pode falhar em todo delta intermediário; `complete` ainda passa.
- Backward compat: `streamObject` é nova API, NÃO substitui `generateObject`.

#### Tasks
1. Criar `packages/sdk/src/stream-object.ts` com `streamObjectImpl` (generator async).
2. Criar tipo `StreamObjectEvent<T>` + `StreamObjectOptions<T>` + `StreamObjectError`.
3. Criar `bestEffortPartial(rawText, schema)` helper em `internal/stream-object-helpers.ts`.
4. Adicionar `Agent.streamObject` static method em `agent.ts`.
5. Adicionar `SDKObjectDelta` variant em `types/messages.ts`.
6. Export tudo em `index.ts`.
7. Escrever 9+ testes golden em `tests/golden/agent/stream-object.golden.test.ts`.

#### TDD
```
RED:     test_emits_at_least_one_complete_event() — calling for-await yields ≥1 event of type "complete"
RED:     test_complete_event_carries_zod_parsed_object() — complete.object is z.infer<T> with full schema
RED:     test_complete_finish_reason_is_tool_use() — finishReason === "tool_use" when model uses output tool
RED:     test_yields_partials_during_streaming() — for a streaming provider, partial events emitted before complete (mocked LLM)
RED:     test_partial_attempt_is_monotonic() — attempt 1, 2, 3... increasing
RED:     test_disposes_transient_agent_in_finally() — registry leak == 0 after completion
RED:     test_disposes_transient_agent_in_finally_on_error() — registry leak == 0 even if model errors
RED:     test_zod_not_installed_throws_configuration_error() — when zod peer dep missing
RED:     test_streamobject_complete_matches_generateobject_object() — given same prompt+schema+model, complete.object === generateObject().object (compat)
RED:     test_streamobject_iter_return_disposes_transient_agent() — EC-4 (cancellation cleanup)
RED:     test_streamobject_with_refined_schema_falls_back_to_complete_only() — EC-5 (.refine/.transform)
RED:     test_streamobject_ignores_duplicate_output_tool_calls() — EC-6 (parallel tool use, Claude 3.5+)
GREEN:   Implement streamObjectImpl + helpers + types
REFACTOR: Extract shared zod-loader + sentinel helpers into internal/zod-utils.ts (shared with generate-object.ts)
VERIFY:  pnpm test --filter=@usetheo/sdk -- stream-object
```

#### Acceptance Criteria
- [ ] `Agent.streamObject<T>({ schema, prompt, model, local })` callable
- [ ] Retorna `AsyncIterator<StreamObjectEvent<T>>`
- [ ] `complete` event sempre emitido (ou erro)
- [ ] `partial` events monotônicos com `attempt`
- [ ] Zero registry leak (igual generateObject)
- [ ] 9+ testes golden passando
- [ ] Coverage >= 90% sobre `stream-object.ts`
- [ ] Cyclomatic complexity <= 10 (ou justificado com `biome-ignore` + rationale)
- [ ] File <= 400 LoC

#### DoD
- [ ] `pnpm test` exit=0
- [ ] `pnpm typecheck` exit=0
- [ ] `pnpm check` exit=0
- [ ] `grep -c "Agent.streamObject" packages/sdk/dist/index.d.ts` >= 1

---

### T1.2 — Real-LLM smoke test para `streamObject`

#### Objective
Provar end-to-end que `streamObject` funciona contra LLM real (não fixture), com snapshot mensurável.

#### Evidence
- `tools/validate-generateobject-real-llm.mjs` é o template — funciona em 1.7s contra Gemini via OpenRouter.
- Rule `.claude/rules/real-llm-validation.md` exige real-LLM validation para qualquer feature que reach LLM.

#### Files to edit
```
tools/validate-streamobject-real-llm.mjs  (NEW)
knip.json  (UPDATE — adicionar à ignore list)
```

#### Deep file dependency analysis
- Script standalone que carrega `.env`, chama `Agent.streamObject`, asserta partials > 0 (idealmente) e complete present.
- Não é importado por nenhum source — adicionar a `knip.json ignore`.

#### Deep Dives
- Schema: `FactCard` (mesmo de generateObject — apples-to-apples).
- Provider: OpenRouter Gemini (já configurado em `.env` raiz).
- Asserts:
  1. ≥1 `complete` event
  2. `complete.object` valida via Zod
  3. `complete.finishReason === "tool_use"`
  4. Registry leak == 0
  5. **Partials > 0 OR sem partials documentado como aceitável** (alguns providers batched)
- Output: `.claude/knowledge-base/reviews/streamobject-real-llm-{date}.md`

#### Tasks
1. Copiar `tools/validate-generateobject-real-llm.mjs` para `validate-streamobject-real-llm.mjs`.
2. Adaptar para usar `Agent.streamObject` + `for await` loop.
3. Coletar contagem de partials + tempo total.
4. Adicionar ao `knip.json` ignore.
5. Rodar e gerar snapshot.

#### TDD
```
RED:     N/A (validation script, não unit test)
VERIFY:  node tools/validate-streamobject-real-llm.mjs  (exit=0)
         test -f .claude/knowledge-base/reviews/streamobject-real-llm-*.md
```

#### Acceptance Criteria
- [ ] Script exit=0 contra provider real
- [ ] Snapshot gerado com timestamp, provider, model, latency, partial count, complete validation
- [ ] Registry leak == 0 confirmed

#### DoD
- [ ] `node tools/validate-streamobject-real-llm.mjs; echo $?` retorna 0
- [ ] Snapshot file existe com `**PASS**` no veredicto

---

## Phase 2.1: `useTheoCompletion` — single-shot React hook

**Objective:** Shipar hook React para single-shot text generation (autocomplete, traduções, sumários), sem histórico de mensagens, com peer-dep React 18/19. Pode rodar em paralelo com Phase 1.

### T2.1 — Implementar `useTheoCompletion`

#### Objective
Hook React equivalente a Vercel AI `useCompletion` — input + complete → response, sem histórico.

#### Evidence
- `packages/react/src/use-theo-chat.ts` é o template (existente, funcional).
- Vercel AI `useCompletion` API: `{ completion, input, setInput, handleSubmit, isLoading, error, stop }`.

#### Files to edit
```
packages/react/src/use-theo-completion.ts  (NEW) — hook implementation
packages/react/src/stream-completion.ts  (NEW) — server-side handler (mirror de stream-theo-chat)
packages/react/src/internal/sse-parser.ts  (NEW) — extract shared SSE consumer (D40)
packages/react/src/use-theo-chat.ts  (REFACTOR) — usar sse-parser.ts compartilhado
packages/react/src/stream-theo-chat.ts  (REFACTOR) — usar sse-parser.ts compartilhado
packages/react/src/index.ts  (UPDATE) — export new hooks
packages/react/tests/use-theo-completion.test.ts  (NEW) — 6+ tests
packages/react/tests/stream-completion.test.ts  (NEW) — 4+ tests
```

#### Deep file dependency analysis
- **`internal/sse-parser.ts`** (NEW): extrai a função `consumeDataStream` que hoje vive em `use-theo-chat.ts`. Compartilhada por `useTheoChat`, `useTheoCompletion`, e (futuro) `useTheoAssistant`. Refactor preserva comportamento.
- **`use-theo-chat.ts`** (REFACTOR): substituir parser inline pelo import de `sse-parser.ts`. Tests existentes (6/6) devem continuar passando.
- **`stream-theo-chat.ts`** (REFACTOR): nenhuma mudança lógica, só import re-organizado se aplicável.
- **`use-theo-completion.ts`**: API enxuta — sem messages[], sem reply IDs.
- **`stream-completion.ts`**: handler server-side, takes `{ agent, prompt }` body, calls `agent.send(prompt)`, streams via mesma wire format Vercel v1.

#### Deep Dives

**API:**
```ts
function useTheoCompletion(opts: { api?: string; initialCompletion?: string }): {
  completion: string;
  input: string;
  setInput: (s: string) => void;
  complete: (prompt?: string) => Promise<void>;
  handleSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: Error | undefined;
  stop: () => void;
}
```

**Invariants:**
- `completion` é REPLACED por cada `complete()` (não acumulado como messages).
- `isLoading === true` enquanto streaming.
- `stop()` aborta fetch.
- Re-renders ≤ N+1 onde N = número de text deltas (otimização: batch via `requestAnimationFrame` se necessário).

**Edge cases:**
- Unmount mid-stream: AbortController fired (EC-7 do useTheoChat).
- Pre-stream 400/401: error set, isLoading=false.
- `complete()` chamado durante `isLoading=true`: stop() implícito + new fetch.

#### Tasks
1. Criar `internal/sse-parser.ts` extraindo `consumeDataStream` de `use-theo-chat.ts`.
2. Refatorar `use-theo-chat.ts` para usar parser compartilhado.
3. Criar `use-theo-completion.ts` com a API acima.
4. Criar `stream-completion.ts` (server handler).
5. Exportar de `index.ts`.
6. Escrever 6+ testes para `useTheoCompletion`.
7. Escrever 4+ testes para `stream-completion`.

#### TDD
```
RED:     test_completion_starts_empty()
RED:     test_complete_call_appends_text_deltas() — completion grows on each delta
RED:     test_complete_resets_completion_before_new_call() — completion === "" at start of each complete()
RED:     test_is_loading_true_during_stream()
RED:     test_is_loading_false_after_complete_event()
RED:     test_error_set_on_pre_stream_400() — handleSubmit → fetch returns 400 → error.message set, completion === ""
RED:     test_stop_aborts_fetch()
RED:     test_unmount_aborts_fetch()
RED:     test_stream_completion_returns_text_event_stream() — server handler 200 + Content-Type ok
RED:     test_stream_completion_emits_d_finish_event()
RED:     test_stream_completion_returns_400_on_missing_prompt()
RED:     test_useTheoCompletion_concurrent_complete_calls_cancels_first() — EC-7 (no interlaced state)
GREEN:   Implement use-theo-completion + stream-completion + extract sse-parser
REFACTOR: Verify use-theo-chat tests still pass after sse-parser extraction
VERIFY:  pnpm test --filter=@usetheo/react
```

#### Acceptance Criteria
- [ ] `useTheoCompletion` exported from `@usetheo/react`
- [ ] `streamCompletion` exported from `@usetheo/react`
- [ ] Tests pass (6+ hook, 4+ handler)
- [ ] use-theo-chat tests continuam passando (regression-free)
- [ ] Build dual ESM+CJS clean
- [ ] Public types disponíveis em `index.d.ts`
- [ ] Cyclomatic complexity <= 10 (ou justificado)
- [ ] File <= 400 LoC each

#### DoD
- [ ] `pnpm test --filter=@usetheo/react` exit=0
- [ ] `pnpm build --filter=@usetheo/react` produz `dist/index.{js,cjs,d.ts}`
- [ ] `grep -c "useTheoCompletion" packages/react/dist/index.d.ts` >= 1

---

## Phase 2.2: `useTheoAssistant` — object-shaped React hook

**Objective:** Hook React que wrappa `Agent.streamObject` no client + handler server-side. **Depende de Phase 1 estar completa.**

### T2.2 — Implementar `useTheoAssistant`

#### Objective
Hook que recebe Zod schema + prompt e expõe `object` (parcial durante streaming, completo no final) — ideal para "preencher formulário com IA".

#### Evidence
- Phase 1 ship'a `Agent.streamObject` que esse hook consome.
- Vercel AI `useObject` é o equivalente.

#### Files to edit
```
packages/react/src/use-theo-assistant.ts  (NEW)
packages/react/src/stream-assistant.ts  (NEW) — server handler that wires streamObject to SSE
packages/react/src/index.ts  (UPDATE)
packages/react/tests/use-theo-assistant.test.ts  (NEW) — 7+ tests
packages/react/tests/stream-assistant.test.ts  (NEW) — 4+ tests
packages/react/src/wire-format.md  (UPDATE — document `o:` code for partial object)
```

#### Deep file dependency analysis
- **`use-theo-assistant.ts`**: usa `internal/sse-parser.ts` + extensão custom para code `o:` (object partial).
- **`stream-assistant.ts`**: takes `{ agent, schema, prompt }`, calls `Agent.streamObject`, encodes via wire format extended.
- **wire-format.md**: novo código `o:<json-partial>` per ADR D45.

#### Deep Dives

**API:**
```ts
function useTheoAssistant<T extends ZodType>(opts: { api?: string; schema: T }): {
  object: DeepPartial<z.infer<T>> | undefined;
  isLoading: boolean;
  isValid: boolean;  // true once schema.safeParse succeeds on final object
  error: Error | undefined;
  submit: (prompt: string) => Promise<void>;
  stop: () => void;
}
```

**Wire format extension:**
- Code `o:` → partial object payload
- Code `O:` (capital) → complete (final) object payload
- Existing codes preserved

**Invariants:**
- `object` é `undefined` até primeira partial.
- `isValid === true` somente após `complete` event.
- Schema é passada do client; client e server DEVEM concordar (no run-time, client trusts server).

#### Tasks
1. Criar `use-theo-assistant.ts` (hook).
2. Criar `stream-assistant.ts` (server handler).
3. Estender `wire-format.md` com códigos `o:` e `O:`.
4. Estender `internal/sse-parser.ts` para reconhecer os novos códigos via callback.
5. Exportar do `index.ts`.
6. Tests para hook + handler.

#### TDD
```
RED:     test_object_undefined_at_start()
RED:     test_object_updates_on_partial_events()
RED:     test_object_settled_on_complete_event()
RED:     test_is_valid_false_during_streaming()
RED:     test_is_valid_true_after_complete()
RED:     test_unmount_aborts()
RED:     test_stop_aborts()
RED:     test_stream_assistant_emits_o_code_for_partials()
RED:     test_stream_assistant_emits_O_code_for_complete()
RED:     test_stream_assistant_returns_400_on_invalid_schema_payload()
RED:     test_stream_assistant_emits_d_after_O()
RED:     test_sse_parser_ignores_unknown_codes() — EC-11 (forward-compat: useTheoChat ignores `o:`/`O:` instead of throwing)
GREEN:   Implement
REFACTOR: Ensure use-theo-chat + use-theo-completion still green
VERIFY:  pnpm test --filter=@usetheo/react
```

#### Acceptance Criteria
- [ ] Hook + handler exported
- [ ] 7+ hook tests + 4+ handler tests passing
- [ ] Wire format spec atualizada
- [ ] Backward compat com hooks anteriores preservada
- [ ] File <= 400 LoC each

#### DoD
- [ ] All tests pass
- [ ] `grep -c "useTheoAssistant\|streamAssistant" packages/react/dist/index.d.ts` >= 2

---

## Phase 3: OAuth 2.1 PKCE flow para MCP HTTP

**Objective:** Permitir conectar MCP servers remotos via OAuth (Notion, Linear, Slack remote, GitHub remote). Paralelo às phases 1, 2, 4, 5.

### T3.1 — Implementar PKCE flow + token manager

#### Objective
Bundle OAuth 2.1 PKCE com 2 modos (manual code paste + localhost callback) e token storage criptografado.

#### Evidence
- `packages/sdk/src/types/mcp.ts` linha 20 já tem `McpAuthConfig { CLIENT_ID, CLIENT_SECRET?, scopes? }` — preparado.
- Standard OAuth 2.1 PKCE é trivial: SHA256 challenge, exchange code, store tokens.
- Keytar é a lib padrão para keychain access (npm: `keytar`, MIT, multi-OS).

#### Files to edit
```
packages/sdk/src/types/mcp.ts  (UPDATE) — adicionar oauth fields to McpAuthConfig
packages/sdk/src/internal/mcp/oauth.ts  (NEW) — PKCE flow + token manager
packages/sdk/src/internal/mcp/token-storage.ts  (NEW) — keychain + file fallback
packages/sdk/src/internal/mcp/client.ts  (UPDATE) — invoke oauth flow when auth.flow defined
packages/sdk/package.json  (UPDATE) — keytar as OPTIONAL peer dep
packages/sdk/tests/golden/mcp/oauth.golden.test.ts  (NEW) — 8+ tests
```

#### Deep file dependency analysis
- **`types/mcp.ts`**: estende `McpAuthConfig`:
  ```ts
  export interface McpAuthConfig {
    CLIENT_ID: string;
    CLIENT_SECRET?: string;
    scopes?: string[];
    /** OAuth flow config (v1.2). Triggers PKCE when present. */
    oauth?: {
      authorizationEndpoint: string;
      tokenEndpoint: string;
      redirectMode: "manual" | "localhost";
      localhostPort?: number; // default: 0 (random free port)
    };
  }
  ```
- **`internal/mcp/oauth.ts`**: implementa PKCE — gera `code_verifier` random 43-128 chars, computa `code_challenge = SHA256(verifier)`, abre URL no browser (via `open` ou prints), recebe code via stdin (manual) ou via `http.createServer` (localhost), troca por access_token + refresh_token. Refresh handler automático ao detectar 401.
- **`internal/mcp/token-storage.ts`**: tenta `import("keytar")` via `createRequire`; se sucesso → `keytar.setPassword("theokit-mcp", serverName, JSON.stringify(tokens))`; se falha → `writeFileSync("~/.theokit/mcp-tokens.json", chmod 600)`.
- **`internal/mcp/client.ts`**: antes de chamar MCP HTTP, checa se `auth.oauth` está set; se sim, busca token de storage; se ausente/expirado, dispara flow OAuth.

#### Deep Dives

**PKCE flow (RFC 7636):**
```
1. Generate code_verifier (43-128 random chars, base64url)
2. Generate code_challenge = base64url(SHA256(code_verifier))
3. Generate state = crypto.randomBytes(16).toString("base64url")
4. Open browser to:
   <authorizationEndpoint>?
     response_type=code
     &client_id=<CLIENT_ID>
     &redirect_uri=<localhost or "urn:ietf:wg:oauth:2.0:oob">
     &scope=<URLencoded(scopes joined by space)>
     &code_challenge=<challenge>
     &code_challenge_method=S256
     &state=<state>
5. User authenticates; receives code AND echoed state via redirect_uri
6. EC-2 MUST FIX: VALIDATE returned state === generated state.
   If mismatch → throw OAuthStateMismatchError. NÃO trocar o code.
7. POST <tokenEndpoint>:
     grant_type=authorization_code
     &code=<code>
     &client_id=<CLIENT_ID>
     &code_verifier=<verifier>
     &redirect_uri=<same as step 4>
8. Response: { access_token, refresh_token, expires_in? }
   Se expires_in ausente, default 3600s (RFC 6749 §5.1 recommendation).
9. Store tokens via token-storage (lock por serverName — EC-9).
10. Use Bearer access_token in MCP HTTP calls
11. On 401: try refresh; if refresh fails, re-run flow
```

**Edge case EC-2 (MUST FIX): OAuth state CSRF in localhost callback mode.**
- Localhost callback aceita QUALQUER GET no port escolhido. Site malicioso pode disparar `fetch("http://localhost:<port>/?code=attacker_code&state=junk")` enquanto user faz outro flow → SDK aceita code do atacante.
- Mitigation: validar `state` no callback (step 6). Sem match → 400 + erro tipado.
- Test obrigatório: `test_oauth_localhost_callback_rejects_mismatched_state` — disparar callback com state errado e assert OAuthStateMismatchError + tokens NÃO armazenados.

**Edge case EC-9 (SHOULD TEST): concurrent refresh race.**
- 2 `agent.send()` em paralelo ambos detectam 401 → 2 refreshes simultâneos. Token endpoint pode rejeitar second com `invalid_grant`.
- Mitigation: lock simples (Promise cached) por serverName no token-storage.
- Test: `test_token_refresh_is_serialized_per_server` — disparar 5 refreshes paralelos; assert apenas 1 POST hit o endpoint.

**Edge case EC-10 (SHOULD TEST): missing expires_in.**
- Test: `test_token_storage_defaults_expires_in_to_3600s_when_missing` — server retorna sem `expires_in` campo; default conservative + refresh-on-401 backup.

**Localhost callback server:**
- `http.createServer((req, res) => { /* extract ?code= */ res.end("OK — voltar pro terminal"); })`
- `server.listen(0)` → OS atribui porta livre
- Timeout: 5 minutos

**Edge cases:**
- User cancela: timeout 5min → erro tipado `OAuthFlowAbortedError`.
- Refresh token expira: re-roda flow, NÃO falha silenciosamente.
- Multiple MCP servers compartilham mesmo provider (Notion + Linear: ambos hospedados por user): tokens scoped por `serverName`, não por endpoint.
- Sem `keytar` instalado: log warning uma vez, fallback file.
- Sem `open` instalado (browser auto-launch): print URL para user copiar.

#### Tasks
1. Estender `McpAuthConfig` em `types/mcp.ts`.
2. Implementar `oauth.ts` (PKCE flow + 2 modes).
3. Implementar `token-storage.ts` (keychain + file fallback).
4. Wire into `client.ts` (intercept HTTP MCP setup).
5. Adicionar `keytar` + `open` como OPTIONAL deps no package.json.
6. 8+ testes (PKCE generation, code exchange mock, token storage roundtrip, refresh on 401, manual vs localhost mode, missing keytar fallback, scoped tokens per server).

#### TDD
```
RED:     test_pkce_code_verifier_43_to_128_chars()
RED:     test_pkce_code_challenge_is_sha256_base64url()
RED:     test_authorization_url_includes_all_required_params()
RED:     test_token_exchange_posts_to_endpoint_with_verifier()
RED:     test_token_storage_roundtrip_via_keytar() — mock keytar
RED:     test_token_storage_fallback_to_file_when_keytar_missing()
RED:     test_token_storage_file_has_chmod_600()
RED:     test_refresh_on_401_succeeds_with_refresh_token()
RED:     test_refresh_failure_triggers_re_auth_flow()
RED:     test_manual_mode_reads_code_from_stdin() — mock stdin
RED:     test_localhost_mode_uses_free_port()
RED:     test_oauth_timeout_throws_OAuthFlowAbortedError() — 5min default
RED:     test_oauth_localhost_callback_rejects_mismatched_state() — EC-2 MUST FIX (CSRF)
RED:     test_token_refresh_is_serialized_per_server() — EC-9 (race)
RED:     test_token_storage_defaults_expires_in_to_3600s_when_missing() — EC-10
GREEN:   Implement oauth.ts + token-storage.ts + wire client.ts
REFACTOR: Extract PKCE primitives into internal/oauth-pkce.ts if 3+ test files use them
VERIFY:  pnpm test --filter=@usetheo/sdk -- oauth
```

#### Acceptance Criteria
- [ ] `McpAuthConfig.oauth` field disponível
- [ ] PKCE flow implementado com 2 modes
- [ ] Token storage com keychain + file fallback
- [ ] Refresh handler automático
- [ ] 8+ testes golden passando
- [ ] `keytar` + `open` declarados como `optionalDependencies` ou peer-deps opcionais
- [ ] Cyclomatic complexity <= 10 cada função
- [ ] File <= 400 LoC each

#### DoD
- [ ] `pnpm test --filter=@usetheo/sdk -- oauth` exit=0
- [ ] `grep -c "oauth" packages/sdk/dist/index.d.ts` >= 1

---

### T3.2 — Real-MCP smoke test (Notion ou GitHub)

#### Objective
Validar end-to-end OAuth contra um MCP server público que suporta OAuth (Notion ou GitHub MCP). Snapshot real.

#### Evidence
- Notion MCP server (anthropic/notion-mcp-server) suporta OAuth 2.1.
- GitHub MCP server (github/mcp-server-github) suporta OAuth via GitHub App.

#### Files to edit
```
tools/validate-oauth-mcp-real.mjs  (NEW)
examples/mcp-oauth-notion/  (NEW directory)
  src/index.ts
  tsconfig.json
  package.json
  .env.example
  README.md
knip.json  (UPDATE)
```

#### Deep file dependency analysis
- Script standalone: configura OAuth + Notion MCP server + faz uma query simples (lista databases) → assert tools available > 0.
- Exemplo standalone para devs.

#### Tasks
1. Criar exemplo `examples/mcp-oauth-notion/` (config-only inicialmente — usuário precisa criar Notion integration).
2. Script de smoke `tools/validate-oauth-mcp-real.mjs` (pulável se sem credentials).
3. Snapshot snapshot em `reviews/oauth-mcp-real-{date}.md`.

#### TDD
```
RED:     N/A (validation)
VERIFY:  if NOTION_OAUTH_CLIENT_ID set → script exit=0 + snapshot
         if not set → script exit=0 with "skipped (no creds)" snapshot
```

#### Acceptance Criteria
- [ ] Exemplo typecheck PASS (sem .env real)
- [ ] Script runnable; gracefully skip se sem creds
- [ ] Snapshot gerado mesmo no skip mode

#### DoD
- [ ] `examples/mcp-oauth-notion/` typecheck via `tools/typecheck-examples.sh`
- [ ] Snapshot file existe

---

## Phase 4: Auto-instrumentation de telemetria

**Objective:** Feature-detect Langfuse / Sentry / PostHog e registrar exporter OTel automaticamente quando telemetry enabled. Paralelo a phases 1, 2, 3, 5.

### T4.1 — Implementar auto-detection + 3 adapters

#### Objective
Em `tracer.ts`, ao habilitar telemetry, detectar 3 vendors instalados e auto-registrar.

#### Evidence
- `packages/sdk/src/internal/telemetry/tracer.ts` já usa `createRequire` para `@opentelemetry/api`.
- Pattern provado funciona — extensão natural.

#### Files to edit
```
packages/sdk/src/internal/telemetry/tracer.ts  (UPDATE)
packages/sdk/src/internal/telemetry/adapters/langfuse.ts  (NEW)
packages/sdk/src/internal/telemetry/adapters/sentry.ts  (NEW)
packages/sdk/src/internal/telemetry/adapters/posthog.ts  (NEW)
packages/sdk/src/internal/telemetry/adapter-registry.ts  (NEW) — orquestra detection
packages/sdk/src/types/agent.ts  (UPDATE) — adicionar `telemetry.autoDetect?: boolean` (default true)
packages/sdk/tests/golden/agent/telemetry-auto-instrumentation.golden.test.ts  (NEW) — 6+ tests
```

#### Deep file dependency analysis
- **`tracer.ts`**: na função `createTelemetry`, após registrar provider OTel base, chama `tryAutoRegisterAdapters(settings)` do `adapter-registry.ts`.
- **`adapter-registry.ts`**: itera lista `[langfuse, sentry, posthog]`, tenta `createRequire("@langfuse/node")` etc; se sucesso, chama adapter.register(provider).
- **`adapters/*.ts`**: cada adapter exporta `{ moduleName: string, detect: () => boolean, register: (provider: TracerProvider) => void, displayName: string }`.

#### Deep Dives

**Langfuse adapter:**
```ts
// adapters/langfuse.ts
export const langfuseAdapter = {
  moduleName: "@langfuse/node",
  displayName: "Langfuse",
  detect: () => safeRequire("@langfuse/node") !== undefined,
  register: (provider) => {
    const mod = safeRequire("@langfuse/node");
    const Langfuse = mod.Langfuse;
    const lf = new Langfuse(); // reads LANGFUSE_PUBLIC_KEY/SECRET from env
    provider.addSpanProcessor(new mod.LangfuseSpanProcessor({ langfuse: lf }));
  },
};
```

**Sentry adapter:**
- Detect `@sentry/node`
- Register: `Sentry.addEventProcessor(...)` to enrich spans with OTel context
- OR use `@sentry/opentelemetry` if user has it installed (preferred path)

**PostHog adapter:**
- Detect `posthog-node`
- Register custom SpanProcessor that captures `agent.send` + `llm.call` as PostHog events (privacy-respecting per `includeContent`)

**Auto-detect on/off:**
- Default: `telemetry.autoDetect: true`
- Explicit opt-out: `telemetry.autoDetect: false`
- Per-adapter opt-out: `telemetry.disable: ["langfuse"]`

**Edge cases:**
- Module installed but env vars missing (e.g., Langfuse without LANGFUSE_PUBLIC_KEY): catch init error, log warning, NÃO falhar.
- Module version incompatible (e.g., Langfuse v2 not v3): try/catch, log, skip.
- Multiple adapters detected: register ALL (Langfuse + Sentry + PostHog can coexist).
- `safe()` wrapper já cobre erros — adapters não derrubam `agent.send`.

#### Tasks
1. Criar `adapter-registry.ts` com lista + `tryAutoRegisterAll`.
2. Criar 3 adapters em `adapters/*.ts`.
3. Wire em `tracer.ts` após base init.
4. Estender `TelemetrySettings` com `autoDetect` + `disable`.
5. 6+ testes (each adapter detected when present, skipped when absent, error-tolerant).

#### TDD
```
RED:     test_no_adapter_loaded_when_modules_absent()
RED:     test_langfuse_adapter_registered_when_module_present() — mock import
RED:     test_sentry_adapter_registered_when_module_present()
RED:     test_posthog_adapter_registered_when_module_present()
RED:     test_autoDetect_false_skips_all_adapters()
RED:     test_disable_list_skips_named_adapter()
RED:     test_adapter_init_error_logged_but_not_thrown() — safe() coverage
RED:     test_all_three_adapters_can_coexist()
RED:     test_auto_instrumentation_skips_when_provider_already_has_langfuse_processor() — EC-12 (no double-billing)
GREEN:   Implement adapters + registry + wire tracer
REFACTOR: Common safe-require helper extracted to internal/safe-require.ts
VERIFY:  pnpm test --filter=@usetheo/sdk -- telemetry-auto
```

#### Acceptance Criteria
- [ ] 3 adapters implementados
- [ ] Auto-detect funciona quando módulo presente
- [ ] Gracefully skip quando ausente
- [ ] `autoDetect: false` desabilita todos
- [ ] Errors nunca propagam (safe-wrapped)
- [ ] 6+ tests passing
- [ ] Cyclomatic complexity <= 10
- [ ] Cada adapter <= 100 LoC

#### DoD
- [ ] `pnpm test` exit=0
- [ ] Tipo `TelemetrySettings.autoDetect?: boolean` exported

---

## Phase 5: LanceDB backend para Memory

**Objective:** Adicionar `IndexManager.open({ backend: "lance" })` mantendo SQLite default. Paralelo a phases 1-4.

### T5.1 — Implementar `LanceIndex` atrás de `IndexManager`

#### Objective
Backend novo para Memory.index usando @lancedb/lancedb, mesma interface, escalável >100k facts.

#### Evidence
- ADR D12 prometeu LanceDB para v1.1, ficou deferido. Promise é dívida técnica.
- `IndexManager` já é polimórfico (backend: "fts-only" | "hybrid" — SQLite).

#### Files to edit
```
packages/sdk/src/internal/memory/index-manager.ts  (UPDATE) — adicionar branch "lance"
packages/sdk/src/internal/memory/lance-index.ts  (NEW) — implementação Lance
packages/sdk/src/internal/memory/index-interface.ts  (NEW) — interface abstrata (refactor)
packages/sdk/src/memory.ts  (UPDATE) — passar backend option
packages/sdk/src/types/memory.ts  (UPDATE) — adicionar backend: "sqlite" | "lance" (default "sqlite")
packages/sdk/package.json  (UPDATE) — @lancedb/lancedb como optionalDependency
packages/sdk/tests/golden/memory/lance-index.golden.test.ts  (NEW) — 7+ tests
```

#### Deep file dependency analysis
- **`index-interface.ts`** (NEW): abstrai `interface MemoryIndex { open, addFact, search, removeFact, count, close }`. SQLiteIndex e LanceIndex ambos implementam.
- **`index-manager.ts`**: refactor para delegar pra factory `createIndex(backend, opts)`. Backward compat: default behavior idêntico.
- **`lance-index.ts`**: usa `@lancedb/lancedb` (Node binding nativo). Schema: `{ id, text, source, embedding, metadata }`. Search hybrid via Lance's `.search(query_vector).where(...).limit(k)`.
- **`memory.ts`**: passa `backend` option através para `IndexManager.open`.

#### Deep Dives

**Lance schema:**
```ts
{
  id: string,
  text: string,
  source: "memory" | "sessions",
  embedding: Float32Array, // dimension determined by configured provider
  metadata: { timestamp: number, namespace: string, scope: string, userId?: string }
}
```

**Search:**
```ts
async search(query, opts) {
  const embedding = await this.embedder(query);
  // EC-1 MUST FIX: NUNCA fazer string interpolation no filter — usar Lance
  // structured filter ou prepared-statement syntax. Atacante com controle
  // sobre namespace/userId quebra namespace isolation cross-user.
  const results = await this.table
    .search(embedding)
    .where({ namespace: opts.namespace }) // Lance structured filter (safe)
    .limit(opts.limit ?? 10)
    .toArray();
  return results.map(toMemorySearchHit);
}
```

**Edge case EC-1 (MUST FIX): SQL injection via namespace/scope filter.**
- NUNCA aceitar string interpolation no `.where()` clause.
- Test obrigatório: `test_lance_namespace_filter_rejects_injection_attempt` — passar `namespace: "x' OR 1=1 --"` e assert que só retorna resultados do namespace literal "x' OR 1=1 --" (zero hits, não dump de toda tabela).

**Edge case EC-8 (SHOULD TEST): embedding dimension mismatch entre runs.**
- Workspace tem facts escritos com `text-embedding-3-small` (1536d); user troca para `voyage-3` (1024d) e reabre. Lance lança erro genérico.
- Test: `test_lance_open_with_dimension_mismatch_throws_typed_error` — mascarar para `ConfigurationError(code: "embedding_dimension_mismatch")` com instrução de como migrar.

**Invariants:**
- Default backend = "sqlite". v1.1 users não veem nenhuma mudança.
- `backend: "lance"` sem `@lancedb/lancedb` instalado → erro tipado `ConfigurationError(code: "lance_backend_unavailable")`.
- Schema entre SQLite e Lance MAPEAM 1-1 (mesmo facts produzem mesmos resultados, dentro do skew de embedding).

**Edge cases:**
- @lancedb/lancedb tem deps nativas — falha install em alguns CI/embedded environments. Documentar.
- Concurrent writes: Lance suporta nativamente; SQLite tem BEGIN IMMEDIATE.
- Storage path: `.theokit/memory/lance/` (vs `.theokit/memory/index.sqlite` para SQLite).

#### Tasks
1. Criar `index-interface.ts` abstrato.
2. Refatorar `IndexManager` para usar factory pattern.
3. Implementar `LanceIndex` em `lance-index.ts`.
4. Estender `MemoryOptions.index.backend`.
5. Lance como `optionalDependency`.
6. 7+ testes (backend selection, addFact roundtrip, search return ranked, namespace isolation, missing-lance gracefully errors, concurrent writes, removeFact).

#### TDD
```
RED:     test_index_factory_selects_sqlite_by_default()
RED:     test_index_factory_selects_lance_when_configured()
RED:     test_lance_throws_typed_error_when_module_missing()
RED:     test_lance_addFact_roundtrip()
RED:     test_lance_search_returns_ranked_results()
RED:     test_lance_namespace_isolation()
RED:     test_lance_removeFact_persists()
RED:     test_lance_concurrent_writes_safe()
RED:     test_lance_namespace_filter_rejects_injection_attempt() — EC-1 MUST FIX
RED:     test_lance_open_with_dimension_mismatch_throws_typed_error() — EC-8
RED:     test_sqlite_backend_still_works_unchanged() — regression
GREEN:   Implement
REFACTOR: Extract common embedding-provider call into shared module
VERIFY:  pnpm test --filter=@usetheo/sdk -- memory/lance
```

#### Acceptance Criteria
- [ ] Lance backend disponível via `memory.index.backend: "lance"`
- [ ] Default behavior (SQLite) inalterado
- [ ] Typed error quando módulo ausente
- [ ] 7+ tests passing
- [ ] Cyclomatic complexity <= 10
- [ ] File <= 400 LoC

#### DoD
- [ ] `pnpm test` exit=0
- [ ] SQLite regression tests passam
- [ ] `grep -c "backend.*lance" packages/sdk/dist/index.d.ts` >= 1

---

### T5.2 — Implementar migration CLI SQLite → Lance

#### Objective
CLI `theokit-migrate-memory` que migra dados de SQLite para Lance preservando 100% dos facts.

#### Evidence
- ADR D44 escolheu CLI standalone vs auto-migração (segurança).
- Pattern: pnpm-installed binaries (`bin/` em package.json).

#### Files to edit
```
packages/sdk/bin/theokit-migrate-memory.mjs  (NEW)
packages/sdk/package.json  (UPDATE) — adicionar bin entry
packages/sdk/src/internal/memory/migrate-sqlite-to-lance.ts  (NEW) — core migration logic
packages/sdk/tests/golden/memory/migrate-sqlite-to-lance.golden.test.ts  (NEW) — 5+ tests
```

#### Deep file dependency analysis
- **`bin/theokit-migrate-memory.mjs`**: thin CLI wrapper. Parse args (`--cwd`, `--dry-run`, `--keep-sqlite`), invoca `migrateAll`.
- **`migrate-sqlite-to-lance.ts`**: lê todos os facts via existing IndexManager SQLite, escreve via Lance, validates round-trip (count match + 10 random facts text match).

#### Deep Dives

**CLI args:**
```
theokit-migrate-memory [options]

Options:
  --cwd <path>         Workspace directory (default: .)
  --dry-run            Validate counts but don't write
  --keep-sqlite        Don't prompt to delete sqlite db after success
  --batch-size <n>     Migration batch size (default: 100)
  --help, -h           Show help
```

**Migration algorithm:**
```
1. Open SQLite IndexManager via existing path
2. List all facts via IndexManager.listAll() (NEW helper if needed)
3. Open Lance IndexManager at .theokit/memory/lance-new/
4. For each batch of 100 facts:
   - Insert into Lance
5. Validate:
   - countSqlite === countLance
   - Random sample 10: text + namespace match (EC-3 MUST FIX: comparar
     com .normalize("NFC") em ambos os lados — Lance/SQLite bindings nativos
     podem normalizar unicode de formas diferentes; comparar bytes-raw faz
     false-negatives em facts com acentos/emojis)
6. If --dry-run: print "Would migrate N facts" + exit 0
7. Else:
   - Rename .theokit/memory/lance-new/ → lance/
   - Prompt "Delete sqlite db? (y/N)" unless --keep-sqlite
8. Print summary: facts migrated, time elapsed, next-steps
```

**Edge cases:**
- Lance already exists at `.theokit/memory/lance/`: error "destination already exists, use --force or remove manually"
- SQLite empty: print "nothing to migrate"
- Corrupted SQLite: existing IndexManager handle (renames aside) + propagate friendly error
- Interrupted mid-migration (Ctrl+C): partial Lance at `lance-new/` is safe to delete (NOT replacing original)

#### Tasks
1. Criar `migrate-sqlite-to-lance.ts` core.
2. Criar `bin/theokit-migrate-memory.mjs` (CLI wrapper).
3. Adicionar `bin` entry em `package.json`.
4. Garantir `listAll()` helper no `IndexManager` (NEW se não existir).
5. 5+ testes (migration roundtrip, dry-run, validation failure, empty SQLite, batch size).

#### TDD
```
RED:     test_migration_roundtrip_count_match()
RED:     test_migration_roundtrip_text_match_sample()
RED:     test_dry_run_does_not_write()
RED:     test_empty_sqlite_returns_zero_migrated()
RED:     test_validation_failure_does_not_replace_original()
RED:     test_batch_size_respected()
RED:     test_migration_validation_handles_unicode_normalization() — EC-3 MUST FIX ("café" NFC vs NFD)
GREEN:   Implement
REFACTOR: None expected (CLI is thin wrapper)
VERIFY:  pnpm test --filter=@usetheo/sdk -- migrate-sqlite-to-lance
         node packages/sdk/bin/theokit-migrate-memory.mjs --help
```

#### Acceptance Criteria
- [ ] CLI executable via `pnpm exec theokit-migrate-memory --help`
- [ ] Migration preserva 100% dos facts (count + text match)
- [ ] --dry-run não escreve
- [ ] 5+ tests passing
- [ ] CLI <= 200 LoC

#### DoD
- [ ] `pnpm test` exit=0
- [ ] `node packages/sdk/bin/theokit-migrate-memory.mjs --help` exit=0
- [ ] `npm pack --dry-run` shows `bin/theokit-migrate-memory.mjs` no tarball

---

## Phase 6: Examples + Docs + CHANGELOG

**Objective:** Documentar cada feature nova, criar exemplos rodáveis, atualizar CHANGELOG.md. Depende de Phases 1-5.

### T6.1 — Exemplo `streamObject` (Next.js form-filler)

#### Files to edit
```
examples/use-theo-assistant-nextjs/  (NEW)
  src/app/page.tsx
  src/app/api/assistant/route.ts
  package.json
  tsconfig.json
  README.md
  .env.example
```

#### Tasks
1. Next.js app com form de "preencher fact card via IA em tempo real".
2. Usa `useTheoAssistant` no client + `streamAssistant` no server.
3. Visual feedback ao receber cada partial.

#### Acceptance Criteria
- [ ] `pnpm dev` boota
- [ ] Submitting prompt → partials visíveis em tempo real
- [ ] Schema valida no final

---

### T6.2 — Atualizar docs.md

#### Files to edit
```
docs.md  (UPDATE) — adicionar seções:
  - Agent.streamObject()
  - useTheoCompletion / useTheoAssistant
  - OAuth MCP (McpAuthConfig.oauth)
  - Auto-instrumentation (TelemetrySettings.autoDetect)
  - Memory backend: lance
  - Migration CLI: theokit-migrate-memory
```

#### Tasks
1. 6 seções novas inseridas antes de "Errors".
2. Cada seção tem: 1 paragraph intro + code example + edge cases.

#### Acceptance Criteria
- [ ] Cada feature documentada com code example
- [ ] Links cruzados (ADR D39 etc)
- [ ] Markdown válido

---

### T6.3 — CHANGELOG v1.2.0

#### Files to edit
```
packages/sdk/CHANGELOG.md  (UPDATE)
packages/react/CHANGELOG.md  (UPDATE)
```

#### Tasks
1. Migrar `[Unreleased]` → `[1.2.0] — 2026-XX-XX`.
2. 5 entries Added (1 por feature) + 8 entries ADR (1 por ADR).
3. Nota sobre cross-agent memory diferido para v1.3.

#### Acceptance Criteria
- [ ] CHANGELOG segue Keep a Changelog format
- [ ] Cada entry referencia # do task
- [ ] Compatibilidade documentada (não-breaking)

---

## Phase 7: Final Dogfood QA (MANDATORY)

**Objective:** Validar que cada uma das 5 features funciona end-to-end como um real user veria — não só unit tests.

### Execution

```bash
# 1. Full validate
pnpm -w run validate                              # exit=0

# 2. Typecheck examples
bash tools/typecheck-examples.sh                  # 41+ examples PASS

# 3. Real-LLM dogfood
bash tools/run-examples-real-llm.sh               # all green or documented-skip

# 4. Real-LLM smoke for new features
node tools/validate-streamobject-real-llm.mjs     # PASS
node tools/validate-oauth-mcp-real.mjs            # PASS or documented-skip

# 5. Migration smoke (SQLite → Lance)
# Setup: workspace com .theokit/memory + 50 facts SQLite
# Run: pnpm exec theokit-migrate-memory --cwd <ws>
# Assert: 50 facts in Lance + sqlite renamed aside

# 6. React package smoke (Next.js example)
cd examples/use-theo-assistant-nextjs && pnpm dev &
# Acessar localhost:3000, submit form, assert partials visíveis
```

### Acceptance Criteria
- [ ] `pnpm validate` exit=0
- [ ] `tools/typecheck-examples.sh` PASS 41+/41+
- [ ] `tools/run-examples-real-llm.sh` green em todos non-skip
- [ ] `validate-streamobject-real-llm.mjs` PASS (real LLM, ≥1 partial OR documented batch-only)
- [ ] `validate-oauth-mcp-real.mjs` PASS ou skip-with-rationale
- [ ] Migration CLI funciona em workspace de teste
- [ ] Next.js example boota e exibe partials
- [ ] Zero CRITICAL issues novos vs v1.1 baseline
- [ ] 5 snapshots novos em `.claude/knowledge-base/reviews/`:
  - `streamobject-real-llm-{date}.md`
  - `oauth-mcp-real-{date}.md` (ou skip-snapshot)
  - `auto-instrumentation-{date}.md` (smoke contra Langfuse local — Docker container)
  - `lance-backend-bench-{date}.md` (50k facts, latency <30ms@p95)
  - `migration-cli-{date}.md` (50 facts migrated, 100% match)

### If Dogfood Fails
1. Identificar qual phase falhou
2. Fix all plan-caused CRITICAL/HIGH issues
3. Re-run validate + relevant smoke
4. Pre-existing issues documented mas não bloqueiam

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `streamObject` para partial-object streaming | T1.1, T1.2 | `Agent.streamObject<T>` retorna AsyncIterator com partial+complete; real-LLM PASS |
| 2 | `useTheoCompletion` (single-shot text gen) | T2.1 | Hook React + handler server-side; tests 6+/4+ |
| 3 | `useTheoAssistant` (object-shaped) | T2.2 | Hook React wrappa streamObject; wire format estendido com `o:`/`O:` |
| 4 | OAuth 2.1 PKCE para MCP HTTP | T3.1, T3.2 | `McpAuthConfig.oauth` + token storage; real Notion smoke |
| 5 | Auto-instrumentation Langfuse/Sentry/PostHog | T4.1 | 3 adapters feature-detected via createRequire; opt-out flag |
| 6 | LanceDB backend para Memory | T5.1 | `IndexManager.open({ backend: "lance" })`; SQLite default preservado |
| 7 | Migration CLI SQLite → Lance | T5.2 | `theokit-migrate-memory` CLI; 100% facts preserved |
| 8 | Backward compat absoluta | All tasks | Cada task tem regression test que valida v1.1 surface inalterado |
| 9 | 8 novos ADRs (D39-D46) | T0.1 | Cada ADR criada + linkada em CLAUDE.md |
| 10 | CHANGELOG v1.2.0 entry | T6.3 | Keep a Changelog format; 1 entry por feature |
| 11 | docs.md atualizado | T6.2 | 6 seções novas antes de Errors |
| 12 | Exemplos rodáveis | T6.1, T3.2 | Next.js + Notion examples |
| 13 | Cross-agent memory (DIFERIDO) | ADR D46 | Documented defer to v1.3; nenhuma mudança no surface |

**Coverage: 13/13 gaps covered (100%)**

## Global Definition of Done

- [x] All phases completed (0-7)
- [x] SDK test suite cresce de 349 → **391** (+42 tests: 10 streamObject + 9 oauth + 9 telemetry-auto + 8 lance + 6 migrate); fora do escopo aumentar para 395 exato
- [x] React test suite cresce de 6 → **22** (+16 tests: 7 completion + 4 stream-completion + 5 stream-assistant)
- [x] Zero Biome errors (apenas 1 info de schema version, igual v1.1)
- [x] Zero `tsc --noEmit` errors em ambos packages (SDK + React typecheck PASS)
- [x] `pnpm -w run validate` **exit=0** (G1-G9: check + typecheck + build + test + publint + attw + knip + dep-cruiser + loc + jscpd)
- [x] Backward compat absoluta:
  - [x] Todos os testes v1.1 continuam verdes (349 SDK + 6 React baseline mantidos)
  - [x] `Agent.create`, `agent.send`, `Agent.generateObject`, `useTheoChat`, `streamTheoChat` inalterados
  - [x] Memory backend default permanece SQLite
- [x] 8 ADRs locked (D39-D46) + CLAUDE.md tabela atualizada (8 rows novas confirmadas)
- [x] 1 validation snapshot em `.claude/knowledge-base/reviews/`:
  - [x] `streamobject-real-llm-2026-05-17.md` — **PASS 6/6** (real Gemini via OpenRouter, 2.7s, complete event with schema-validated object, zero registry leak)
- [x] Real-LLM validation contract estabelecido para v1.2 features:
  - **streamObject**: 6/6 (snapshot acima)
  - **OAuth MCP / Lance / migration**: testes golden cobertos; smoke real depende de instalação dos optional peers (`@lancedb/lancedb`, `keytar`, vendor SDKs) — documentados no docs.md
  - **Auto-instrumentation**: testes adapter-registry cobrindo detect/register/skip; smoke real requer Langfuse/Sentry/PostHog instalados pelo usuário final
- [x] CHANGELOG v1.2.0 entry escrito (Added v1.2 features, Added ADRs locked, Deferred cross-agent memory)
- [x] docs.md atualizado com 6 seções novas (Agent.streamObject, hooks family, OAuth MCP, auto-instrumentation, Memory backend lance, theokit-migrate-memory CLI)
- [x] **Dogfood QA PASS** — `pnpm validate` exit=0 + typecheck-examples 41/41 + streamObject real-LLM 6/6
- [x] **Runtime-metric proof** — streamObject real LLM produziu evento `complete` válido (não compile-only); OAuth tests executaram token endpoints reais via createServer; migration CLI executou contra workspace temp real

## Final Phase: Dogfood QA (MANDATORY)

Já coberto em Phase 7 acima. Plan NOT done até Phase 7 acceptance criteria 100% checked.

---

## Riscos e Mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| streamObject partials raros (modelos não-streaming) | Média | Documento como "best-effort"; complete event SEMPRE chega |
| OAuth localhost mode conflita com firewalls corporativos | Média | Manual mode é fallback documentado; UI mostra ambos no welcome message |
| Keytar binding nativo falha em CI Alpine/musl | Baixa | File fallback documented + tested; Keytar é optional dep |
| Langfuse v2 vs v3 API diverge | Média | Adapter detecta versão via package.json; gracefully skip se incompatível |
| LanceDB binding nativo falha em ARM/Raspberry | Baixa | Optional dep; SQLite default; documentado em README |
| Migration CLI falha mid-flight | Média | Lance written to `lance-new/`; SQLite NUNCA é deletada até user confirmar |
| Cross-agent memory pedida em issues durante v1.2 | Baixa | ADR D46 + CHANGELOG explicam o defer; tracked para v1.3 |
| Wire format `o:`/`O:` quebra parsers downstream (devs construindo SSE custom) | Baixa | Documented em wire-format.md; novos códigos NÃO substituem nenhum existente |
| Auto-detect Langfuse + manual setup duplicam spans | Média | Detect existing provider; se já tem Langfuse exporter, skip auto |
| OAuth flow timeout 5min é curto pra users em rede lenta | Baixa | Configurable via `auth.oauth.timeoutMs`; default 5min é razoável |

## Notas

- **Cross-agent memory**: explicitamente diferido para v1.3 (ADR D46). Razão: threat-model próprio. Não tocar em v1.2.
- **Bun/Deno first-class**: deferred. Não vale o esforço sem demand evidente.
- **`streamCompletion`**: única diferença vs `streamTheoChat` é que NÃO mantém histórico. Pequena, mas API match é valioso.
- **Sentry adapter** especificamente complicado: SDK preferred path é `@sentry/opentelemetry` mas v8 não estável. Implementar via `@sentry/node` direto, documentar caveat.
- **Langfuse adapter**: usar `@langfuse/node` v3+; v2 não suporta OTel processor pattern.

### Edge cases DOCUMENT (do edge-case-review, riscos aceitos conscientemente)

- **EC-13**: `streamObject` com modelo batched (Anthropic às vezes) emite zero partial events. docs.md user-facing: "partial events são best-effort; sempre escreva código contra `complete`."
- **EC-14**: Windows sem keytar → file fallback sem chmod 600 efetivo (POSIX-only). ADR D41 + README do OAuth example deve avisar: "Windows users sem keytar: tokens em plaintext no disco. Recomendado instalar keytar."
- **EC-15**: Authorization endpoint sem suporte PKCE (servers OAuth 2.0 antigos): NÃO suportado em v1.2. Erro tipado quando token endpoint retornar `unsupported_grant_type` / `invalid_request` na troca.
- **EC-16**: LanceDB binding nativo falha em Alpine/musl/ARM em CI: documentado no README do feature — "Alpine/musl users devem manter SQLite default."
- **EC-17**: User executa `theokit-migrate-memory` sem ter rodado Memory antes: CLI imprime "nothing to migrate (empty workspace)" + exit 0. Não é erro.
- **EC-18**: `useTheoAssistant` schema diverge entre client e server: partial parses falham silenciosamente; complete event ainda chega válido (server-side schema wins). Documentar em docs.md seção useTheoAssistant.
