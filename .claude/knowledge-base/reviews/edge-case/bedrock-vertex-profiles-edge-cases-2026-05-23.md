# Edge Case Review — bedrock-vertex-profiles

Data: 2026-05-23
Tasks analisadas: 13 (T0.1, T1.1, T1.2, T1.3, T2.1, T3.1, T3.2, T4.1, T4.2, T4.3, T5.1, T5.2, T5.3)
Edge cases encontrados: 12 (MUST FIX: 5, SHOULD TEST: 4, DOCUMENT: 3)

---

## MUST FIX

### EC-1: Vertex `resolveVertexProjectId()` retorna `undefined` → URL com segment vazio

- **Task afetada:** T3.2, T4.1, T4.2
- **Família:** Input / Boundary
- **Cenário:** Caller cria `Agent.create({ model: { id: "vertex/google/gemini-2.0-flash-001" } })` mas `GOOGLE_CLOUD_PROJECT` e aliases não estão set. `resolveVertexProjectId()` retorna `undefined`. Router faz `?? ""` → `resolveVertexBaseUrl({ projectId: "", ... })` → URL fica `.../v1/projects//locations/us-central1/...` (segment vazio). Vertex retorna `400 INVALID_ARGUMENT` com mensagem cifrada.
- **Impacto:** Erro confuso pro usuário. Vertex não diz "projectId missing", diz algo genérico tipo "invalid path".
- **Fix sugerido:** Em `selectTransport` para profile vertex, antes de construir client, validar:
  ```typescript
  const projectId = resolveVertexProjectId();
  if (projectId === undefined) {
    throw new ConfigurationError(
      "Vertex requires a project id. Set GOOGLE_CLOUD_PROJECT env var or run `gcloud config set project <id>`.",
      { code: "vertex_project_missing", provider: "vertex" },
    );
  }
  ```

### EC-3: `google-auth-library` ausente → empty Bearer header → 401 confuso

- **Task afetada:** T3.2 (resolveVertexAccessToken), T4.1, T4.2
- **Família:** Permission / Configuration
- **Cenário:** D288 declara `google-auth-library` como required peer dep, mas não há enforcement em runtime. Se caller esquece de instalar, `resolveVertexAccessToken()` retorna `undefined` silenciosamente (catch swallow do createRequire). Router faz `apiKey: undefined ?? ""` → `Authorization: Bearer ` (empty) → Vertex retorna 401 `UNAUTHENTICATED`. User vê "auth error" mas a causa real é peer dep faltando.
- **Impacto:** Debug ruim. User instala o SDK, segue docs, vê 401 e não entende.
- **Fix sugerido:** Em `resolveVertexAccessToken`, diferenciar "peer dep missing" vs "ADC missing". Throw helpful error quando peer dep está ausente:
  ```typescript
  // in catch of createRequire:
  catch (err) {
    throw new ConfigurationError(
      "Vertex provider requires `google-auth-library`. Install it: `pnpm add google-auth-library`.",
      { code: "vertex_peer_dep_missing", provider: "vertex", cause: err },
    );
  }
  ```
  Mantém retorno `undefined` apenas quando lib carregou mas `getAccessToken()` falhou sem credentials.

### EC-5: AWS event stream binary parser fora de escopo — defer streaming Bedrock para v1.x

- **Task afetada:** T1.2 (`BedrockAnthropicClient` + `decodeBedrockEventStream`)
- **Família:** Format / Scope
- **Cenário:** Plano estima `decodeBedrockEventStream` em ~50 LoC. **Subestimado.** AWS Event Stream é formato binário com prelude (12 bytes), headers (variable, type-encoded), payload, e CRC32 trailer. Não é SSE; não dá pra reusar parser SSE. Implementação correta exige ou (a) `@aws-sdk/util-stream-node` (~50KB + transitivas), ou (b) reimplementar do spec (~200+ LoC, propenso a bug em CRC validation).
- **Impacto:** Risco de scope creep: implementação parece simples mas explode em complexidade. Ou shipa com bug em edge cases de framing, ou adiciona peer dep não anunciado.
- **Fix sugerido:** **Defer streaming Bedrock para v1.x.** v1 ship apenas `invoke` (non-streaming). Adicionar nova ADR D302: "Bedrock streaming deferido a v1.x; v1 usa apenas `/model/{id}/invoke`". Update T1.2 para NÃO implementar `decodeBedrockEventStream`. `stream(request)` retorna response completo como single event. Caller pode opt-in via escape hatch (raw `@aws-sdk/client-bedrock-runtime` se precisar) ou esperar v1.x.

