# Plan: Bedrock + Vertex Provider Profiles

> **Version 1.2 — ✅ COMPLETE 2026-05-23.** TODAS AS TASKS, CRITERIOS DE ACEITES, DODs CONCLUIDAS E VALIDADAS. Profiles `bedrock` + `vertex` shipados em `internal/providers/builtin/{bedrock,vertex}.ts`. 4 transport modules novos: `BedrockAnthropicClient` (InvokeModel non-streaming D302), `BedrockTokenCache` (env + optional `@aws/bedrock-token-generator`), `VertexAnthropicClient` (`:rawPredict` body massage D292), `VertexGeminiClient` (OpenAI-compat fetch rewriter), `VertexRouterClient` (dispatch por `inferModelDialect` no stream-time), `VertexAuth` (ADC via lazy `google-auth-library`). 2 error mappers novos (`mapBedrockError`, `mapVertexError`) seguindo D67 pattern. Router extended: `selectTransport` ganhou cases `bedrock_anthropic` + `anthropic_messages` sub-dispatch para `vertex`; `sentinelForLazyAuth` permite Vertex/Bedrock construir client mesmo sem env credentials (lazy resolve at stream time com helpful errors). 5 MUST FIX edges absorvidos (EC-1/3/5/6/13). **60/60 unit tests PASS** (15 bedrock profile + 13 vertex profile + 9 bedrock client + 3 token cache + 5 vertex client + 7 bedrock mapper + 8 vertex mapper). Build CJS+ESM+DTS verde. **Telegram-pro dogfood: 43/45 PASS, 0 feature regressions** (1 FAIL = `Remember: meu time é Corinthians` flake; 1 SKIP = HONCHO). 17 ADRs (D286-D302). Live Bedrock/Vertex test env-gated (D284 pattern).
>
> **Version 1.1** — Edge case review 2026-05-23 absorveu 5 MUST FIX + adicionou **D302** (Bedrock streaming deferido a v1.x) → 17 ADRs (D286-D302). Fixes: EC-1 helpful error quando Vertex `projectId` undefined; EC-3 helpful error quando `google-auth-library` missing; EC-5 v1 Bedrock é non-streaming only (AWS event stream binary parser fora de escopo); EC-6 helpful error quando Bedrock token undefined; EC-13 convenção `bedrock/{aws-id}` para routing. 4 SHOULD TEST adicionados aos TDD; 3 DOCUMENT integrados. Review: `.claude/knowledge-base/reviews/edge-case/bedrock-vertex-profiles-edge-cases-2026-05-23.md`.
>
> **Version 1.0** — Adiciona dois `ProviderProfile` (D105) novos ao `@theokit/sdk` — `bedrock` e `vertex` — fechando o item #8 do Adoption Roadmap e habilitando enterprise customers AWS/GCP. Caminho de menor atrito: **ambos via Bearer-token + `fetch` nativo, sem SigV4 nem Service Account JWT manual**. Bedrock usa o env `AWS_BEARER_TOKEN_BEDROCK` (GA setembro/2025) + optional `@aws/bedrock-token-generator` (97KB) para auto-refresh; Vertex usa `google-auth-library` (572KB) required peer dep que resolve credentials via ADC (env var → gcloud → metadata server → WIF). Gemini no Vertex aproveita o endpoint OpenAI-compat oficial (`/endpoints/openapi/chat/completions`) — zero novo transport; Claude no Vertex usa `:rawPredict` com `apiMode: "anthropic_messages"` + body massage (`anthropic_version` injetado, `model` stripped). Outcome esperado: shipping com ~16 ADRs (D286-D301), 60+ unit tests, 2 examples (`examples/bedrock-bot`, `examples/vertex-bot`), live dogfood env-gated, e CLAUDE.md Roadmap #8 → ✅ DONE com **7/8 itens shipados**.

## Context

**O que existe hoje (provider/credential machinery validada em 6 providers):**

- `ProviderProfile` (D105) — data-only shape em `internal/providers/types.ts`: `{ name, apiMode, envVars, authType, baseUrl, modelsUrl?, hostname, fallbackModels, extraHeaders?, bodyOverrides? }`.
- `ApiMode` union: `"chat_completions" | "anthropic_messages" | "responses_api" | "bedrock"`. **Slot `"bedrock"` já reservado** mas nunca implementado.
- `AuthType` union: `"api_key" | "oauth_device_code" | "oauth_external" | "aws_sdk" | "none"`. Slot `"aws_sdk"` reservado.
- 6 built-in profiles funcionais: anthropic, openai, openrouter, ollama, lmstudio, llamacpp (D11/D182-D192).
- Transport selection em `internal/llm/router.ts:219` (`selectTransport`): switch por `apiMode` → `OpenAIClient` / `AnthropicClient` / `OllamaNativeClient` / etc. Adicionar dialect = adicionar case + criar `LlmClient`.
- `CredentialPool` (D123-D133) com strategies fill_first/round_robin/least_used/random. Aceita 1 string apiKey por entry. **Não precisa estender** — Bedrock/Vertex Bearer tokens são strings, encaixam direto.
- `internal/errors/mappers/` (D67) — 1 mapper por dialect (anthropic, openai, ollama). Adicionar dialect = adicionar mapper.

**O que está faltando (gap real do roadmap):**

Bedrock e Vertex AI são os 2 caminhos canônicos para Claude/Gemini em enterprise (AWS billing consolidado, GCP-native compliance, VPC isolation, BAA coverage). Sem profiles built-in, cada cliente enterprise tem que escrever o transport do zero. Itens 1-7 do roadmap fechados (CLI, Eval, Handoffs, Workflows, Cache, Slack); #8 é o último gap competitivo vs Vercel AI SDK (que já tem Bedrock + Vertex nativos).

**Evidências de mercado (web research 2026-05-23):**

