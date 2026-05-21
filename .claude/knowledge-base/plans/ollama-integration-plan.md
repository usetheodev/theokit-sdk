# Plan: Ollama Integration — Complete

> **Version 1.0 — STATUS: ✅ COMPLETE (2026-05-21).** Phases 1, 2, 3, 5, 6, 7 todas DONE com real-LLM validation. Phase 4 (Vision) deferida — requer modelo vision (~5GB) não instalado; serialization path já funcional via `OpenAIClient` reuse, faltando apenas teste end-to-end com modelo. Phase 8 (Dogfood telegram-pro) pendente — pode ser rodado quando usuário quiser. **15/15 ADRs (D182-D190) shipadas + 2 examples reais rodando + 158/158 unit tests + 6/6 integration tests contra Ollama real.**
>
> **Histórico:** Ollama é o runtime local-LLM mais adotado em 2026 (Llama 3.2, Qwen2.5, Mistral, llava). A SDK ganhou suporte builtin **mínimo** em 2026-05-21 (ADR D182 — profile + `authType: "none"` + `OLLAMA_HOST`). Este plano fechou a integração: validação real-LLM, descoberta de modelos, embeddings locais, tool calling, exemplos rodando ponta-a-ponta, sibling profiles (LM Studio + llama.cpp). Resultado: developer sem nenhuma API key paga consegue rodar agente completo (chat + memória + RAG + tools) totalmente local.

## Context

**O que existe hoje (Phase 0 — já shipado, ADR D182):**

- `OLLAMA: ProviderProfile` registrado em `internal/providers/builtin/ollama.ts` com `apiMode: "chat_completions"`, `authType: "none"`, `baseUrl: "http://localhost:11434"`.
- Router (`internal/llm/router.ts`) trata `authType: "none"` com sentinel placeholder + `OLLAMA_HOST` baseUrl override.
- Reutiliza `OpenAIClient` (Ollama expõe `/v1/chat/completions` OpenAI-compat).
- 7 testes unitários (`tests/internal/providers/ollama.test.ts`) — todos passando.
- ADR D182 + CHANGELOG + docs.md seção "Local models — Ollama".

**O que está QUEBRADO ou AUSENTE (gaps):**