### EC-6: `resolveBedrockToken` retorna `undefined` → empty Bearer

- **Task afetada:** T2.1, T1.2
- **Família:** Permission / Configuration
- **Cenário:** Mesmo padrão do EC-3 mas para Bedrock. Sem `AWS_BEARER_TOKEN_BEDROCK` env E sem `@aws/bedrock-token-generator` peer dep, retorna `undefined`. Router faz `apiKey: undefined ?? ""` → 401 do Bedrock com mensagem confusa.
- **Impacto:** Debug pobre.
- **Fix sugerido:** Em `selectTransport` para profile bedrock, validar antes de construir:
  ```typescript
  const token = await resolveBedrockToken(region);
  if (token === undefined || token.length === 0) {
    throw new ConfigurationError(
      "Bedrock requires AWS_BEARER_TOKEN_BEDROCK env var OR install `@aws/bedrock-token-generator` for auto-refresh.",
      { code: "bedrock_token_missing", provider: "bedrock" },
    );
  }
  ```

### EC-13: Bedrock model IDs não têm prefixo de provider — como router decide "isto é Bedrock"?

- **Task afetada:** T1.1 (profile definition + model ID format)
- **Família:** Integration / Routing
- **Cenário:** D186 estabelece "provider name inferred from `model.id` prefix when not declared". Modelos Ollama usam `ollama/X`, Vertex usa `vertex/X`. Mas o plano lista Bedrock fallback como `"us.anthropic.claude-sonnet-4-5-v1:0"` (formato AWS-nativo, **sem** prefix `bedrock/`). Como o router decide que `us.anthropic.X` → Bedrock provider em vez de cair em algum default?
- **Impacto:** Se não documentado/forçado, caller passa `model: { id: "us.anthropic.claude-sonnet-4-5-v1:0" }` e router não sabe qual profile usar → erro de "provider not found" OU cai em default OpenAI.
- **Fix sugerido:** **Estabelecer convenção `bedrock/{aws-model-id}` em v1.** Plan atualiza:
  - Profile name: `bedrock`.
  - fallbackModels: `["bedrock/us.anthropic.claude-sonnet-4-5-v1:0", "bedrock/global.anthropic.claude-opus-4-7-v1:0", "bedrock/global.anthropic.claude-haiku-4-5-v1:0"]`.
  - Em `BedrockAnthropicClient`, strip prefix `bedrock/` antes de montar URL.
  - Documentar: caller deve usar `bedrock/<aws-id>` para o router reconhecer.

---

## SHOULD TEST

### EC-4: URL encoding para model IDs com `:` (Bedrock `v1:0`) e `@` (Vertex `@20250929`)

- **Task afetada:** T1.2, T4.2
- **Teste sugerido:** `bedrock_client_encodes_colon_in_modelId_correctly` + `vertex_anthropic_client_encodes_at_sign_in_modelId_correctly` — `encodeURIComponent` converte `:` → `%3A` e `@` → `%40`. AWS e Vertex aceitam ambos por RFC 3986, mas é bom validar com mock fetch que URL gerada bate exatamente com o que produção espera. Documentar exemplos no docs.md.

### EC-7: `inferModelDialect` em formatos não-canônicos

- **Task afetada:** T3.1
- **Teste sugerido:** `inferModelDialect_handles_multiple_slashes_in_path` — `vertex/google/something/weird-id` ainda detecta como `"gemini"`. `vertex/anthropic/claude-test/variant` ainda detecta `"anthropic"`. Empty string OR sem `/`. Garante que `includes` não pega false-positives.

### EC-8: Vertex `streamRawPredict` SSE format vs Anthropic native SSE

- **Task afetada:** T4.2
- **Teste sugerido:** `vertex_anthropic_client_parses_streamRawPredict_sse_events` — Vertex `:streamRawPredict` retorna SSE envelopado (`event: message`, `data: {...}`) similar a Anthropic native MAS pode ter diffs subtis (extra envelope fields, ordem de eventos). Test com fixtures de SSE real (capturados de uma chamada Vertex) verifica que o decoder reaproveitado de Anthropic consome corretamente. Validar via live dogfood (D284 pattern).