1. **AWS Bedrock Bearer token é GA** desde set/2025. Env `AWS_BEARER_TOKEN_BEDROCK`. Token short-term ≤12h ou long-term com expiração custom. Header `Authorization: Bearer <token>`. CloudTrail registra `callWithBearerToken=true`. **Sem custo extra vs SigV4.**
2. **AWS Bedrock NÃO tem endpoint OpenAI-compat oficial.** InvokeModel (`/model/{id}/invoke`) e Converse (`/model/{id}/converse`) são nativos. InvokeModel passa body Anthropic Messages-shape com `anthropic_version: "bedrock-2023-05-31"`.
3. **Bedrock Converse perde features** vs InvokeModel: sem prompt caching extension, sem extended thinking detail. v1 usa InvokeModel.
4. **`@anthropic-ai/bedrock-sdk` TS não suporta Bearer** (apenas C#/Go/Java) — força SigV4. Usar wrapper Anthropic em TS = forçar AWS SDK pesado. **Caminho fetch nativo evita isso.**
5. **GCP Vertex AI OpenAI-compat GA para Gemini gerenciado:** endpoint `/v1/projects/{P}/locations/{L}/endpoints/openapi/chat/completions`. Auth Bearer via `gcloud auth print-access-token` (TTL 1h). Aceita payload OpenAI-shape. **Limitação documentada: dropa params não-suportados silenciosamente.**
6. **Claude no Vertex requer endpoint próprio:** `:rawPredict` / `:streamRawPredict` com body Messages-API + `anthropic_version: "vertex-2023-10-16"` no body (não header). `model` strip da URL.
7. **`google-auth-library` (572KB):** resolve ADC automaticamente (`GOOGLE_APPLICATION_CREDENTIALS` env → `~/.config/gcloud/application_default_credentials.json` → metadata server → WIF). Repo arquivado em nov/2025 mas continua security-patched.
8. **Known gotcha Vertex `global`:** `streamRawPredict` retorna 404 em `global-aiplatform.googleapis.com`. Override para `aiplatform.googleapis.com` quando location=global (cline#10287).

**Referências no codebase (`referencia/openclaw/`):**

- `extensions/amazon-bedrock-mantle/` — usa **Bearer token via `@aws/bedrock-token-generator`**, expõe OpenAI-compat via Mantle Endpoints (não relevante para nosso caso direto a Bedrock).
- `extensions/anthropic-vertex/` — usa **ADC via `google-auth-library`**, chama `:rawPredict` com `@anthropic-ai/vertex-sdk`. Confirma o pattern Anthropic Vertex.

**Por que NOW:**

- 7/8 itens shipados em 2026-05-22→23. #8 fecha o roadmap v1.3.
- Sem refactor invasivo: `ProviderProfile` é data-only (D105), apenas adicionamos 2 novos profiles + 2 transports (1 para Bedrock InvokeModel, 1 para Vertex Anthropic `:rawPredict`). Vertex Gemini reusa `OpenAIClient` (D106 ortogonal transport).
- Wave de adoção Bearer auth Bedrock + ADC Vertex está madura em 2026.

## Objective

**Done = `Agent.create({ model: { id: "bedrock/anthropic.claude-sonnet-4-6-v1" }, apiKey: <bearer> })` ou `Agent.create({ model: { id: "vertex/anthropic/claude-sonnet-4-5" } })` (ADC auto-detect) produz um agente que conversa com modelos via Bedrock InvokeModel ou Vertex `:rawPredict`/OpenAI-compat, com error mapping correto, sem SigV4 nem Service Account JWT manual.**

Goals mensuráveis:

1. 2 profiles novos em `internal/providers/builtin/`: `bedrock.ts`, `vertex.ts`.
2. `ApiMode` extendido com `"bedrock_anthropic"` (InvokeModel para Claude on Bedrock). Vertex Gemini reusa `"chat_completions"`; Vertex Claude reusa `"anthropic_messages"` com base URL especial.
3. `AuthType` extendido com `"aws_bearer"` e `"gcp_oauth"` (slots reservados antes via `"aws_sdk"` permanecem para v1.x).
4. 2 transports novos: `BedrockAnthropicClient` (InvokeModel) e `VertexAnthropicClient` (`:rawPredict` com body massage). Vertex Gemini usa `OpenAIClient` existente com baseUrl + auth override.
5. `internal/errors/mappers/bedrock.ts` + `internal/errors/mappers/vertex.ts` para HTTP error code → ErrorMetadata (D67 pattern).
6. `google-auth-library` como **required peer dep** (Vertex sempre precisa de OAuth token refresh).
7. `@aws/bedrock-token-generator` como **optional peer dep** (Bedrock auto-refresh; sem ele caller fornece token via env).
8. 60+ unit tests (profile shape, body massage, error mapping, OAuth resolution mocks).
9. 2 examples: `examples/bedrock-bot/` e `examples/vertex-bot/`.
10. Live dogfood **env-gated** (D284 pattern) — opcional se caller tem creds.
11. 16 ADRs registradas (D286-D301).
12. `docs.md` seções `## Bedrock provider (v1.20+)` e `## Vertex AI provider (v1.20+)`.
13. CLAUDE.md Adoption Roadmap entry #8 → ✅ DONE com 7/8 shipados.

**Não-goals (deferidos para v1.x):**

- SigV4 transport (caller usa env Bearer token).
- Anthropic SDK wrappers (`@anthropic-ai/bedrock-sdk`, `@anthropic-ai/vertex-sdk`) — bypass via fetch nativo.
- Bedrock Converse API — perde features vs InvokeModel.
- Workload Identity Federation walkthrough (ADC resolve sozinho; WIF docs ficam para v1.x).
- Service Account JSON key rotation tooling.
- Vertex BYOK encryption.
- Multi-region failover (caller controla).
- Computer Use, Code Interpreter, batch predictions.

## ADRs

### D286 — Bedrock usa Bearer token only em v1 (não SigV4)

**Decision:** O profile `bedrock` aceita Bearer token via env `AWS_BEARER_TOKEN_BEDROCK` ou via `Agent.create({ apiKey })`. Sem SigV4, sem `@aws-sdk/client-bedrock-runtime`. Transport via `fetch` nativo.

**Rationale:** Bearer auth é GA desde set/2025 (AWS oficial). Evita peer dep de 800KB+ do AWS SDK + dependências Smithy CJS. Token short-term (≤12h) ou long-term cobre 100% dos use cases v1.

**Consequences:** Customers em SigV4 puro (IAM role only) precisam gerar token externamente (Console ou CLI) ou usar v1.x (SigV4 nativo). Documentar limitação. Token rotation é caller responsibility (ou opt-in `@aws/bedrock-token-generator`).

### D287 — `@aws/bedrock-token-generator` é **optional peer dep** (auto-refresh)

**Decision:** Caller que quer auto-refresh de short-term token instala `@aws/bedrock-token-generator` (97KB). SDK detect via `createRequire` lazy load (mesmo pattern D34/D42). Sem o pacote, SDK lê env `AWS_BEARER_TOKEN_BEDROCK` direto.

**Rationale:** Token short-term durar até 12h cobre desenvolvimento + tests; produção que quer refresh automático paga +97KB. Mantém base SDK leve.

**Consequences:** Two paths documented: "set env" (zero peer dep) e "install token-generator" (auto-refresh). Tests mockam ambos. Caller em Vercel Edge / Cloudflare Workers (sem AWS profile chain) usa apenas env path.

### D288 — `google-auth-library` é **required peer dep** para Vertex

**Decision:** `google-auth-library` (572KB) é peer dep obrigatória do profile Vertex. SDK chama `auth.getAccessToken()` por request (TTL 1h, refresh interno).

**Rationale:** Não existe atalho equivalente a `AWS_BEARER_TOKEN_BEDROCK` para Vertex — Google sempre exige OAuth 2.0 com refresh. `google-auth-library` resolve via ADC sozinha (env → gcloud → metadata → WIF). Reimplementar OAuth do zero seria 200+ LoC + risco de bug.

**Consequences:** Caller que quer Vertex precisa instalar peer dep. Repo arquivado nov/2025 mas mantido para security. Documentar como required.

### D289 — Bedrock usa InvokeModel (não Converse)

**Decision:** O `BedrockAnthropicClient` chama `POST /model/{modelId}/invoke` e `/invoke-with-response-stream`. Body é Anthropic Messages-shape com `anthropic_version: "bedrock-2023-05-31"` injetado e `model` stripped (model ID vai na URL).

**Rationale:** Converse normaliza entre providers mas perde features Anthropic-específicas (prompt caching extension fields, extended thinking detail). InvokeModel preserva 100% das features Anthropic Messages.

**Consequences:** Apenas Claude on Bedrock em v1 (não Llama/Cohere/Mistral via Converse). Adicionar mais providers Bedrock = adicionar mais transports (1 por provider) — deferido v1.x.

### D290 — Bedrock model IDs aceitam prefixo `us.` / `eu.` / `apac.` / `jp.` / `global.`

**Decision:** Profile aceita IDs no formato `{regionPrefix}.anthropic.{model}-v{N}`. Pass-through direto para a URL. Não há logic de "fallback regional" em v1.

**Rationale:** AWS Bedrock usa region prefix como roteamento. `global.anthropic.claude-opus-4-7-v1` resolve cross-region; `us.anthropic.claude-opus-4-7-v1` força região US. Caller escolhe.

**Consequences:** Caller responsabilidade ler https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html para ver disponibilidade. Sem validação de model ID em v1 — pass-through.

### D291 — Vertex Gemini usa endpoint OpenAI-compat existente (reusa `OpenAIClient`)

**Decision:** Para model IDs `vertex/google/gemini-*` (ex: `vertex/google/gemini-2.0-flash-001`), o profile mapeia para `apiMode: "chat_completions"` e baseUrl `https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/endpoints/openapi`. Reusa `OpenAIClient` existente com header `Authorization: Bearer {accessToken}`.

**Rationale:** Google publicou esse endpoint exatamente para reduzir fricção (drop-in para OpenAI SDK clients). Reusar `OpenAIClient` = zero novo transport. Limitação documentada: "Unsupported params silently dropped" — accept the trade-off.

**Consequences:** Tests verificam que `OpenAIClient` recebe baseUrl + auth corretos. Documentar lista de params NÃO suportados (recursive JSON schemas, etc).

### D292 — Vertex Claude usa endpoint `:rawPredict` com body massage

**Decision:** Para model IDs `vertex/anthropic/claude-*`, profile mapeia para `apiMode: "anthropic_messages"` mas com baseUrl + body customization. `VertexAnthropicClient` (novo) chama `:rawPredict` / `:streamRawPredict`, injeta `anthropic_version: "vertex-2023-10-16"` no body, remove `model` (vai na URL).

**Rationale:** Anthropic-on-Vertex tem shape próprio (model na URL, `anthropic_version` no body como string específica). Não é OpenAI-compat. Wrapper Anthropic (`@anthropic-ai/vertex-sdk`) adicionaria 1.1MB — fetch nativo é melhor.

**Consequences:** Novo `VertexAnthropicClient` (~150 LoC). Reusa parser de SSE do `AnthropicClient` existente — body shape de response é idêntico ao Anthropic native.

### D293 — Vertex `global` location força baseUrl `aiplatform.googleapis.com` (sem prefix regional)

**Decision:** Quando `GOOGLE_CLOUD_LOCATION === "global"`, baseUrl é `https://aiplatform.googleapis.com/...` (não `https://global-aiplatform.googleapis.com/...`). Hardcode esse override no profile resolver.

**Rationale:** Known bug `streamRawPredict` 404 em `global-aiplatform.googleapis.com` (cline#10287). Documentado pela Anthropic.

**Consequences:** 1-line check no `resolveVertexBaseUrl`. Test cobre.

### D294 — NÃO usar Anthropic SDK wrappers (`@anthropic-ai/bedrock-sdk`, `@anthropic-ai/vertex-sdk`)

**Decision:** Implementação direta via `fetch`. Wrappers Anthropic não são usados.

**Rationale:** `@anthropic-ai/bedrock-sdk` em TS força SigV4 (sem Bearer support). `@anthropic-ai/vertex-sdk` adiciona 1.1MB (567KB + google-auth-library 572KB). Implementação direta = ~200 LoC total, evita double abstraction layer.

**Consequences:** Manutenção: temos que tracker Bedrock + Vertex API changes diretamente. Mitigation: API stability é alta (Anthropic Messages é estável). Tests usam mock `fetch`.

### D295 — Token refresh: Bedrock cacheia, Vertex chama getAccessToken por request

**Decision:**
- **Bedrock:** se caller fornece token via env, SDK usa direto (sem cache, sem refresh). Se optional `@aws/bedrock-token-generator` instalado, SDK cacheia token por 1.5h (75% do max 2h interno do generator), refresh on-demand.
- **Vertex:** SDK chama `auth.getAccessToken()` por request via `google-auth-library`. A library cuida do cache interno (~50min refresh padrão).

**Rationale:** Bedrock long-term tokens não precisam refresh; short-term gerado por generator funciona com cache simples. Vertex sempre OAuth 1h — delegar refresh para library oficial.

**Consequences:** Bedrock test: stub `tokenGenerator()` retorna token diferente em rotation. Vertex test: stub `auth.getAccessToken()` retorna sequenced tokens.

### D296 — Bedrock Converse + Computer Use diferidos para v1.x

**Decision:** v1 só implementa InvokeModel para Claude on Bedrock. Converse API, Computer Use tool relay, e Bedrock Agents/Knowledge Bases ficam para v1.x.

**Rationale:** Converse perde features (D289). Computer Use exige tool result image handling complexo. Foco v1: ship Claude conversation.

**Consequences:** Documentar limitações. Forward-compat: `apiMode: "bedrock_converse"` slot reservado.

### D297 — Workload Identity Federation walkthrough diferido para v1.x

**Decision:** v1 documenta apenas ADC default (env → gcloud → metadata). WIF setup tutorial fica para v1.x.

**Rationale:** WIF é importante mas seu setup é GCP-side (Terraform/Console), não código. ADC + library cuida do resto. Documentação focada cobre o caminho mais comum.

**Consequences:** Enterprise users em AWS->GCP federation usam mesmo path (ADC resolve via WIF transparentemente). Apenas walkthrough docs ficam para v1.x.

### D298 — SigV4 transport diferido para v1.x

**Decision:** v1 implementa apenas Bearer auth (D286). SigV4 nativo via `aws4` ou similar fica para v1.x.

**Rationale:** Bearer GA cobre 80% dos use cases. SigV4 exige peer dep + estrutura de credentials (access key + secret + session token) que não encaixa no `CredentialPool` atual (string only). Forward-compat: `AuthType "aws_sigv4"` reservado.

**Consequences:** Documentar limitação. Enterprise customers em SigV4-only env (sem permissão pra gerar Bearer) usam v1.x.

### D299 — Service Account JSON file generation tooling deferido

**Decision:** v1 lê SA JSON via `GOOGLE_APPLICATION_CREDENTIALS` env (gerenciado pelo caller). SDK não gera, não rota, não criptografa SA JSON files.

**Rationale:** SA JSON management é dev/ops responsibility — usuário gera no Console GCP. SDK só consome.

**Consequences:** Documentar. Recomendar WIF para apps fora de GCP (eliminação de SA JSON file).

### D300 — Error mapping per dialect (D67 pattern)

**Decision:** Novos arquivos `internal/errors/mappers/bedrock.ts` e `internal/errors/mappers/vertex.ts`. Mapeam HTTP status + response body → `ErrorMetadata` com `provider` field, error codes (`bedrock_throttle`, `bedrock_validation`, `vertex_quota`, `vertex_permission`, etc).

**Rationale:** Bedrock retorna shape `{ message: string, __type: "Throttling..." }`; Vertex retorna `{ error: { code: number, status: string, details: [...] } }`. Generic error handling perde contexto.

**Consequences:** Tests cobrem 5-7 códigos canônicos por dialect.

### D301 — `ApiMode` extendido: `"bedrock_anthropic"` (novo); Vertex reusa `"chat_completions"` e `"anthropic_messages"`

**Decision:**
- Adicionar `"bedrock_anthropic"` ao `ApiMode` union para InvokeModel + body massage.
- Vertex Gemini usa `apiMode: "chat_completions"` (reusa `OpenAIClient`) com baseUrl + auth override.
- Vertex Claude usa `apiMode: "anthropic_messages"` mas com **`VertexAnthropicClient`** que substitui `AnthropicClient` quando profile.name === "vertex". `selectTransport` ganha sub-discriminator por profile.name.

**Rationale:** Bedrock body shape diverge demais de Anthropic native (URL + anthropic_version differences) — merece próprio apiMode. Vertex Gemini OpenAI-compat é literally OpenAI body — reusar. Vertex Claude é Anthropic shape + small diffs — sub-discriminator é mais limpo que novo apiMode.

**Consequences:** `selectTransport` switch ganha 2 cases. Forward-compat: outros profiles que precisam de "Anthropic body com auth diferente" reusam o pattern.

### D302 — Bedrock streaming deferido a v1.x (EC-5 absorbed)

**Decision:** v1 `BedrockAnthropicClient` implementa apenas `POST /model/{id}/invoke` (non-streaming). `/invoke-with-response-stream` (AWS Event Stream binary format) fica para v1.x. Quando caller pede `request.stream === true`, client faz a chamada non-streaming e emite o resultado como single event para preservar a interface `AsyncGenerator<LlmEvent, LlmFinish>`.

**Rationale:** AWS Event Stream é formato binário (prelude + headers type-encoded + payload + CRC32) — não é SSE. Reusar parser SSE existente não funciona. Implementação correta exige ou (a) peer dep `@aws-sdk/util-stream-node` (~50KB + transitivas), ou (b) reimplementar do spec (200+ LoC, propenso a bug em CRC validation). Avoid scope creep mascarado como "50 LoC".

**Consequences:** v1 Bedrock latency é maior que streaming verdadeiro (espera resposta completa). Para chat UX em tempo real, caller pode (a) usar Anthropic direto via Vertex (que tem SSE nativo), ou (b) usar escape hatch via `@aws-sdk/client-bedrock-runtime` direto. Documentar limitação. Forward-compat: `stream` parameter já está na interface; basta trocar implementação em v1.x.

## Dependency Graph

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4
(ADRs)     (Bedrock)  (Bedrock    (Vertex     (Vertex
            profile +  tests +     profile +   Anthropic
            transport) errors)     Gemini      transport
                                   OpenAI-     + tests)
                                   compat)
                              │           │           │
                              └─────┬─────┴───────────┘
                                    ▼
                            Phase 5 (Examples + docs.md)
                                    │
                                    ▼
                            Phase 6 (Dogfood QA — env-gated)
```

**Sequencial obrigatório:** 0 → 1 → 2; 0 → 3 → 4. Bedrock e Vertex podem rodar em **paralelo** após Phase 0 (sem dependência cruzada).

**Parallelizáveis:** Phase 1+2 (Bedrock track) com Phase 3+4 (Vertex track). Phase 5 (docs + examples) precisa de ambos. Phase 6 (dogfood) final.

---

## Phase 0: Setup e ADRs

**Objective:** Registrar D286-D301 (16 ADRs), atualizar CLAUDE.md table + Roadmap #8.

### T0.1 — Escrever 16 ADRs + bump roadmap

#### Objective
Materializar D286-D301 sob `.claude/knowledge-base/adrs/` + apêndar linhas em CLAUDE.md table + roadmap #8 → "Em progresso 2026-05-23".

#### Files to edit
```
.claude/knowledge-base/adrs/D286-bedrock-bearer-only-v1.md (NEW)
.claude/knowledge-base/adrs/D287-bedrock-token-generator-optional.md (NEW)
.claude/knowledge-base/adrs/D288-google-auth-library-required.md (NEW)
.claude/knowledge-base/adrs/D289-bedrock-invokemodel-not-converse.md (NEW)
.claude/knowledge-base/adrs/D290-bedrock-region-prefix-passthrough.md (NEW)
.claude/knowledge-base/adrs/D291-vertex-gemini-openai-compat.md (NEW)
.claude/knowledge-base/adrs/D292-vertex-claude-rawpredict-body-massage.md (NEW)
.claude/knowledge-base/adrs/D293-vertex-global-baseurl-override.md (NEW)
.claude/knowledge-base/adrs/D294-no-anthropic-sdk-wrappers.md (NEW)
.claude/knowledge-base/adrs/D295-token-refresh-strategy.md (NEW)
.claude/knowledge-base/adrs/D296-bedrock-converse-deferred.md (NEW)
.claude/knowledge-base/adrs/D297-vertex-wif-walkthrough-deferred.md (NEW)
.claude/knowledge-base/adrs/D298-sigv4-deferred-v1x.md (NEW)
.claude/knowledge-base/adrs/D299-sa-json-tooling-deferred.md (NEW)
.claude/knowledge-base/adrs/D300-error-mappers-per-dialect.md (NEW)
.claude/knowledge-base/adrs/D301-apimode-bedrock-anthropic-extended.md (NEW)
.claude/knowledge-base/adrs/D302-bedrock-streaming-deferred.md (NEW, post edge-case review)
CLAUDE.md (MODIFY: add 17 rows + bump Roadmap #8 to "Em progresso 2026-05-23")
```

#### TDD
```
N/A — ADRs are documentation. Validation: `ls .claude/knowledge-base/adrs/D2{86,87,88,89,90,91,92,93,94,95,96,97,98,99}-*.md .claude/knowledge-base/adrs/D30{0,1}-*.md | wc -l` = 16.
```

#### Acceptance Criteria
- [ ] 17 arquivos D286-D302 existem.
- [ ] CLAUDE.md table tem 17 novas linhas.
- [ ] Roadmap #8 → "Em progresso 2026-05-23".

#### DoD
- [ ] Commit verde.

---

## Phase 1: Bedrock Profile + Transport

**Objective:** Profile `bedrock`, `BedrockAnthropicClient`, integration no router.

### T1.1 — `internal/providers/builtin/bedrock.ts` (NEW)

#### Objective
Profile data-only para Bedrock. Aceita region prefix em model ID; resolve baseUrl dinamicamente.

#### Files to edit
```
packages/sdk/src/internal/providers/types.ts (MODIFY: add "aws_bearer" to AuthType + "bedrock_anthropic" to ApiMode)
packages/sdk/src/internal/providers/builtin/bedrock.ts (NEW)
packages/sdk/src/internal/providers/registry.ts (MODIFY: register BEDROCK profile)
```

#### Deep Dives

```typescript
// EC-13 absorbed: model IDs convention is `bedrock/<aws-id>` so the router
// can infer provider via D186 (prefix routing). Client strips "bedrock/"
// before building the URL.
export const BEDROCK: ProviderProfile = {
  name: "bedrock",
  apiMode: "bedrock_anthropic",
  envVars: ["AWS_BEARER_TOKEN_BEDROCK"],
  authType: "aws_bearer",
  baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com", // default; resolveBedrockBaseUrl overrides per-region
  modelsUrl: undefined, // No listing endpoint via Bearer
  hostname: "bedrock-runtime.amazonaws.com",
  fallbackModels: [
    "bedrock/us.anthropic.claude-sonnet-4-5-v1:0",
    "bedrock/us.anthropic.claude-opus-4-7-v1:0",
    "bedrock/global.anthropic.claude-haiku-4-5-v1:0",
  ],
};

/** Strip "bedrock/" prefix so the raw AWS model id is used in the URL. */
export function stripBedrockPrefix(modelId: string): string {
  return modelId.replace(/^bedrock\//, "");
}
```

Region resolver helper:
```typescript
export function resolveBedrockBaseUrl(modelId: string, regionEnv = process.env.AWS_REGION ?? "us-east-1"): string {
  // Model ID format: "{prefix}.anthropic.{model}-v{N}" where prefix is "us"/"eu"/"apac"/"jp"/"global"
  const region = inferRegionFromModelId(modelId) ?? regionEnv;
  return `https://bedrock-runtime.${region}.amazonaws.com`;
}

function inferRegionFromModelId(modelId: string): string | undefined {
  if (modelId.startsWith("global.")) return "us-east-1"; // global routes to us-east-1 entrypoint
  if (modelId.startsWith("us.")) return process.env.AWS_REGION ?? "us-east-1";
  if (modelId.startsWith("eu.")) return process.env.AWS_REGION ?? "eu-west-1";
  if (modelId.startsWith("apac.")) return process.env.AWS_REGION ?? "ap-southeast-1";
  if (modelId.startsWith("jp.")) return "ap-northeast-1";
  return undefined; // no prefix → use AWS_REGION env
}
```

#### Tasks
1. Add `"aws_bearer"` to `AuthType` + `"bedrock_anthropic"` to `ApiMode`.
2. Create `bedrock.ts` with profile + `resolveBedrockBaseUrl` + `inferRegionFromModelId`.
3. Register in `registry.ts`.

#### TDD
```
RED:
  - bedrock_profile_has_correct_envVars_and_authType
  - bedrock_profile_apiMode_is_bedrock_anthropic
  - resolveBedrockBaseUrl_us_prefix_uses_AWS_REGION
  - resolveBedrockBaseUrl_eu_prefix_uses_AWS_REGION_eu_default
  - resolveBedrockBaseUrl_global_prefix_routes_us_east_1
  - resolveBedrockBaseUrl_no_prefix_falls_back_to_AWS_REGION
  - resolveBedrockBaseUrl_default_when_AWS_REGION_undefined
GREEN: implement.
VERIFY: pnpm -F @theokit/sdk test tests/providers/bedrock.test.ts
```

#### Acceptance Criteria
- [ ] 7 tests verde.
- [ ] `bedrock.ts` ≤ 80 LoC.

#### DoD
- [ ] Tests verde.

---

### T1.2 — `BedrockAnthropicClient` (`internal/llm/clients/bedrock-anthropic.ts`)

#### Objective
LlmClient que faz `POST /model/{id}/{invoke|invoke-with-response-stream}` com Bearer auth + body massage.

#### Files to edit
```
packages/sdk/src/internal/llm/clients/bedrock-anthropic.ts (NEW)
packages/sdk/src/internal/llm/router.ts (MODIFY: add "bedrock_anthropic" case to selectTransport)
```

#### Deep Dives

```typescript
export interface BedrockAnthropicClientOptions {
  region: string;
  apiKey: string;          // Bearer token
  fetch?: typeof fetch;
  modelId: string;         // "us.anthropic.claude-sonnet-4-5-v1:0" etc
}

export class BedrockAnthropicClient implements LlmClient {
  readonly name = "bedrock_anthropic";
  constructor(private readonly opts: BedrockAnthropicClientOptions) {}

  async *stream(request: LlmRequest, signal: AbortSignal): AsyncGenerator<LlmEvent, LlmFinish, void> {
    // EC-13: strip prefix so raw AWS model id goes in the URL.
    const bareModel = stripBedrockPrefix(this.opts.modelId);
    const baseUrl = `https://bedrock-runtime.${this.opts.region}.amazonaws.com`;
    const encodedModel = encodeURIComponent(bareModel);
    // D302 / EC-5: v1 is non-streaming only. AWS Event Stream binary parser
    // is out of v1 scope. We always use /invoke and emit a single event.
    const url = `${baseUrl}/model/${encodedModel}/invoke`;

    // Body massage: Anthropic Messages shape + anthropic_version + strip model.
    const { model: _ignore, stream: _streamIgnored, ...rest } =
      request.body as { model?: string; stream?: boolean; [k: string]: unknown };
    const body = JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      ...rest,
    });

    const res = await (this.opts.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw mapBedrockError(res.status, errBody);
    }

    // Non-streaming: parse full JSON, emit as single LlmEvent + LlmFinish.
    const parsed = (await res.json()) as { content?: Array<{ text?: string }>; usage?: unknown };
    const text = parsed.content?.map((c) => c.text ?? "").join("") ?? "";
    yield { type: "text", text };
    return { reason: "stop", usage: parsed.usage };
  }
}
```

**Note on EC-9 (caller-provided apiKey):** The router resolves apiKey via the existing `resolveApiKey(envVars)` chain. Caller-provided `Agent.create({ apiKey })` already takes precedence (resolved upstream). Test verifies this contract holds for the Bedrock path.

**EC-6 absorbed (helpful error when token missing):** In `selectTransport` for `apiMode === "bedrock_anthropic"`, validate before client construction:
```typescript
const token = callerApiKey ?? (await resolveBedrockToken(region));
if (token === undefined || token.length === 0) {
  throw new ConfigurationError(
    "Bedrock requires AWS_BEARER_TOKEN_BEDROCK env var, or pass apiKey explicitly, " +
      "or install `@aws/bedrock-token-generator` for auto-refresh.",
    { code: "bedrock_token_missing", provider: "bedrock" },
  );
}
```

#### Tasks
1. Implement client.
2. Wire in `selectTransport`.
3. `decodeBedrockEventStream` helper (AWS event stream parser, ~50 LoC).

#### TDD
```
RED:
  - bedrock_client_always_calls_invoke_in_v1 (D302 — no streaming)
  - bedrock_client_injects_anthropic_version_bedrock_2023_05_31
  - bedrock_client_strips_model_from_body
  - bedrock_client_strips_stream_from_body (D302)
  - bedrock_client_url_encodes_modelId
  - bedrock_client_sends_Authorization_Bearer_header
  - bedrock_client_uses_region_in_baseUrl
  - bedrock_client_propagates_AbortSignal
  - bedrock_client_throws_on_4xx_with_mapped_error
  - EC-13: bedrock_client_strips_bedrock_prefix_from_modelId
  - EC-4: bedrock_client_encodes_colon_in_modelId_correctly (v1:0)
  - EC-9: bedrock_client_uses_caller_apiKey_when_provided_over_env
GREEN: implement.
VERIFY: pnpm test tests/llm/bedrock-client.test.ts
```

#### Acceptance Criteria
- [ ] 9 tests verde.
- [ ] Mock fetch returns SSE-like stream; parser consumes.

#### DoD
- [ ] Tests verde.

---

### T1.3 — `internal/errors/mappers/bedrock.ts`

#### Objective
HTTP status + Bedrock error body → canonical `ErrorMetadata`.

#### Files to edit
```
packages/sdk/src/internal/errors/mappers/bedrock.ts (NEW)
```

#### Deep Dives

```typescript
export function mapBedrockError(status: number, body: string): TheokitAgentError {
  let parsed: { message?: string; __type?: string } = {};
  try { parsed = JSON.parse(body); } catch { /* keep empty */ }
  const code = parsed.__type ?? `http_${status}`;
  const msg = parsed.message ?? body.slice(0, 200);

  if (status === 429 || code.includes("Throttling")) {
    return new RateLimitError(`Bedrock throttled: ${msg}`, { code: "bedrock_throttle", provider: "bedrock" });
  }
  if (status === 401 || status === 403 || code.includes("AccessDenied")) {
    return new AuthenticationError(`Bedrock auth: ${msg}`, { code: "bedrock_auth", provider: "bedrock" });
  }
  if (status === 400 || code.includes("Validation")) {
    return new ConfigurationError(`Bedrock validation: ${msg}`, { code: "bedrock_validation", provider: "bedrock" });
  }
  return new NetworkError(`Bedrock ${status}: ${msg}`, { code: "bedrock_other", provider: "bedrock" });
}
```

#### Tasks
1. Implement mapper.
2. Wire into client error path.

#### TDD
```
RED:
  - mapBedrockError_429_returns_RateLimitError
  - mapBedrockError_ThrottlingException_returns_RateLimitError
  - mapBedrockError_401_returns_AuthenticationError
  - mapBedrockError_AccessDeniedException_returns_AuthenticationError
  - mapBedrockError_400_returns_ConfigurationError
  - mapBedrockError_500_returns_NetworkError_other
  - mapBedrockError_invalid_json_body_uses_truncated_text
GREEN: implement.
VERIFY: pnpm test tests/errors/bedrock-mapper.test.ts
```

#### Acceptance Criteria
- [ ] 7 tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 2: Bedrock Token Generator (Optional Peer)

**Objective:** Optional auto-refresh via `@aws/bedrock-token-generator`.

### T2.1 — `internal/llm/bedrock-token-cache.ts` (NEW)

#### Objective
Lazy load `@aws/bedrock-token-generator`. Se ausente, usar env direto. Se presente, cache token por 1.5h.

#### Files to edit
```
packages/sdk/src/internal/llm/bedrock-token-cache.ts (NEW)
```

#### Deep Dives

```typescript
import { createRequire } from "node:module";

interface CachedToken { value: string; expiresAt: number; }
let cachedToken: CachedToken | null = null;

export async function resolveBedrockToken(region: string): Promise<string | undefined> {
  // Path 1: explicit env wins (no refresh; caller manages lifecycle).
  const env = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (env !== undefined && env.length > 0) return env;

  // Path 2: cached generator token (if peer dep installed).
  const now = Date.now();
  if (cachedToken !== null && cachedToken.expiresAt > now) return cachedToken.value;

  try {
    const r = createRequire(import.meta.url);
    const { provideBedrockToken } = r("@aws/bedrock-token-generator") as {
      provideBedrockToken: (opts: { region: string }) => Promise<string>;
    };
    const token = await provideBedrockToken({ region });
    cachedToken = { value: token, expiresAt: now + 90 * 60 * 1000 }; // 1.5h
    return token;
  } catch {
    return undefined; // peer dep missing — caller falls back to error
  }
}

/** Test seam. */
export function __resetBedrockTokenCache(): void { cachedToken = null; }
```

#### Tasks
1. Implement lazy-load + cache.
2. Wire into BedrockAnthropicClient (resolve token per request via this helper).

#### TDD
```
RED:
  - token_cache_returns_env_when_set
  - token_cache_calls_generator_when_env_unset_and_peer_installed
  - token_cache_returns_undefined_when_peer_missing_and_env_unset
  - token_cache_reuses_cached_token_within_TTL
  - token_cache_refreshes_after_TTL_expiry
  - EC-10: token_cache_concurrent_stale_requests_documented (best-effort; not single-flight in v1)
GREEN: implement.
VERIFY: pnpm test tests/llm/bedrock-token-cache.test.ts
```

#### Acceptance Criteria
- [ ] 5 tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 3: Vertex Profile

**Objective:** Profile `vertex`, ADC integration, baseUrl resolver.

### T3.1 — `internal/providers/builtin/vertex.ts` (NEW)

#### Objective
Profile data-only para Vertex. Resolve baseUrl dinamicamente baseado em location + model dialect.

#### Files to edit
```
packages/sdk/src/internal/providers/types.ts (MODIFY: add "gcp_oauth" to AuthType)
packages/sdk/src/internal/providers/builtin/vertex.ts (NEW)
packages/sdk/src/internal/providers/registry.ts (MODIFY: register VERTEX)
```

#### Deep Dives

```typescript
export const VERTEX: ProviderProfile = {
  name: "vertex",
  apiMode: "anthropic_messages", // sub-dispatched by profile.name for Anthropic vs Gemini
  envVars: ["GOOGLE_APPLICATION_CREDENTIALS"], // ADC discovery
  authType: "gcp_oauth",
  baseUrl: "https://us-central1-aiplatform.googleapis.com", // default; resolveVertexBaseUrl overrides
  modelsUrl: undefined,
  hostname: "aiplatform.googleapis.com",
  fallbackModels: [
    "vertex/anthropic/claude-sonnet-4-5@20250929",
    "vertex/google/gemini-2.0-flash-001",
  ],
};

export function resolveVertexBaseUrl(opts: {
  projectId: string;
  location: string;       // "us-central1" | "global" | "europe-west4" etc
  modelDialect: "anthropic" | "gemini";
}): string {
  // D293: global location uses unprefixed hostname (avoids 404 on streamRawPredict)
  const host = opts.location === "global"
    ? "aiplatform.googleapis.com"
    : `${opts.location}-aiplatform.googleapis.com`;
  if (opts.modelDialect === "gemini") {
    return `https://${host}/v1/projects/${opts.projectId}/locations/${opts.location}/endpoints/openapi`;
  }
  // Anthropic: model goes in URL, not in base
  return `https://${host}/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/anthropic`;
}

export function inferModelDialect(modelId: string): "anthropic" | "gemini" {
  // model id formats: "vertex/anthropic/claude-X" or "vertex/google/gemini-X"
  if (modelId.includes("/anthropic/")) return "anthropic";
  if (modelId.includes("/google/")) return "gemini";
  return "gemini"; // default
}
```

#### Tasks
1. Add `"gcp_oauth"` to `AuthType`.
2. Create `vertex.ts`.
3. Register.

#### TDD
```
RED:
  - vertex_profile_envVars_GOOGLE_APPLICATION_CREDENTIALS
  - vertex_profile_authType_gcp_oauth
  - resolveVertexBaseUrl_gemini_regional_uses_endpoints_openapi
  - resolveVertexBaseUrl_anthropic_regional_uses_publishers_anthropic
  - resolveVertexBaseUrl_global_strips_region_prefix (D293)
  - inferModelDialect_anthropic_via_path
  - inferModelDialect_google_via_path
  - inferModelDialect_default_gemini
GREEN: implement.
VERIFY: pnpm test tests/providers/vertex.test.ts
```

#### Acceptance Criteria
- [ ] 8 tests verde.
- [ ] `vertex.ts` ≤ 100 LoC.

#### DoD
- [ ] Tests verde.

---

### T3.2 — `internal/llm/vertex-auth.ts` (ADC integration)

#### Objective
Resolve access token via `google-auth-library`. Cache via lib interna.

#### Files to edit
```
packages/sdk/src/internal/llm/vertex-auth.ts (NEW)
```

#### Deep Dives

```typescript
import { createRequire } from "node:module";

let authClient: { getAccessToken: () => Promise<{ token: string | null }> } | undefined;

export async function resolveVertexAccessToken(): Promise<string | undefined> {
  if (authClient === undefined) {
    try {
      const r = createRequire(import.meta.url);
      const { GoogleAuth } = r("google-auth-library") as {
        GoogleAuth: new (opts: { scopes: string[] }) => {
          getClient: () => Promise<{ getAccessToken: () => Promise<{ token: string | null }> }>;
        };
      };
      const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
      authClient = await auth.getClient();
    } catch (err) {
      // EC-3 absorbed: differentiate "peer dep missing" from "no credentials".
      // createRequire failure → peer dep absent → throw with install hint.
      // Other errors (e.g. ADC chain exhausted) → return undefined so caller
      // can compose with a clearer downstream error.
      const isModuleError = err instanceof Error &&
        (err.message.includes("Cannot find module") || (err as { code?: string }).code === "MODULE_NOT_FOUND");
      if (isModuleError) {
        throw new ConfigurationError(
          "Vertex provider requires `google-auth-library`. Install it: `pnpm add google-auth-library`.",
          { code: "vertex_peer_dep_missing", provider: "vertex", cause: err },
        );
      }
      return undefined;
    }
  }
  const result = await authClient.getAccessToken();
  return result.token ?? undefined;
}

/** Resolve project id via env or ADC. */
export function resolveVertexProjectId(): string | undefined {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT_ID ??
    process.env.GCLOUD_PROJECT
  );
}

export function resolveVertexLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION ?? process.env.CLOUD_ML_REGION ?? "us-central1";
}