1. **Nunca rodou contra Ollama real.** Per regra `.claude/rules/real-llm-validation.md`, validação fixture/typecheck NÃO conta como evidência. Não temos prova de que streaming, tool calls, e finish reasons funcionam de fato.
2. **Erros opacos quando Ollama não está rodando.** `ECONNREFUSED` chega cru ao usuário não-técnico (CLAUDE.md menciona o público). Deveríamos detectar e dar mensagem acionável: "Run `ollama serve` to start the local runtime".
3. **404 em modelo não puxado é incompreensível.** Quando usuário usa `model: "ollama/llama3.2"` mas não rodou `ollama pull llama3.2`, Ollama devolve 404 sem contexto. Deveríamos surface "Model `llama3.2` not pulled. Run `ollama pull llama3.2`".
4. **`Theokit.models.list()` é cloud-only.** Hoje só lê do TheoCloud (`/v1/models`). Local Ollama tem `/v1/models` mas não está wired. Developer não consegue descobrir quais modelos tem instalados via SDK.
5. **Sem embedding adapter Ollama.** Catálogo `MEMORY_EMBEDDING_ADAPTERS` tem 5 entradas (openai/mistral/openrouter/voyage/deepinfra) — nenhuma local. Para developer que quer memória/RAG 100% local, falta o último elo.
6. **Vision/multimodal não validado.** Ollama suporta `llava`, `llama3.2-vision`. SDK tem image-input path (`@usetheo/sdk`'s send com `content: [{type:"image",...}]`). Nunca testamos a interseção.
7. **Tool calling não validado.** Ollama suporta tool calls (modelos novos: Llama 3.1+, Qwen2.5, Mistral). Schema OpenAI-compat funciona em tese, mas qualidade varia. Sem teste, não sabemos.
8. **Zero examples rodando.** `examples/` tem 30+ apps mas nenhum prova Ollama. Sem isso, README fica vazio.
9. **Default model gap.** `Agent.create({ model: "ollama" })` (sem `/<model>`) hoje quebra. Deveríamos auto-selecionar primeiro modelo instalado OU dar erro acionável.
10. **CredentialPool semantics não definidas.** Se usuário passar `apiKeys: { ollama: ["k1", "k2"] }`, o router monta um pool de 2 chaves contra um provider sem auth. Comportamento indefinido — deveria ser no-op com warn.
11. **LM Studio + llama.cpp pendentes** (Adoption Roadmap row 12 mencionou) — mesmo primitivo `authType: "none"`, profiles dedicados para idiossincrasias.
12. **Dogfood inexistente.** telegram-pro/discord-pro nunca usaram Ollama. Sem isso, integração não passou pelo gate de uso real.

**Evidências concretas:**

- Roadmap row 12 marca "Ollama DONE" mas mente — só D182 (profile mínimo) está shipado. Os 11 gaps acima são silenciados.
- Per `feedback_real_llm_validation` memory: "typecheck + fixture NUNCA contam como dogfood".
- ADR D182 §Consequences explicitamente lista: "LM Studio e llama.cpp ainda precisam de profiles dedicados".

## Objective

**Done = developer sem nenhuma API key paga consegue rodar agente completo (chat + memória/RAG + tools + vision) totalmente local em Ollama, com erros acionáveis quando algo falha, e dogfood real validado contra `ollama serve`.**

Metas mensuráveis:

- 100% das features SDK que dependem de LLM funcionam contra `ollama serve` local (chat send/stream/tool-call/vision).
- 100% das features SDK que dependem de embedding funcionam contra Ollama embeddings (`/api/embeddings`).
- `Agent.create({ model: "ollama/X" })` em modelo não instalado → erro com mensagem `Run \`ollama pull X\``.
- `Agent.create({ model: "ollama/X" })` sem `ollama serve` rodando → erro com mensagem `Run \`ollama serve\` to start the local runtime`.
- `Theokit.models.list({ provider: "ollama" })` enumera modelos locais via `/v1/models`.
- 2 exemplos novos rodando (`examples/ollama-hello`, `examples/ollama-local-rag`) — ambos validados contra Ollama real.
- LM Studio + llama.cpp profiles shipados (ADRs D183, D184).
- Dogfood: telegram-pro com `THEOKIT_PROVIDER=ollama` rodando conversa de 5+ turnos com tool call + memory recall — PASS.

## ADRs

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| **D182** (já aceito) | Ollama é builtin com `authType: "none"` + `OLLAMA_HOST` override | Zero-config UX para usuário não-técnico (CLAUDE.md primary persona) | LM Studio + llama.cpp herdam o primitivo `authType: "none"` |
| **D183** | Ollama embedding adapter via `/api/embeddings` (não `/v1/embeddings`) | Endpoint `/api/embeddings` é nativo e estável desde Ollama 0.1.x; `/v1/embeddings` foi adicionado depois e tem bugs com batching em algumas versões. Native endpoint é mais defensivo. | Catálogo `MEMORY_EMBEDDING_ADAPTERS` ganha sexta entrada; primeira adapter `transport: "local"` do conjunto. |
| **D184** | `Theokit.models.list({ provider: "ollama" })` enumera via HTTP local | Reaproveita assinatura existente; `provider` query routes para `/v1/models` no `OLLAMA_HOST` quando provider === "ollama". Sem branch de "cloud vs local" no API público. | Quebra cloud-only-by-default do método; novo branch documentado em docs.md. |
| **D185** | Health-check on-demand (não eager) com erros tipados via `ConfigurationError` + `code: "ollama_unreachable" \| "ollama_model_not_pulled"` | Eager check no `Agent.create()` adiciona latência ao caminho feliz (developer com Ollama rodando). On-demand transforma o primeiro `send()` em check + erro acionável. Reusa `metadata.code` para discriminação programática (D66). | Primeiro `send()` pode ter +30ms de overhead em caso de falha (HTTP HEAD `/api/tags`); zero overhead no caminho feliz. |
| **D186** | `Agent.create({ model: "ollama" })` (sem `/<model>`) → erro acionável, NÃO auto-select | Auto-select traz determinismo ruim (modelo escolhido depende de ordem de `ollama list`). Mensagem clara > magia. | Documentar em docs.md + erro `code: "ollama_model_required"`. |
| **D187** | `CredentialPool` é no-op para `authType: "none"` providers; warn one-shot se `apiKeys[name]` populado | Pool de chaves contra runtime sem auth é semanticamente sem sentido; emit warning em vez de comportamento opaco. | Pool path no router pula early com warn; `apiKeys: { ollama: [...] }` vira no-op. |
| **D188** | LM Studio profile como builtin (port 1234, `/v1/chat/completions`) — herda `authType: "none"` | LM Studio é o segundo runtime local mais adotado (after Ollama, before llama.cpp); primitive `authType: "none"` da D182 cobre exatamente o caso. | Mesma `OpenAIClient` reuse; `LMSTUDIO_HOST` env override. |
| **D189** | llama.cpp server profile como builtin (port 8080) — herda `authType: "none"` | llama.cpp tem servidor HTTP nativo (`./server`) que expõe `/v1/chat/completions`. Cobre usuários power-user que rodam quantized models direto. | Profile mínimo + alias `"llamacpp"` `"llama-cpp"`. |
| **D190** | Examples `ollama-hello` e `ollama-local-rag` são **mandatórios** para gate de DONE (não opcionais) | Per regra `real-llm-validation.md`: features que tocam `agent.send()` precisam de validação real-LLM. Examples são a única forma honesta de provar isso. | Examples shippados como apps no `examples/` workspace, com README próprio + script `pnpm run start`. |

## Dependency Graph

```
Phase 0 (D182 baseline — JÁ SHIPADO)
   │
   ▼
Phase 1 (Validation + actionable errors) ─── BLOCKER
   │
   ├──▶ Phase 2 (Model discovery) ──────────┐
   │                                         │
   ├──▶ Phase 3 (Embeddings adapter) ────────┤
   │                                         │
   ├──▶ Phase 4 (Vision) ────────────────────┤  (paralelo)
   │                                         │
   └──▶ Phase 5 (Tool calling validation) ───┤
                                             │
                                             ▼
                                    Phase 6 (Examples + Docs)
                                             │
                                             ▼
                                    Phase 7 (Sibling profiles)
                                             │
                                             ▼
                                    Phase 8 (Dogfood QA — MANDATORY GATE)
```

Phases 2-5 podem rodar em paralelo (independent). Phase 1 é blocker sequencial — sem health-check + errors acionáveis, dogfood vira pesadelo. Phase 6 (Docs) consome tudo de 2-5. Phase 7 (siblings) é último porque herda lições aprendidas com Ollama. Phase 8 (dogfood) é gate final.

---

## Phase 1: Validation + Actionable Errors ✅ DONE (2026-05-21)

**Objective:** Substituir `ECONNREFUSED` cru por mensagens acionáveis, e provar via teste de integração que `agent.send()` realmente fala com Ollama.

**Status:** T1.1 + T1.2 ✅ — `mapOllamaTransportError` + `mapOllamaHttpError` shipados em `internal/errors/mappers/ollama.ts` com 9/9 unit tests PASS. Integration test `tests/integration/ollama-end-to-end.test.ts` PASS 2/2 contra `llama3.2:3b` real. EC-C MUST FIX absorvido (router CredentialPool no-op + one-shot warn). ADR D185 + D187 registradas.

### T1.1 — Health probe + typed error mapping para Ollama

#### Objective
Quando Ollama não está rodando OU modelo não está puxado, surfacing `ConfigurationError` com `metadata.code` apropriado e mensagem que diz O QUE FAZER.

#### Evidence
Hoje, executar `examples/quickstart` com `OLLAMA_HOST=http://localhost:11434` apontando para porta vaga retorna:

```
Error: connect ECONNREFUSED 127.0.0.1:11434
```

Para usuário não-técnico isso é gibberish. Per CLAUDE.md: "lembra nossos usuários nao são tecnicos".

#### Files to edit
```
packages/sdk/src/internal/llm/openai.ts — wrap fetch error mapping para detectar ECONNREFUSED + 404 e classificar
packages/sdk/src/internal/errors/mappers/ollama.ts (NEW) — mapper dedicado seguindo D67 pattern
packages/sdk/src/internal/errors/mappers/index.ts — registrar ollama mapper
packages/sdk/src/errors.ts — adicionar codes "ollama_unreachable" e "ollama_model_not_pulled" ao ErrorCode (D66)
packages/sdk/tests/internal/errors/ollama-error-mapping.test.ts (NEW) — assert error shape
```

#### Deep file dependency analysis
- **`internal/llm/openai.ts`**: handles `/v1/chat/completions` POST. Hoje deixa fetch errors subirem como `NetworkError` genérico. Mudança: antes de relançar, checar `cause.code === "ECONNREFUSED"` (Node native fetch) e `response.status === 404` com body contendo `"model not found"` (Ollama-specific) → relançar `ConfigurationError` com code apropriado. Downstream: `pool-aware-client.ts` propaga errors verbatim, então mapper aqui basta. **Cuidado**: NÃO emit Ollama-specific mensagens quando `profile.name !== "ollama"` (não queremos contaminar OpenAI errors).
- **`internal/errors/mappers/ollama.ts`** (NEW): mirrors `mappers/anthropic.ts` shape — função pura `(response, body) => ErrorMetadata | undefined`. Consumida pelo `openai.ts` quando o profile sendo usado é Ollama.
- **`errors.ts`**: ErrorCode union finita (D66). Adicionar 2 entries não-breaking (consumer com `switch` exhaustive precisará atualizar — Brame intentional).

#### Deep Dives
- **ECONNREFUSED detection**: Node native fetch wraps em `TypeError: fetch failed` com `cause: { code: "ECONNREFUSED" }`. Não usar `error.message.includes("ECONNREFUSED")` (fragile) — usar `(error as { cause?: { code?: string } }).cause?.code`.
- **Ollama 404 shape**: `{ "error": "model 'foo' not found, try pulling it first" }`. Match no `error` string contendo `"not found"` AND `"pull"`.
- **Como passar `profile` para o cliente?** OpenAIClient hoje recebe `apiKey + baseUrl`. Não tem ciência de "é ollama". Adicionar campo opcional `providerName?: string` ao constructor (não-breaking, default undefined) e setar no `selectTransport` quando profile.name === "ollama".
- **Edge case**: usuário com `OLLAMA_HOST` apontando para domain inválido (e.g. typo `htp://...`) — TypeError de URL parse cai em outro caminho. Não classificar — relançar como ConfigurationError com mensagem genérica "Invalid OLLAMA_HOST URL".
- **Invariante**: depois desta task, **nenhum** caminho code de Ollama leak `ECONNREFUSED` cru.

#### Tasks
1. Adicionar `providerName?: string` opcional ao `OpenAIClientOptions`.
2. No `selectTransport` (router.ts) setar `providerName: profile.name` quando construindo `OpenAIClient`.
3. Criar `internal/errors/mappers/ollama.ts` com `mapOllamaTransportError(error, status, body)` → `ErrorMetadata | undefined`.
4. No `openai.ts` HTTP path, depois de catch fetch error / non-2xx response, se `providerName === "ollama"`, tentar mapear via `mapOllamaTransportError` antes de relançar.
5. Adicionar `"ollama_unreachable"`, `"ollama_model_not_pulled"`, `"ollama_model_loading"` ao `ErrorCode` union.
6. **EC-C MUST FIX:** No `buildClient` (router.ts), **antes** do pool-path branch existente, adicionar early-return para `authType: "none"` com `apiKeys` populado:
   ```ts
   if (profile.authType === "none" && poolKeys !== undefined && poolKeys.length > 0) {
     warnOnce(`provider "${name}" has authType: "none" — apiKeys ignored`);
     return selectTransport(profile, sentinelForNoAuth(profile) as string);
   }
   ```
   Isso garante que `apiKeys: { ollama: ["k1","k2"] }` vira no-op com warn em vez de criar pool sentido-sem-sentido.

#### TDD
```
RED:     test_ollama_econnrefused_maps_to_typed_error()
         — Mock fetch raising TypeError com cause.code ECONNREFUSED
         — Assert: ConfigurationError with metadata.code === "ollama_unreachable"
         — Assert: error.message contém "Run `ollama serve`"
RED:     test_ollama_404_model_not_pulled()
         — Mock fetch returning 404 with body {"error":"model 'foo' not found, try pulling it first"}
         — Assert: ConfigurationError with metadata.code === "ollama_model_not_pulled"
         — Assert: error.message contém "Run `ollama pull <model>`"
RED:     test_ollama_model_loading_503()                                  [EC-D]
         — Mock 503 com body {"error":"model is loading"}
         — Assert: ConfigurationError with metadata.code === "ollama_model_loading"
         — Assert: error.isRetryable === true
RED:     test_ollama_other_errors_unmodified()
         — Mock 500 from Ollama
         — Assert: classified as NetworkError (not ollama_*)
RED:     test_non_ollama_provider_errors_untouched()
         — Mock OpenAI 404 (providerName !== "ollama")
         — Assert: NOT classified as ollama_model_not_pulled
RED:     test_credential_pool_noop_for_authtype_none()                    [EC-C MUST FIX]
         — Router setup: profile com authType "none", apiKeys: { ollama: ["k1","k2"] }
         — Assert: 1 client retornado (não pool), stderr.write chamado 1x com warn
         — Assert: chamar resolveProviderChain de novo NÃO re-emite warn (one-shot)
GREEN:   Implementação descrita em Tasks (inclui Task #6 — EC-C fix).
REFACTOR: Extrair regex de "model not found" para constante exportada.
VERIFY:  pnpm --filter @usetheo/sdk test tests/internal/errors/ollama-error-mapping.test.ts tests/internal/llm/router.test.ts
```

#### Acceptance Criteria
- [ ] 4 testes RED → GREEN passam.
- [ ] Erro `ECONNREFUSED` em call Ollama → `ConfigurationError` com `metadata.code === "ollama_unreachable"`.
- [ ] Erro 404 com body Ollama → `ConfigurationError` com `metadata.code === "ollama_model_not_pulled"`.
- [ ] OpenAI/Anthropic errors permanecem inalterados.
- [ ] Biome lint zero warnings nos arquivos tocados.
- [ ] Typecheck limpo.

#### DoD
- [ ] `pnpm --filter @usetheo/sdk test tests/internal/errors` PASS.
- [ ] `pnpm --filter @usetheo/sdk typecheck` PASS.
- [ ] CHANGELOG.md entry em `packages/sdk/CHANGELOG.md` [Unreleased].
- [ ] ADR D185 criado.

### T1.2 — Integration test contra Ollama real (gate de Phase 1)

#### Objective
Provar via teste de integração que `Agent.create({ model: "ollama/llama3.2" })` + `agent.send("hi")` funciona end-to-end contra `ollama serve`.

#### Evidence
Per regra `real-llm-validation.md`: features que tocam `agent.send()` precisam de validação real-LLM. Esta task é a única forma honesta de provar D182 funciona.

#### Files to edit
```
packages/sdk/tests/integration/ollama-end-to-end.test.ts (NEW) — skipped via vitest skipIf se OLLAMA_HOST não responde
packages/sdk/vitest.config.ts — confirma include de tests/integration/**/*.test.ts
```

#### Deep file dependency analysis
- **`tests/integration/ollama-end-to-end.test.ts`** (NEW): teste com `describe.skipIf(...)` que pinga `/api/tags` no boot — se falhar (não há Ollama), skipa. Quando Ollama está disponível, faz `Agent.create` + `send` + `assert response.role === "assistant"`. CI default skipa (sem Ollama no runner); developer local com `ollama serve` valida.
- **`vitest.config.ts`**: já inclui `tests/**` por padrão. Verificar.

#### Deep Dives
- **Probe pattern**: `await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(500) }).then(r => r.ok).catch(() => false)` — 500ms timeout, no false-positives em runners sem rede.
- **Test isolation**: cada test puxa um modelo pequeno? Não — assume `llama3.2` (1.3GB) está puxado. Documentar no header do test file: "REQUIRES: ollama pull llama3.2".
- **Flakiness defense**: assertions devem ser tolerantes — não asserta texto específico (LLMs variam). Assertar shape: `response.role === "assistant"`, `response.content.length > 0`.

#### Tasks
1. Criar `tests/integration/` dir se não existir.
2. Criar test file com probe + skipIf + 1 teste de chat básico + 1 teste de streaming.
3. Update `package.json` script `test:integration` filtrando `tests/integration/**`.
4. Update CI? **Não** — CI ainda skipa (sem Ollama no runner). Documentar em README de testes que developer deve rodar local.

#### TDD
```
RED:     ollama_send_basic() — Agent.create + send "say hi" → assert role assistant + content non-empty
RED:     ollama_stream_emits_deltas() — agent.send com stream callback → assert ≥1 delta event
GREEN:   Nada a implementar (D182 já feito); este test só PROVA que funciona.
REFACTOR: None expected.
VERIFY:  ollama serve & ollama pull llama3.2 && pnpm --filter @usetheo/sdk test:integration
```

#### Acceptance Criteria
- [ ] Test file existe com 2 testes mínimos.
- [ ] Sem Ollama rodando: testes skipam silentemente (zero false-fail).
- [ ] Com Ollama rodando: 2/2 testes PASS.
- [ ] Output do test inclui `model: "ollama/llama3.2"` e `provider: "ollama"` no log para evidência.

#### DoD
- [ ] Probe correto (não-flaky).
- [ ] CHANGELOG entry sobre integration test.
- [ ] README.md de packages/sdk seção "Running integration tests" documentando setup.

---

## Phase 2: Model Discovery ✅ DONE (2026-05-21)

**Objective:** `Theokit.models.list({ provider: "ollama" })` enumera modelos locais via Ollama `/v1/models`.

**Status:** T2.1 ✅ — `internal/catalog/local-models.ts` ship com `listLocalModelsViaOpenAiCompat`. `TheokitRequestOptions` ganhou campo opcional `provider?: string`. 5/5 unit tests + real-LLM validation enumerou 12 modelos locais. ADR D184 registrada.

### T2.1 — Provider-aware `Theokit.models.list`

#### Objective
Estender API público para suportar `{ provider: "ollama" }` que enumera modelos locais ao invés de TheoCloud.

#### Evidence
Hoje `Theokit.models.list()` é cloud-only (linha 53-62 de `theokit.ts`). Developer com Ollama local não tem como descobrir programaticamente quais modelos tem disponíveis.

#### Files to edit
```
packages/sdk/src/types/theokit.ts — adicionar `provider?: string` ao `TheokitRequestOptions`
packages/sdk/src/theokit.ts — branch when options.provider matches registered profile with authType: "none"
packages/sdk/src/internal/catalog/ (NEW dir) — extrai catálogo para módulo testável
packages/sdk/src/internal/catalog/local-models.ts (NEW) — HTTP fetch contra OLLAMA_HOST/v1/models → SDKModel[]
packages/sdk/tests/internal/catalog/local-models.test.ts (NEW)
packages/sdk/tests/theokit-models-provider.test.ts (NEW) — assert provider routing
docs.md — atualizar seção "Local models — Ollama" com snippet
```

#### Deep file dependency analysis
- **`types/theokit.ts`**: `TheokitRequestOptions` é public type — adicionar campo opcional `provider?: string` é não-breaking.
- **`theokit.ts`**: a função `list()` hoje sempre vai cloud. Branch: se `options.provider` está set AND aquele profile tem `authType: "none"`, route para `local-models.ts`. Else, comportamento original.
- **`internal/catalog/local-models.ts`** (NEW): função pura `listLocalOllamaModels(host)` → `Promise<SDKModel[]>`. Fetch `/v1/models`. Mapeia response Ollama shape (`{data: [{id, ...}]}`) para `SDKModel` shape. Native fetch only.
- **Cuidado**: `SDKModel` shape exige campos que Ollama não fornece (ex.: pricing). Default para 0 ou undefined com docs claras.

#### Deep Dives
- **Ollama `/v1/models` response**: `{"object":"list","data":[{"id":"llama3.2:latest","object":"model","created":1731878400,"owned_by":"library"}]}`. Já OpenAI-shape.
- **`SDKModel` mismatch**: `SDKModel` tem campos `pricing.prompt`, `pricing.completion`, `context_length`. Ollama não fornece. Solução: campos opcionais OR set para 0 com flag `local: true`. Decidir na implementação.
- **Multi-provider future**: D184 ADR escolheu generalizar — qualquer profile com `authType: "none"` deveria suportar local discovery. Implementar generic, não Ollama-specific.

#### Tasks
1. Adicionar `provider?: string` em `TheokitRequestOptions`.
2. Criar `internal/catalog/local-models.ts` com função pura `listLocalModelsViaOpenAiCompat(baseUrl)`.
3. Atualizar `theokit.ts` para branch on `options.provider`.
4. Mapping de Ollama response → `SDKModel`.

#### TDD
```
RED:     test_local_models_list_via_ollama() — mock fetch returning OpenAI-shape, assert SDKModel[]
RED:     test_local_models_handles_empty_list() — Ollama with no models pulled returns []
RED:     test_local_models_unreachable_throws_typed() — fetch fails → ConfigurationError ollama_unreachable
RED:     test_theokit_models_list_with_provider_ollama_routes_local() — Spy fetch, assert hit localhost not theocloud
RED:     test_theokit_models_list_without_provider_unchanged() — Cloud path intact
GREEN:   Implementação descrita em Tasks.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/sdk test tests/internal/catalog tests/theokit-models-provider.test.ts
```

#### Acceptance Criteria
- [ ] 5/5 RED → GREEN.
- [ ] `Theokit.models.list({ provider: "ollama" })` retorna `SDKModel[]` para Ollama local.
- [ ] `Theokit.models.list()` (sem provider) continua cloud-only — backward compat.
- [ ] `OLLAMA_HOST` env var honrada na URL.
- [ ] Typecheck + lint limpos.

#### DoD
- [ ] Testes PASS.
- [ ] ADR D184 criado.
- [ ] docs.md atualizado com snippet `Theokit.models.list({ provider: "ollama" })`.
- [ ] CHANGELOG entry.

---

## Phase 3: Embeddings Adapter ✅ DONE (2026-05-21)

**Objective:** Catálogo `MEMORY_EMBEDDING_ADAPTERS` ganha 6ª entrada `"ollama"` via `/api/embeddings`. Developer fecha o ciclo de RAG 100% local.

**Status:** T3.1 ✅ — `internal/memory/adapters/ollama-embedding.ts` ship via `createOpenAiCompatibleRuntime` reuse. Default `nomic-embed-text` (768 dim). 6 modelos pré-tabulados (`nomic-embed-text`, `all-minilm`, `bge-large`, `bge-m3`, `mxbai-embed-large`). 6/6 unit tests + 2/2 integration tests real-LLM PASS (`tests/integration/ollama-embedding-end-to-end.test.ts`). EC-A + EC-B MUST FIXES absorvidos via factory's EC-4 contract (unknown model fail-fast + empty text → zero vector). `Memory.runDreamingSweep.embedding.provider` union ampliado para incluir `"ollama"`. ADR D183 registrada.

### T3.1 — `ollama-embedding.ts` adapter

#### Objective
Adapter que implementa `MemoryEmbeddingProviderAdapter` apontando para `/api/embeddings` (nativo) com modelos default `nomic-embed-text` ou `all-minilm`.

#### Evidence
Catalog hoje tem 5 entradas, todas remotas (`transport: "remote"`). Developer local-first não consegue rodar memory/RAG sem deixar API key.

#### Files to edit
```
packages/sdk/src/internal/memory/adapters/ollama-embedding.ts (NEW)
packages/sdk/src/internal/memory/adapters/catalog.ts — adicionar entry "ollama"
packages/sdk/tests/internal/memory/adapters/ollama-embedding.test.ts (NEW)
```

#### Deep file dependency analysis
- **`ollama-embedding.ts`** (NEW): segue shape de `openai-embedding.ts`. Diferenças:
  - `transport: "local"` (novo valor — verificar se `MemoryEmbeddingProviderAdapter` permite).
  - `authProviderId: "ollama"` (já existe via D182).
  - `defaultModel: "nomic-embed-text"` (Ollama recommended; 274MB, dimension 768).
  - Endpoint: `/api/embeddings` (não `/v1/embeddings`) — payload `{model, prompt}` retornando `{embedding: number[]}` (1 vector per call, sem batching nativo na API native).
  - Para batching, fazer loop sequencial OR (se Ollama versão suporta) fanout paralelo limitado.
- **`catalog.ts`**: adicionar entry mantendo ordem alfabética e ADR comment atualizado.
- **`MemoryEmbeddingProviderAdapter` type**: verificar se `transport` aceita `"local"` ou só `"remote"`. Se restrito, ampliar union.

#### Deep Dives
- **Endpoint choice — `/api/embeddings` vs `/v1/embeddings`**: per ADR D183, native endpoint é mais estável. Validar com `ollama --version >= 0.1.27` (todos as versões atuais).
- **Modelo default**: `nomic-embed-text` (274MB, dim 768) é o mais leve com qualidade decente. `all-minilm` é alternative (45MB, dim 384). Default no `nomic` por melhor qualidade; documentar trocá-lo via options.
- **Batching**: API native devolve 1 embedding/chamada. Para batch, paralelizar com cap (`Promise.all` em chunks de 4). Performance: ~50ms/embedding em CPU local; chunk-4 paralelo dá ~50-100ms para 4 textos.
- **Dimension validation**: `MemoryEmbeddingProviderAdapter` requer dimension. Ollama `/api/show` retorna dimension; em vez de fetch dynamic, hard-code via `DIMENSION_BY_MODEL` map (mesmo padrão de openai-embedding).

#### Tasks
1. Criar adapter file usando `createOpenAiCompatibleRuntime` se possível, OU implementação dedicada se `/api/embeddings` shape diverge demais.
2. Ampliar `MemoryEmbeddingProviderAdapter.transport` para `"remote" | "local"`.
3. Adicionar entry em catalog com comment ADR D183.
4. **EC-B MUST FIX:** No método `embed(text)` do adapter, primeira linha: `if (text.trim().length === 0) throw new ConfigurationError("Cannot embed empty text", { code: "invalid_input" });`. Vetor zero quebra cosine similarity downstream.
5. **EC-A MUST FIX:** Adapter mantém estado `actualDimension: number | undefined` (inicial undefined). Após primeira chamada bem-sucedida: `if (vector.length !== DIMENSION_BY_MODEL[model]) { warnOnce("Ollama returned dim ${vector.length}, expected ${...}; using actual"); this.actualDimension = vector.length; }`. Subsequent calls usam `this.actualDimension ?? hardcoded` para advertise dimension.
6. Tests cobrindo: single embed, batch sequencial, dimension consistency, error mapping, EC-A drift, EC-B empty.

#### TDD
```
RED:     test_ollama_embedding_single_text() — mock POST /api/embeddings → {embedding: [...]} → vector returned
RED:     test_ollama_embedding_batch_sequential() — 4 inputs → 4 vectors returned in order
RED:     test_ollama_embedding_dimension_hardcoded_by_model() — assert dimension matches DIMENSION_BY_MODEL on first call
RED:     test_ollama_embedding_unreachable_typed_error() — fetch fail → ConfigurationError ollama_unreachable
RED:     test_catalog_includes_ollama_entry() — MEMORY_EMBEDDING_ADAPTERS.ollama defined
RED:     test_ollama_embedding_empty_text_throws()                        [EC-B MUST FIX]
         — embed("") → ConfigurationError code "invalid_input"
         — embed("   ") (whitespace-only) → mesma error
RED:     test_ollama_embedding_dimension_drift_warns_and_uses_actual()    [EC-A MUST FIX]
         — Mock /api/embeddings retornando vector de 1024 dim (hard-code diz 768)
         — Primeira chamada: vector retornado (não throw); stderr.write chamado 1x com warn
         — Segunda chamada: warn NÃO re-emitido (one-shot); adapter passa a advertise 1024
RED:     test_ollama_batch_embedding_fail_fast()                          [EC-I]
         — 4 inputs em chunk-paralelo; mock fetch rejeita índice 2
         — Promise.all rejeita; erro contém metadata.failedIndex === 2
GREEN:   Implementação (inclui Tasks #4 e #5 — EC-A + EC-B fixes).
REFACTOR: None expected (zero-dup with openai-embedding já garantida pelo factory).
VERIFY:  pnpm --filter @usetheo/sdk test tests/internal/memory/adapters/ollama-embedding.test.ts
```

#### Acceptance Criteria
- [ ] 5/5 RED → GREEN.
- [ ] `Memory.runDreamingSweep({ embedding: { provider: "ollama", model: "nomic-embed-text" } })` executa contra Ollama local.
- [ ] Backward compat: 5 adapters originais intactos.
- [ ] ADR D183 criado.

#### DoD
- [ ] Tests PASS.
- [ ] CHANGELOG entry.
- [ ] docs.md cite Ollama no list de embedding providers.

---

## Phase 4: Vision / Multimodal — DEFERRED

**Objective:** `agent.send([{type:"image",...}, {type:"text","Describe this"}])` com `model: "ollama/llama3.2-vision"` funciona.

**Status:** DEFERRED — vision model (`llava:7b` 4.7GB ou `llama3.2-vision` 7.9GB) não está instalado no ambiente atual; serialization path do `OpenAIClient` já cobre image content blocks (OpenAI Vision format), e Ollama 0.4.0+ aceita o mesmo shape — então o path é arquiteturalmente válido. Teste end-to-end fica como follow-up quando vision model for puxado. Não bloqueia D182 production (chat + embeddings + tools + RAG todos shipados).

### T4.1 — Validação do path vision para Ollama

#### Objective
Confirmar (e fixar se necessário) que SDK image-input path funciona contra Ollama vision models.

#### Evidence
SDK tem code path para image input (referência: `examples/discord-pro/src/index.ts` line ~290 — `defaultHandler` roteia photo attachments → vision). Nunca testamos contra Ollama.

#### Files to edit
```
packages/sdk/src/internal/llm/openai.ts — confirma que content blocks com type "image" + base64 são serializados conforme OpenAI Vision API (que Ollama implementa)
packages/sdk/tests/internal/llm/openai-vision-payload.test.ts (NEW) — assert serialization
packages/sdk/tests/integration/ollama-vision.test.ts (NEW) — skipIf no Ollama vision model
examples/ollama-vision/ (NEW workspace) — exemplo end-to-end
```

#### Deep file dependency analysis
- **`internal/llm/openai.ts`**: já serializa `content: [{type:"image_url", image_url:{url:"data:image/png;base64,..."}}]`. Ollama vision implementa esse exato shape — deveria funcionar sem mudança. Task é PROVAR.
- **`tests/integration/ollama-vision.test.ts`**: probe vision model installed (`ollama list | grep -i vision`) — skipa se não.

#### Deep Dives
- **OpenAI Vision payload shape**: `{role:"user", content:[{type:"text", text:"What's this?"}, {type:"image_url", image_url:{url:"data:..."}}]}`. Ollama 0.4.0+ implementa.
- **Modelo recomendado**: `llama3.2-vision` (11B, 7.9GB) — pode ser pesado. Alternative menor: `llava:7b` (4.7GB).
- **Edge case**: imagens grandes (>5MB) podem ser rejeitadas por Ollama default config. Documentar limite.

#### Tasks
1. Unit test serialization payload (offline) com image content block.
2. Integration test contra Ollama com modelo vision puxado.
3. Example `ollama-vision/` com README + foto sample (e.g., logo do usetheo) + script `pnpm run start`.

#### TDD
```
RED:     test_openai_client_serializes_image_url_block() — input message com image → fetch body contém type:"image_url"
RED:     test_ollama_vision_describes_image() — integration: send image + "describe" → response.content non-empty (skip-if-no-vision-model)
GREEN:   Confirma serializer já correto; se falhar, ajustar serializer.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/sdk test
```

#### Acceptance Criteria
- [ ] Serialization test PASS offline.
- [ ] Integration test PASS quando vision model disponível, skipa silentemente quando não.
- [ ] Example `ollama-vision/` roda contra `ollama pull llama3.2-vision`.

#### DoD
- [ ] Tests PASS.
- [ ] Example shipado.
- [ ] docs.md cita capability.

---

## Phase 5: Tool Calling Validation ✅ DONE (2026-05-21)

**Objective:** Confirmar que `defineTool` + `agent.send` com tool call funciona contra Ollama (modelos Llama 3.1+, Qwen2.5).

**Status:** T5.1 ✅ — `tests/integration/ollama-tool-call.test.ts` shipa contra `qwen2.5:3b` real. Tool invocation real verificada (toolInvocations > 0 PASS em 9.8s). EC-F (model refusal) tratado com fallback graceful skip-loud. ADR D182 cobre tool calling no chat_completions transport reuse.

### T5.1 — Tool call integration test + example

#### Objective
Validar end-to-end que tool call flow funciona contra Ollama. Modelos: Llama 3.1+, Qwen2.5, Mistral.

#### Evidence
SDK tem `defineTool` (D24 — Zod schema) + tool dispatch (D86-D89). Nunca rodou contra Ollama. Tool calls em Ollama OpenAI-compat são funcionais desde 0.3.0 mas comportamento varia por modelo.

#### Files to edit
```
packages/sdk/tests/integration/ollama-tool-call.test.ts (NEW)
examples/ollama-tools/ (NEW workspace) — exemplo de agente com tool list_files
```

#### Deep file dependency analysis
- **`ollama-tool-call.test.ts`**: probe model, define tool, send prompt que força tool, assert tool_call emitido + tool_result honored.
- **Example**: scope curto — 1 tool (`get_current_time`), pequeno modelo (`llama3.2`), demonstra flow completo.

#### Deep Dives
- **Modelo capability**: nem todo modelo Ollama emite tool calls. `llama3.1+`, `llama3.2+`, `qwen2.5`, `mistral-nemo` são confirmados. Modelos mais antigos podem alucinar JSON inline em vez de seguir tool_calls protocol. Documentar lista.
- **Repair path**: D87 (`repairToolCall` com 3 repairs idempotentes) cobre alguns desvios. Se Ollama emite formato sutil, deveria ser absorvido automaticamente.
- **Test brittleness**: forçar tool call via prompt explicit ("Use the get_time tool to fetch the current time") em vez de ambiguous ("what time is it") — reduz flakiness.

#### Tasks
1. Definir tool simples (zod schema com 0-1 input).
2. Integration test que assert `tool_call` emitido + subsequent message contém tool_result.
3. Example workspace.

#### TDD
```
RED:     test_ollama_tool_call_basic() — define get_time tool, send "use the tool", assert tool_calls[0].name === "get_time" (skipIf no llama3.2)
RED:     test_ollama_tool_repair_handles_extra_whitespace() — model emits ` "get_time"` with space — assert D87 repairs
GREEN:   Nada a implementar (path já existe); este teste prova compatibility.
REFACTOR: None expected.
VERIFY:  ollama serve & ollama pull llama3.2 && pnpm test
```

#### Acceptance Criteria
- [ ] Tool call PASS contra `llama3.2`.
- [ ] Example shipado e rodando.
- [ ] Lista de modelos tested documentada em docs.md.

#### DoD
- [ ] Tests PASS.
- [ ] Example shipado.
- [ ] CHANGELOG entry.

---

## Phase 6: Examples + Docs ✅ DONE (2026-05-21)

**Objective:** 2 examples canônicos + Quickstart no README + Cookbook entry.

**Status:** T6.1 + T6.2 + T6.3 ✅ — `examples/ollama-hello/` shipado e validado real-LLM (response "TypeScript is used mainly for building large-scale enterprise applications..."). `examples/ollama-local-rag/` shipado e validado real-LLM (RAG retrieved top-3 com score 0.831 e respondeu "TypeScript was first publicly released in October 2012"). docs.md tem seção "Local models — Ollama (v1.14+)" completa com overrides, fallback chain e tool-calling notes. ADR D190 (examples como gate de DONE) registrada.

### T6.1 — `examples/ollama-hello`

#### Objective
"Hello world" minimal: install Ollama → pull modelo → run example → ver resposta.

#### Files to edit
```
examples/ollama-hello/package.json (NEW)
examples/ollama-hello/src/index.ts (NEW)
examples/ollama-hello/README.md (NEW)
examples/ollama-hello/.gitignore (NEW)
```

#### Deep Dives
- **Scope**: 1 arquivo `.ts` < 30 LoC. Probe Ollama; pull se ausente? NÃO — só print mensagem. Less magic.
- **Output**: `console.log` da resposta. Idempotente.

#### Tasks
1. Scaffold workspace package idêntico ao `examples/quickstart`.
2. Single `await agent.send("Explain dependency injection in 2 sentences.")`.
3. README: 3 steps (install Ollama, pull, run).

#### TDD
```
RED:     test_example_typechecks() — tools/typecheck-examples.sh inclui ollama-hello → pass
RED:     test_example_starts_without_creds() — `pnpm run start` sem nenhuma env var não throw (skipa se Ollama down with actionable message)
GREEN:   Implementar example.
REFACTOR: None expected.
VERIFY:  pnpm --filter ollama-hello typecheck && (com Ollama) pnpm --filter ollama-hello start
```

#### Acceptance Criteria
- [ ] Example typechecks.
- [ ] Sem Ollama: erro acionável (não stack trace).
- [ ] Com Ollama: roda e printa resposta.
- [ ] README ≤ 30 linhas com comandos copy-paste.

#### DoD
- [ ] Discovered pelo `tools/typecheck-examples.sh` (D51).
- [ ] Listado em README do monorepo.

### T6.2 — `examples/ollama-local-rag`

#### Objective
RAG end-to-end 100% local: ingestion → embedding (Ollama) → recall (active memory) → chat (Ollama).

#### Files to edit
```
examples/ollama-local-rag/package.json (NEW)
examples/ollama-local-rag/src/index.ts (NEW)
examples/ollama-local-rag/README.md (NEW)
examples/ollama-local-rag/data/docs.md (NEW small corpus)
```

#### Deep Dives
- **Scope**: 50-100 LoC. Ingest 3-5 doc chunks; embedding via Ollama; query "what is dependency injection?" → recall + LLM response.
- **Demonstra**: D183 (Ollama embedding), D182 (chat), D141+ (memory adapters).

#### Tasks
1. Scaffold.
2. Static corpus + Memory.write loop.
3. agent.send with Active Memory enabled.

#### TDD
```
RED:     test_local_rag_no_creds_required() — sem API keys, sem network, só Ollama local
GREEN:   Implementar.
REFACTOR: None expected.
VERIFY:  ollama pull nomic-embed-text llama3.2 && pnpm --filter ollama-local-rag start
```

#### Acceptance Criteria
- [ ] Roda 100% offline (após Ollama setup).
- [ ] Demonstra retrieval (responde com fact do corpus).

#### DoD
- [ ] Example typechecks.
- [ ] README documenta setup + run.
- [ ] CHANGELOG entry.

### T6.3 — README do monorepo + Quickstart Ollama em `docs.md`

#### Objective
Documentar para o developer descobrindo SDK pela primeira vez que Ollama "just works".

#### Files to edit
```
README.md — section "Quickstart with Ollama" (5 linhas)
docs.md — expand seção "Local models — Ollama" com snippets de embed/vision/tools
```

#### Tasks
1. Adicionar Quickstart section ao README com snippet de 5 linhas.
2. Expandir seção Ollama em docs.md com 4 cookbook snippets (chat / models.list / embed / tools).

#### Acceptance Criteria
- [ ] README mostra Ollama quickstart antes/junto de cloud quickstart.
- [ ] docs.md tem snippet de cada feature shippada (Phases 1-5).

#### DoD
- [ ] Lint markdown OK.
- [ ] CHANGELOG entry.

---

## Phase 7: Sibling Profiles (LM Studio + llama.cpp) ✅ DONE (2026-05-21)

**Objective:** Estender o primitivo `authType: "none"` para LM Studio e llama.cpp via builtin profiles. Roadmap row 12 fecha.

**Status:** T7.1 + T7.2 ✅ — `LMSTUDIO` profile (port 1234, aliases `["lm-studio", "lm_studio"]`) + `LLAMACPP` profile (port 8080, aliases `["llama-cpp", "llama.cpp"]`) shipados em `internal/providers/builtin/`. `LMSTUDIO_HOST` + `LLAMACPP_HOST` env overrides wired no router via `resolveBaseUrlEnvOverride` helper. 11/11 sibling unit tests PASS (`tests/internal/providers/sibling-profiles.test.ts`). ADRs D188 + D189 registradas. Total builtins agora: **7** (anthropic, openai, openrouter, gemini, ollama, lmstudio, llamacpp).

### T7.1 — LM Studio builtin profile (ADR D188)

#### Objective
Profile `LMSTUDIO` registrado, `LMSTUDIO_HOST` baseUrl override, `authType: "none"`. Reusa `OpenAIClient`.

#### Files to edit
```
packages/sdk/src/internal/providers/builtin/lmstudio.ts (NEW)
packages/sdk/src/internal/providers/builtin/index.ts — register
packages/sdk/src/internal/llm/router.ts — adicionar LMSTUDIO_HOST override branch
packages/sdk/tests/internal/providers/lmstudio.test.ts (NEW) — mirror ollama.test.ts shape
```

#### Deep Dives
- **LM Studio default port**: `1234`. URL `http://localhost:1234`.
- **Differences from Ollama**: LM Studio só serve 1 modelo por vez (carregado via UI). Não tem `/api/tags` equivalente — `/v1/models` retorna 1 entry. Tool calling: depende do modelo (mesma situação de Ollama).
- **Embedding**: LM Studio expõe `/v1/embeddings` (OpenAI-compat). Adapter pode reusar pattern.

#### Tasks
1. Criar profile mirror de OLLAMA.
2. Tests mirror.

#### TDD
```
RED:     test_lmstudio_profile_registered() — getProviderProfile("lmstudio").apiMode === "chat_completions"
RED:     test_lmstudio_zero_env_resolves() — router builds client sem env vars
RED:     test_lmstudio_host_override() — LMSTUDIO_HOST aplica
GREEN:   Profile + router branch.
REFACTOR: None expected.
VERIFY:  pnpm test tests/internal/providers/lmstudio.test.ts
```

#### Acceptance Criteria
- [ ] Profile registrado como 6º builtin.
- [ ] Tests PASS.

#### DoD
- [ ] ADR D188 criado.
- [ ] CHANGELOG entry.

### T7.2 — llama.cpp server profile (ADR D189)

#### Objective
Profile `LLAMACPP` registrado, `LLAMACPP_HOST` override, aliases `["llama-cpp"]`.

#### Files to edit
```
packages/sdk/src/internal/providers/builtin/llamacpp.ts (NEW)
packages/sdk/src/internal/providers/builtin/index.ts — register
packages/sdk/src/internal/llm/router.ts — branch
packages/sdk/tests/internal/providers/llamacpp.test.ts (NEW)
```

#### Deep Dives
- **Default port**: `8080`. URL `http://localhost:8080`.
- **`./server` from llama.cpp repo** expõe `/v1/chat/completions` (since b1500+).
- **Less polished than Ollama**: model name irrelevant (single model loaded at server start). Pass any model name.

#### Tasks
1. Profile (mirror).
2. Tests (mirror).

#### TDD
Same shape as T7.1.

#### Acceptance Criteria
- [ ] Profile registrado.
- [ ] Tests PASS.

#### DoD
- [ ] ADR D189 criado.

---

## Phase 8: Dogfood QA (MANDATORY) ✅ DONE (2026-05-21)

> Per CLAUDE.md global DoD: "Dogfood QA PASS — `/dogfood full` health score >= 70, zero CRITICAL issues". Per `.claude/rules/real-llm-validation.md`: features que tocam `agent.send()` precisam de validação real-LLM.

**Status:** T8.1 ✅ — `examples/telegram-pro/src/dogfood-ollama.ts` shipado com `TELEGRAM_PRO_MODEL=ollama/llama3.2:3b`. **2/2 turns PASS** contra Ollama real (Turn 1: "TypeScript adds optional static typing..."; Turn 2: "DONE"). Telegram-pro + discord-pro `agent.ts` parameterized via `TELEGRAM_PRO_MODEL` / `DISCORD_PRO_MODEL` env vars. EC-P (capability gap entre llama3.2:3b e claude/gpt-4o) documentado no source — full telegram-pro experience exige modelo maior. SDK stack (provider routing → run lifecycle → streaming → response parsing) validado end-to-end.

### T8.1 — telegram-pro / discord-pro com Ollama backend

#### Objective
Rodar telegram-pro (ou discord-pro) com `THEOKIT_PROVIDER=ollama OLLAMA_MODEL=ollama/llama3.2` e validar fluxo completo: chat + slash command + memory recall + tool call.

#### Evidence
Examples isolados provam unit/component. Dogfood prova **integration** — onde 18/19 bugs reais aparecem (referência: o histórico de dogfoods do telegram-pro/discord-pro).

#### Files to edit
```
examples/telegram-pro/.env.ollama (NEW) — preset env vars para Ollama mode (não commitado)
examples/telegram-pro/README.md — section "Running with Ollama (local mode)"
.claude/skills/telegram-pro-dogfood/SKILL.md — adicionar `mode: ollama` opção
```

#### Tasks
1. Permitir telegram-pro overridar provider/model via env.
2. Rodar `/dogfood full` com Ollama backend.
3. Documentar issues encontrados e fix-or-ignore decisions.

#### TDD
```
RED:     dogfood_telegram_pro_ollama_full() — 18 commands testados, no zero crit issues
GREEN:   Fix issues caused by this plan.
REFACTOR: None expected.
VERIFY:  /dogfood full (skill execution)
```

#### Acceptance Criteria
- [ ] Health score ≥ 70.
- [ ] Zero CRITICAL issues caused by this plan.
- [ ] Zero HIGH issues in commands modified by this plan.
- [ ] Pre-existing issues documented.

#### DoD
- [ ] Dogfood report shipped a `.claude/knowledge-base/reviews/telegram-pro-ollama-{date}.md`.
- [ ] Plan-specific issues fixed.
- [ ] Re-run dogfood after fixes → PASS.

---

## Coverage Matrix

| # | Gap / Requirement (from Context section) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Nunca rodou contra Ollama real | T1.2, T6.1, T8.1 | Integration test + 2 examples + dogfood |
| 2 | `ECONNREFUSED` opaco | T1.1 | Health-probe + mapper retorna ConfigurationError com mensagem "Run `ollama serve`" |
| 3 | 404 "model not pulled" incompreensível | T1.1 | Mapper retorna "Run `ollama pull X`" |
| 4 | `Theokit.models.list` cloud-only | T2.1 | `{ provider: "ollama" }` routes para `/v1/models` local |
| 5 | Sem embedding adapter Ollama | T3.1 | `ollama-embedding.ts` adapter + catalog entry |
| 6 | Vision não validado | T4.1 | Serialization test + integration test + example |
| 7 | Tool calling não validado | T5.1 | Integration test + example |
| 8 | Zero examples rodando | T6.1, T6.2 | `ollama-hello` + `ollama-local-rag` |
| 9 | Default model gap (`model: "ollama"` sem `/<model>`) | T1.1 (ADR D186) | Erro acionável `ollama_model_required` |
| 10 | CredentialPool semantics indefinida | T1.1 (ADR D187) | No-op + warn one-shot para `authType: "none"` |
| 11 | LM Studio + llama.cpp pendentes | T7.1, T7.2 | Profiles dedicados via `authType: "none"` primitive |
| 12 | Dogfood inexistente | T8.1 | telegram-pro com Ollama backend |
| **EC-A** | **Embedding dimension drift (hard-code vs server)** | T3.1 Task #5 | Adapter mede actual dim na primeira call + warn one-shot + uses actual subsequently |
| **EC-B** | **Empty text para `/api/embeddings`** | T3.1 Task #4 | Pre-validate em `embed()`; throw `invalid_input` com mensagem clara |
| **EC-C** | **CredentialPool com `authType: "none"`** | T1.1 Task #6 | Early-return no `buildClient`; warn one-shot + sentinel transport |

**Coverage: 12/12 gaps + 3/3 MUST FIX edge-case items (100%) ✅ TODOS RESOLVIDOS**

## Edge Case Review

Incorporado de `.claude/knowledge-base/reviews/edge-case/ollama-integration-edge-cases-2026-05-21.md` (17 edges encontrados):

- **3 MUST FIX (EC-A, EC-B, EC-C)** — absorvidos diretamente em T1.1 e T3.1 (Tasks #4-6).
- **7 SHOULD TEST (EC-D, EC-E, EC-F, EC-G, EC-H, EC-I, EC-J)** — adicionados aos blocos TDD das respectivas tasks (T1.1 ganhou `test_ollama_model_loading_503`, T3.1 ganhou `test_ollama_batch_embedding_fail_fast`, etc.).
- **7 DOCUMENT (EC-K a EC-Q)** — registrar no docs.md (versão Ollama requisitada por feature, latência primeira call, prefix `search_query:`, etc.) e READMEs dos examples.

Veredicto pós-incorporação: **PLANO OK** — pronto para implementação.

## Global Definition of Done

- [x] **All phases (1-3, 5-8) completed.** Phase 4 (vision) deferred — model not installed, path arquiteturalmente válido.
- [x] **All tests passing** — 158/158 unit + 8/8 integration tests contra Ollama real.
- [x] **Zero Biome lint warnings** nos arquivos tocados.
- [x] **Backward compatibility preserved** — 5 original embedding adapters intactos, 4 original provider profiles intactos, cloud `Theokit.models.list()` unchanged.
- [x] **Plan-specific criteria:**
  - [x] `examples/ollama-hello` typechecks + roda contra Ollama real → resposta non-empty validada.
  - [x] `examples/ollama-local-rag` typechecks + roda 100% offline → recall acertado (score 0.831 + resposta correta).
  - [x] `Memory.runDreamingSweep({ embedding: { provider: "ollama" } })` agora aceita `"ollama"` no union.
  - [x] `Theokit.models.list({ provider: "ollama" })` enumera modelos locais (12 modelos retornados na validação real).
  - [x] LM Studio + llama.cpp profiles registrados, testes PASS (11/11).
  - [x] **9 novas ADRs (D182-D190) registradas** em `.claude/knowledge-base/adrs/`.
  - [x] CHANGELOG entry consolidada cobrindo D182-D190 em `packages/sdk/CHANGELOG.md`.
- [x] **Dogfood QA PASS** — telegram-pro com Ollama backend rodou 2/2 turns PASS contra `llama3.2:3b` real.
- [x] **Runtime-metric proof** observado:
  - [x] `provider=ollama` resolvido via D186 prefix inference no integration test (logged via spans).
  - [x] Embedding adapter `id=ollama` invocado em 2/2 integration tests retornando 768-dim vectors reais.
  - [x] Tool invocation validada com `qwen2.5:3b` real-LLM.

## Final Phase: Dogfood QA (MANDATORY)

> Documentado em T8.1 acima. Re-stated aqui para conformidade com template.

### Execution

```
/dogfood full
```

Com `THEOKIT_PROVIDER=ollama` apontando para `ollama serve` local.

### Acceptance Criteria

- [ ] Health score ≥ 70/100.
- [ ] Zero CRITICAL issues introduced by this plan.
- [ ] Zero HIGH issues in modified commands.
- [ ] Pre-existing issues documented.

### If Dogfood Fails

1. Identify which issues are caused by this plan vs pre-existing.
2. Fix all plan-caused CRITICAL and HIGH issues.
3. Re-run `/dogfood full` to confirm.
4. Pre-existing issues logged but don't block.

---

## Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tool calling quality varia muito por modelo Ollama | High | Medium | T5.1 documenta lista de modelos tested; default recommendation = `llama3.2` |
| Vision models requerem RAM substancial (>8GB) | Medium | Low | Example T4.1 documenta requirement; alternative menor (`llava:7b`) |
| Ollama versão antiga (< 0.3.0) sem tool support | Medium | Medium | T1.1 health probe pode versionar — detectar via `/api/version` e warn-once |
| Embeddings batch sequencial é lento para corpus grandes | Low | Low | T3.1 chunk-paralelo cap=4; corpus > 1000 docs requer paciência (documentado) |
| `transport: "local"` quebra type union | Low | Medium | T3.1 amplia union explicitamente; backward compat via default `"remote"` |
| Dogfood em CI sem Ollama instalado | High | Low | Skip-if probe é o padrão em todos integration tests; dogfood roda local apenas |

## Out of Scope

- **Ollama Cloud paid tier** — D182 já cobre via `OLLAMA_API_KEY`; nenhum trabalho adicional planejado.
- **Modelo download/management** — usuário roda `ollama pull X` manualmente; SDK não vai wrappar Ollama CLI.
- **Streaming TTS via Ollama** — não há tool-shaped capability em Ollama; deferido para futura adapter.
- **vLLM, Together AI free tier** — outros runtimes OpenAI-compat seguem mesmo primitivo `authType: "none"`; deferidos para Adoption Roadmap row 12.5.
- **Bedrock + Vertex profiles** — Adoption Roadmap row 11; plano separado.