### EC-9: Caller-provided `apiKey` override para Bedrock

- **Task afetada:** T1.2, T1.3 (router integration)
- **Teste sugerido:** `bedrock_client_uses_caller_apiKey_when_provided` — quando caller passa `Agent.create({ apiKey: "explicit-token" })`, transport deve usar esse token em vez de chamar `resolveBedrockToken` (env/generator path). Test com mock router. Garante que o pattern de credential resolution já estabelecido (`resolveApiKey` chain) é respeitado.

### EC-10: Bedrock token cache em chamadas concorrentes

- **Task afetada:** T2.1
- **Teste sugerido:** `bedrock_token_cache_single_flight_under_concurrency` — 5 chamadas simultâneas com cache stale → apenas 1 chama `provideBedrockToken` (SigV4 round-trip é caro). v1 pode aceitar N chamadas redundantes (não rompe correctness, só desperdiça), mas teste documenta o comportamento atual + serve como red flag se um futuro refactor degradar single-flight.

---

## DOCUMENT

### EC-2: Bedrock token expirado mid-stream

- **Risco aceito:** Stream Bedrock long-running com token short-term (12h max). Token expira durante stream → AWS retorna 401 mid-stream. Não há refresh possível mid-stream (não dá pra "reanexar" SSE). Cache TTL do plan (1.5h) é well below 12h max → re-refresh ocorre BEFORE stream começar, não DURING. Edge case real só se stream durar >1.5h, raro. Documentar limitação em docs.md.

### EC-11: `google-auth-library` foi arquivado em nov/2025

- **Risco aceito:** Repo `googleapis/google-auth-library-nodejs` é read-only desde nov/2025 — Google migrou para novo modelo OSS client. Continua security-patched (releases regulares) mas sem novas features. Não há alternativa viável em 2026-05. Documentar em D288 ADR + README do `examples/vertex-bot/`.

### EC-14: Vertex Anthropic — `anthropic-beta` header para features novas

- **Risco aceito:** Anthropic-on-Vertex às vezes exige `anthropic-beta: <feature>` header (ex: prompt-caching-2024-07-31, computer-use-2025-01-24). Plan não set header default. Caller que precisar usa escape hatch via `bodyOverrides` ou aguarda v1.x quando Anthropic-beta passar do request body. Documentar.

---

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 1 | 1 (EC-13) | 0 | 0 |
| T1.2 | 3 | 1 (EC-5) | 2 (EC-4, EC-9) | 1 (EC-2) |
| T1.3 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 1 (EC-6) | 1 (EC-10) | 0 |
| T3.1 | 1 | 0 | 1 (EC-7) | 0 |
| T3.2 | 1 | 1 (EC-3) | 0 | 1 (EC-11) |
| T4.1 | 1 | 1 (EC-1) | 0 | 0 |
| T4.2 | 1 | 0 | 1 (EC-8) | 1 (EC-14) |
| T4.3 | 0 | 0 | 0 | 0 |
| T5.1-3 | 0 | 0 | 0 | 0 |
| **Total** | **12** | **5** | **4** | **3** |

**Veredicto:** PLANO OK COM AJUSTES — absorver os 5 MUST FIX no plano antes da implementação. Adicionar **D302** (Bedrock streaming deferido — total 17 ADRs em vez de 16). SHOULD TEST integrados aos TDD blocks. DOCUMENT entram no docs.md.

**Nenhum MUST FIX exige nova camada de abstração** — todos são guards/throws/convenção de naming. KISS preservado.

**Notas pragmáticas:**

- **EC-5 (defer Bedrock streaming) é o mais consequencial.** Evita scope creep mascarado em "50 LoC" que vira 200+. v1 ship apenas non-streaming Bedrock; streaming chega em v1.x com decisão consciente sobre parser (peer dep AWS SDK ou própria implementação).
- **EC-13 (model ID convention) é crítico de DX.** Sem padronizar `bedrock/<aws-id>`, caller fica confuso sobre quando usar prefix vs not. Aplica mesmo pattern que Ollama/Vertex já usam.
- **EC-1, EC-3, EC-6 (helpful errors)** são padrão de boa engenharia — falha silenciosa vira debug session de 1h; throw explícito resolve em 30 segundos.
- **EC-4, EC-8** (URL encoding + Vertex SSE) só podem ser validados de verdade contra APIs reais — live dogfood (D284 pattern) é importante quando creds disponíveis.