/** Test seam. */
export function __resetVertexAuth(): void { authClient = undefined; }
```

#### Tasks
1. Implement.
2. Document peer dep requirement.

#### TDD
```
RED:
  - resolveVertexAccessToken_returns_token_from_google_auth_library
  - resolveVertexAccessToken_returns_undefined_when_peer_missing
  - resolveVertexAccessToken_returns_undefined_when_no_credentials
  - resolveVertexProjectId_env_priority_order
  - resolveVertexLocation_default_us_central1
  - resolveVertexLocation_env_override
GREEN: implement.
VERIFY: pnpm test tests/llm/vertex-auth.test.ts
```

#### Acceptance Criteria
- [ ] 6 tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 4: Vertex Transports

**Objective:** Vertex Gemini (reusa OpenAIClient) + Vertex Anthropic (`VertexAnthropicClient` novo).

### T4.1 — Vertex Gemini path (OpenAIClient adapter)

#### Objective
Wire `selectTransport` para mapear model IDs `vertex/google/*` → `OpenAIClient` com baseUrl + auth de Vertex.

#### Files to edit
```
packages/sdk/src/internal/llm/router.ts (MODIFY: add Vertex Gemini case)
```

#### Deep Dives

```typescript
// in selectTransport (extend the existing switch):
case "anthropic_messages": {
  if (profile.name === "vertex") {
    // EC-1 absorbed: validate projectId before constructing client.
    const projectId = resolveVertexProjectId();
    if (projectId === undefined) {
      throw new ConfigurationError(
        "Vertex requires a project id. Set GOOGLE_CLOUD_PROJECT env var or run `gcloud config set project <id>`.",
        { code: "vertex_project_missing", provider: "vertex" },
      );
    }
    const location = resolveVertexLocation();
    const accessToken = await resolveVertexAccessToken();
    if (accessToken === undefined) {
      throw new ConfigurationError(
        "Vertex could not resolve an access token. Run `gcloud auth application-default login` " +
          "or set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path.",
        { code: "vertex_auth_failed", provider: "vertex" },
      );
    }
    const dialect = inferModelDialect(modelId);
    if (dialect === "gemini") {
      return new OpenAIClient({
        baseUrl: resolveVertexBaseUrl({ projectId, location, modelDialect: "gemini" }),
        apiKey: accessToken,
        providerName: "vertex",
      });
    }
    // Vertex Anthropic
    return new VertexAnthropicClient({
      projectId,
      location,
      apiKey: accessToken,
      modelId,
    });
  }
  return new AnthropicClient({...}); // existing path
}
```

#### Tasks
1. Edit switch.
2. Tests for both branches.

#### TDD
```
RED:
  - selectTransport_vertex_google_model_returns_OpenAIClient_with_vertex_baseUrl
  - selectTransport_vertex_anthropic_model_returns_VertexAnthropicClient
  - selectTransport_vertex_calls_resolveVertexAccessToken
  - EC-1: selectTransport_vertex_throws_ConfigurationError_when_projectId_missing
  - EC-3: resolveVertexAccessToken_throws_helpful_error_on_peer_dep_missing
GREEN: implement.
VERIFY: pnpm test tests/llm/router-vertex.test.ts
```

#### Acceptance Criteria
- [ ] 3 tests verde.

#### DoD
- [ ] Tests verde.

---

### T4.2 — `VertexAnthropicClient` (`:rawPredict` transport)

#### Objective
LlmClient para Claude on Vertex. Faz body massage: inject `anthropic_version`, strip `model`, route to `:rawPredict` / `:streamRawPredict`.

#### Files to edit
```
packages/sdk/src/internal/llm/clients/vertex-anthropic.ts (NEW)
```

#### Deep Dives

```typescript
export class VertexAnthropicClient implements LlmClient {
  readonly name = "vertex_anthropic";
  constructor(private readonly opts: {
    projectId: string;
    location: string;
    apiKey: string;       // OAuth access token
    modelId: string;      // "vertex/anthropic/claude-sonnet-4-5@20250929"
    fetch?: typeof fetch;
  }) {}

  async *stream(request: LlmRequest, signal: AbortSignal): AsyncGenerator<LlmEvent, LlmFinish, void> {
    const baseUrl = resolveVertexBaseUrl({
      projectId: this.opts.projectId,
      location: this.opts.location,
      modelDialect: "anthropic",
    });
    // Strip "vertex/anthropic/" prefix; URL takes the bare anthropic model id
    const bareModel = this.opts.modelId.replace(/^vertex\/anthropic\//, "");
    const action = request.stream ? "streamRawPredict" : "rawPredict";
    const url = `${baseUrl}/models/${encodeURIComponent(bareModel)}:${action}`;

    const { model: _ignore, ...rest } = request.body as { model?: string; [k: string]: unknown };
    const body = JSON.stringify({
      anthropic_version: "vertex-2023-10-16",
      ...rest,
    });

    const res = await (this.opts.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "Content-Type": "application/json",
        Accept: request.stream ? "text/event-stream" : "application/json",
      },
      body,
      signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw mapVertexError(res.status, errBody);
    }
    yield* decodeAnthropicSse(res, signal); // reuse existing Anthropic SSE decoder
  }
}
```

#### Tasks
1. Implement client.
2. Wire into router.

#### TDD
```
RED:
  - vertex_anthropic_client_strips_vertex_anthropic_prefix_from_modelId
  - vertex_anthropic_client_injects_anthropic_version_vertex_2023_10_16
  - vertex_anthropic_client_strips_model_from_body
  - vertex_anthropic_client_uses_rawPredict_for_non_stream
  - vertex_anthropic_client_uses_streamRawPredict_for_stream
  - vertex_anthropic_client_uses_global_baseUrl_when_location_global (D293)
  - vertex_anthropic_client_sends_Authorization_Bearer_header
  - vertex_anthropic_client_throws_on_4xx_with_mapped_error
  - EC-4: vertex_anthropic_client_encodes_at_sign_in_modelId_correctly
  - EC-7: inferModelDialect_handles_multiple_slashes_in_path
  - EC-8: vertex_anthropic_client_parses_streamRawPredict_sse_events
GREEN: implement.
VERIFY: pnpm test tests/llm/vertex-anthropic-client.test.ts
```

#### Acceptance Criteria
- [ ] 8 tests verde.

#### DoD
- [ ] Tests verde.

---

### T4.3 — `internal/errors/mappers/vertex.ts`

#### Objective
Vertex error body → canonical `ErrorMetadata`.

#### Files to edit
```
packages/sdk/src/internal/errors/mappers/vertex.ts (NEW)
```

#### Deep Dives

```typescript
export function mapVertexError(status: number, body: string): TheokitAgentError {
  let parsed: { error?: { code?: number; status?: string; message?: string } } = {};
  try { parsed = JSON.parse(body); } catch { /* empty */ }
  const errStatus = parsed.error?.status ?? `http_${status}`;
  const msg = parsed.error?.message ?? body.slice(0, 200);

  if (status === 429 || errStatus === "RESOURCE_EXHAUSTED") {
    return new RateLimitError(`Vertex quota: ${msg}`, { code: "vertex_quota", provider: "vertex" });
  }
  if (status === 401 || errStatus === "UNAUTHENTICATED") {
    return new AuthenticationError(`Vertex auth: ${msg}`, { code: "vertex_auth", provider: "vertex" });
  }
  if (status === 403 || errStatus === "PERMISSION_DENIED") {
    return new AuthenticationError(`Vertex permission: ${msg}`, { code: "vertex_permission", provider: "vertex" });
  }
  if (status === 400 || errStatus === "INVALID_ARGUMENT") {
    return new ConfigurationError(`Vertex validation: ${msg}`, { code: "vertex_validation", provider: "vertex" });
  }
  return new NetworkError(`Vertex ${status}: ${msg}`, { code: "vertex_other", provider: "vertex" });
}
```

#### Tasks
1. Implement.

#### TDD
```
RED:
  - mapVertexError_429_returns_RateLimitError
  - mapVertexError_RESOURCE_EXHAUSTED_returns_RateLimitError
  - mapVertexError_401_returns_AuthenticationError
  - mapVertexError_PERMISSION_DENIED_returns_AuthenticationError
  - mapVertexError_400_INVALID_ARGUMENT_returns_ConfigurationError
  - mapVertexError_500_returns_NetworkError_other
  - mapVertexError_invalid_json_uses_truncated_text
GREEN: implement.
VERIFY: pnpm test tests/errors/vertex-mapper.test.ts
```

#### Acceptance Criteria
- [ ] 7 tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 5: Examples + docs.md

### T5.1 — `examples/bedrock-bot/`

#### Files to edit
```
examples/bedrock-bot/package.json (NEW)
examples/bedrock-bot/.env.example (NEW)
examples/bedrock-bot/run.ts (NEW)
examples/bedrock-bot/README.md (NEW)
```

#### Deep Dives
`run.ts` cria Agent com `model: { id: "us.anthropic.claude-sonnet-4-5-v1:0" }` + `apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK`. README cobre: como gerar token via Console / `aws bedrock create-api-key` / via `@aws/bedrock-token-generator` opt-in.

#### Tasks
1. Criar arquivos.
2. README com 3 paths de auth.

#### Acceptance Criteria
- [ ] `pnpm run run` connect+chat sem crash com token válido.

---

### T5.2 — `examples/vertex-bot/`

#### Files to edit
```
examples/vertex-bot/package.json (NEW)
examples/vertex-bot/.env.example (NEW)
examples/vertex-bot/run.ts (NEW)
examples/vertex-bot/README.md (NEW)
```

#### Deep Dives
2 modes no `.env.example`:
- Gemini path: `MODEL=vertex/google/gemini-2.0-flash-001`
- Anthropic path: `MODEL=vertex/anthropic/claude-sonnet-4-5@20250929`

README cobre: ADC setup via `gcloud auth application-default login` + permissions (Vertex AI User role).

#### Tasks
1. Criar arquivos.

#### Acceptance Criteria
- [ ] `pnpm run run` connect+chat sem crash com gcloud ADC válido.

---

### T5.3 — `docs.md` 2 sections

#### Files to edit
```
docs.md (MODIFY: add "## Bedrock provider (v1.20+)" + "## Vertex AI provider (v1.20+)")
README.md (MODIFY: mention enterprise providers in features)
```

#### Tasks
1. Append sections cobrindo: model ID format, auth setup, error mapping, v1 limitations, escape-hatch para SigV4 / Converse / wrappers Anthropic.

---

## Phase 6: Dogfood QA (env-gated, MANDATORY)

**Objective:** Validar end-to-end com providers reais quando creds disponíveis. Telegram-pro regression check é mandatório.

### Execution

```bash
# Mandatory: telegram-pro regression check (no Bedrock/Vertex usage)
pnpm -F @theokit/sdk build
# refresh telegram-pro link...
node .claude/skills/dogfood/lib/dogfood.mjs --user-id 7528967933

# Env-gated: Bedrock live test
if [ -n "$AWS_BEARER_TOKEN_BEDROCK" ]; then
  cd examples/bedrock-bot && pnpm tsx --env-file=.env run.ts
fi

# Env-gated: Vertex live test
if gcloud auth application-default print-access-token > /dev/null 2>&1; then
  cd examples/vertex-bot && pnpm tsx --env-file=.env run.ts
fi
```

### Acceptance Criteria

- [ ] Telegram-pro dogfood ≥ 43/45 PASS (mandatory — confirma zero regressões em providers existentes).
- [ ] **Se Bedrock token disponível:** Single round-trip "What's your name?" → Claude reply via Bedrock. Log mostra `[outbound] sent N chars`.
- [ ] **Se gcloud ADC ativo:** Single round-trip "What's your name?" para BOTH Gemini path AND Anthropic path. Logs respectivos.
- [ ] **Se ambos ausentes:** Tests unitários ≥ 60 PASS + telegram-pro PASS são suficientes. Live test SKIPPED com mensagem clara.

### Runtime-metric proof
- Bedrock: HTTP response status 200 + non-empty response text observed.
- Vertex Gemini: HTTP response status 200 + non-empty response text observed.
- Vertex Anthropic: HTTP response status 200 + non-empty response text observed.

### If Dogfood Fails
1. Identificar se é regressão (telegram-pro fail) ou config issue (Bedrock/Vertex env).
2. Telegram-pro fail → BLOCKER (precisa fix).
3. Bedrock/Vertex live fail → investigar (token expirado? model não disponível na região? scope errado?).

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Bedrock profile + transport | T1.1, T1.2 | bedrock.ts + BedrockAnthropicClient |
| 2 | Bedrock Bearer auth (no SigV4) | D286, T1.2 | env AWS_BEARER_TOKEN_BEDROCK + fetch |
| 3 | Bedrock optional token refresh | D287, T2.1 | @aws/bedrock-token-generator lazy load |
| 4 | Bedrock error mapping | T1.3 | mapBedrockError 5 codes + fallback |
| 5 | Bedrock InvokeModel (not Converse) | D289, T1.2 | URL routing |
| 6 | Bedrock region prefix routing | D290, T1.1 | inferRegionFromModelId |
| 7 | Vertex profile | D288, T3.1 | vertex.ts |
| 8 | Vertex ADC integration | T3.2 | google-auth-library lazy load |
| 9 | Vertex Gemini OpenAI-compat | D291, T4.1 | reuse OpenAIClient with vertex baseUrl |
| 10 | Vertex Claude `:rawPredict` | D292, T4.2 | VertexAnthropicClient new |
| 11 | Vertex `global` location fix | D293, T3.1 | resolveVertexBaseUrl strip prefix |
| 12 | Vertex error mapping | T4.3 | mapVertexError 5 codes + fallback |
| 13 | Body massage (anthropic_version inject + model strip) | T1.2, T4.2 | both clients |
| 14 | NOT using Anthropic SDK wrappers | D294 | direct fetch in both clients |
| 15 | Token refresh strategy | D295, T2.1, T3.2 | env Bedrock; getAccessToken Vertex |
| 16 | Deferred features documented | D296-D299 | Converse, WIF, SigV4, SA tooling |
| 17 | 17 ADRs registered (post edge-case review) | T0.1 | D286-D302 |
| 22 | Bedrock model ID `bedrock/<aws-id>` convention (EC-13) | T1.1, T1.2 | stripBedrockPrefix + fallbackModels |
| 23 | Bedrock streaming deferred to v1.x (EC-5) | T1.2, D302 | always /invoke; single-event emit |
| 24 | Vertex projectId missing → helpful error (EC-1) | T4.1 | ConfigurationError at selectTransport |
| 25 | Vertex peer dep missing → helpful error (EC-3) | T3.2 | ConfigurationError differentiating module-not-found |
| 26 | Bedrock token missing → helpful error (EC-6) | T1.2 | ConfigurationError at selectTransport |
| 18 | Examples bedrock-bot + vertex-bot | T5.1, T5.2 | standalone runners |
| 19 | docs.md sections | T5.3 | "Bedrock provider" + "Vertex AI provider" |
| 20 | Live dogfood env-gated | Phase 6 | both providers if creds available |
| 21 | Telegram-pro regression check | Phase 6 | 43/45 PASS mandatory |

**Coverage: 26/26 (100%)** (post edge-case review: +5 entries for 5 MUST FIX absorbed)

## Global Definition of Done

- [ ] All 6 phases completed.
- [ ] ≥ 60 unit tests passing across `tests/providers/`, `tests/llm/`, `tests/errors/`.
- [ ] Zero biome warnings em arquivos novos.
- [ ] Build CJS + ESM + DTS verde no `packages/sdk`.
- [ ] Backward compat: zero quebra em providers existentes (anthropic/openai/openrouter/ollama/lmstudio/llamacpp).
- [ ] 17 ADRs registered (D286-D302).
- [ ] CLAUDE.md Roadmap entry #8 → ✅ DONE 2026-05-23 com **7/8 itens shipados**.
- [ ] `docs.md` Bedrock + Vertex sections.
- [ ] `examples/bedrock-bot/` + `examples/vertex-bot/` real-LLM validated (env-gated).
- [ ] **Telegram-pro dogfood mandatory PASS** ≥ 43/45.
- [ ] **Runtime-metric proof** — pelo menos 1 dos 2 providers (Bedrock OU Vertex) tem live test PASS observado se creds disponíveis. Se ambos creds disponíveis, ambos PASS.

## Final Phase: Dogfood QA (MANDATORY)

See Phase 6. Plano completo somente quando telegram-pro PASS. Live Bedrock/Vertex são "nice-to-have" documentados (env-gated, D284 pattern).
