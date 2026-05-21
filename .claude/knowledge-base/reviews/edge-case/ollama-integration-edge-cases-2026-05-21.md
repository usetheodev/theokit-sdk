# Edge Case Review — ollama-integration

Data: 2026-05-21
Tasks analisadas: 12 (T1.1, T1.2, T2.1, T3.1, T4.1, T5.1, T6.1, T6.2, T6.3, T7.1, T7.2, T8.1)
Edge cases encontrados: 17 (MUST FIX: 3, SHOULD TEST: 7, DOCUMENT: 7)

## MUST FIX

### EC-A: Embedding dimension drift entre hard-code e response do servidor
- **Task afetada:** T3.1
- **Família:** Format / Boundary
- **Cenário:** D183 declara `DIMENSION_BY_MODEL = { "nomic-embed-text": 768, "all-minilm": 384 }` hard-coded. Ollama atualiza versão do `nomic-embed-text` (v1 → v1.5 mudou dimension em 2024) OU usuário roda fork custom que retorna 1024-dim. Adapter advertise 768 mas Memory layer recebe vetores de outra dim → `Memory.write` quebra invariante (SQLite column ou Lance schema espera 768), OU pior: silenciosamente armazena truncado → busca por similaridade fica nonsense.
- **Impacto:** Corrupção silenciosa da memory layer; bug invisível até queries começarem a devolver lixo.
- **Fix:** No `ollama-embedding.ts`, na primeira chamada bem-sucedida, comparar `embedding.length` ao valor hard-coded; se divergir, log warn one-shot E usar `embedding.length` real (não o hard-coded) para todas as chamadas subsequentes. Test: `test_dimension_drift_warns_and_uses_actual()`.

### EC-B: Texto vazio passado para `/api/embeddings`
- **Task afetada:** T3.1
- **Família:** Input
- **Cenário:** Memory pipeline (e.g., dreaming sweep) faz chunking de documento; um chunk pode resultar em string vazia após sanitização (whitespace-only, ou todos os tokens removidos). Adapter passa `""` para `/api/embeddings` → Ollama retorna 400 com mensagem cryptica `{"error":"prompt cannot be empty"}` ou vetor zero (varia por versão).
- **Impacto:** Stack trace opaco no usuário; pior, vetor zero (norma 0) quebra cosine similarity (division by zero ou NaN propaga).
- **Fix:** No `embed(text)` no `ollama-embedding.ts`: `if (text.trim().length === 0) throw new ConfigurationError("Cannot embed empty text", { code: "invalid_input" });`. Test: `test_empty_text_throws_typed_error()`.

### EC-C: CredentialPool com `authType: "none"` quando `apiKeys[name]` populado é sub-especificado
- **Task afetada:** T1.1 (ADR D187)
- **Família:** State / Permission
- **Cenário:** ADR D187 diz "no-op + warn one-shot" mas T1.1 não lista o teste nem o ponto exato no router onde isso é implementado. Router atual (`router.ts:96-103`) entra no pool path quando `poolKeys.length >= 2`, **antes** de checar `profile.authType`. Resultado: usuário escreve `apiKeys: { ollama: ["k1", "k2"] }` por engano → router constrói `CredentialPool` com 2 chaves sentinel-shaped → rotação rotativa em runtime sem auth real → comportamento opaco.
- **Impacto:** Memória desperdiçada + log de cooldown poluído + bug invisível até pool exhaust com `CredentialPoolExhaustedError` confuso (cooldown contra Ollama local não faz sentido).
- **Fix:** No `buildClient` (router.ts), **antes** do pool-path branch, adicionar 3 linhas:
  ```ts
  if (profile.authType === "none" && poolKeys !== undefined && poolKeys.length > 0) {
    warnOnce(`provider "${name}" has authType: "none" — apiKeys ignored`);
    return selectTransport(profile, sentinelForNoAuth(profile) as string);
  }
  ```
  Test em T1.1 TDD: `test_credential_pool_noop_for_authtype_none()`.

## SHOULD TEST

### EC-D: Primeira chamada em modelo não-loaded tem latência 10-60s
- **Task afetada:** T1.2
- **Teste sugerido:** `test_ollama_first_call_handles_model_loading_delay()` — usar `AbortSignal.timeout(90_000)` no test setup (default vitest é 5s). Assert: send completes OR throws `ConfigurationError` com `code: "ollama_model_loading"` (mapper deve detectar `503` ou body com `"model is loading"`).

### EC-E: Modelo Ollama emite tool_call com JSON malformado
- **Task afetada:** T5.1
- **Teste sugerido:** `test_ollama_tool_call_malformed_json_repaired_by_d87()` — mock OllamaClient retornando tool_call com `arguments: "{\"x\":1,}"` (trailing comma) → assert que D87 repair flow strip-and-parse devolve `{x: 1}` válido.

### EC-F: Modelo Ollama NÃO emite tool_call apesar do prompt explicit
- **Task afetada:** T5.1
- **Teste sugerido:** `test_ollama_tool_call_with_retry_cap()` — quando primeira tentativa não emite `tool_calls`, retry up to 3x com prompt-clarification; se 3/3 falham, test usa `test.skip("model refused tool call — capability gap, not SDK bug")` em vez de assertion fail. Reduz flakiness em modelos menos capazes.

### EC-G: Ollama retorna chat completion com content VAZIO
- **Task afetada:** T1.2 + T8.1
- **Teste sugerido:** `test_ollama_empty_content_detected_by_d93()` — modelos quantizados pequenos ocasionalmente retornam `{"role":"assistant","content":""}` (model refused / bug). D93 (`validateResponse`) deve detectar e throw `EmptyResponseError`. Assert que detecção dispara também em provider ollama.

### EC-H: Imagem > 5MB para vision endpoint
- **Task afetada:** T4.1
- **Teste sugerido:** `test_ollama_vision_oversized_image_typed_error()` — base64-encode imagem ~6MB → Ollama default returns 413 ou 400 com `request entity too large` → mapper deve traduzir para `ConfigurationError` com mensagem "Image exceeds Ollama default size limit (5MB). Increase `OLLAMA_MAX_LOADED_MODELS` server-side or resize image."

### EC-I: Batch embedding com 1 de N inputs falhando
- **Task afetada:** T3.1
- **Teste sugerido:** `test_ollama_batch_embedding_fail_fast()` — chunk-paralelo de 4 onde 1 fetch rejeita → `Promise.all` rejeita imediatamente com erro tipado contendo `metadata.failedIndex: 2` (qual posição falhou). Comportamento fail-fast > partial-results para consistência com SDK error handling.

### EC-J: Modelo identifier com `:` (tag) — `llama3.2:latest`, `qwen2.5:7b-instruct`
- **Task afetada:** T2.1, T6.1
- **Teste sugerido:** `test_ollama_model_with_tag_resolves()` — `Agent.create({ model: "ollama/llama3.2:latest" })` resolve corretamente. Parser pega tudo após primeiro `/` como identifier (incluindo `:`), envia para Ollama como `model: "llama3.2:latest"` no body. Ollama aceita.

## DOCUMENT

### EC-K: Ollama versão pre-0.3.0 sem tool support
- **Risco aceito:** Plan já menciona em Risks. Adicionar em `docs.md` seção "Local models — Ollama": "Tool calling requires Ollama >= 0.3.0. Embedding requires >= 0.1.27. Vision requires >= 0.4.0."

### EC-L: Primeira chamada em modelo não-loaded tem latência grande
- **Risco aceito:** Não é bug, é arquitetura Ollama. Documentar em `examples/ollama-hello/README.md`: "Primeira execução após `ollama pull` pode levar 10-60s enquanto o modelo carrega para a memória. Execuções subsequentes são rápidas."

### EC-M: `nomic-embed-text` qualidade ótima com prefix `search_query:` / `search_document:`
- **Risco aceito:** Implementar prefix automático exige decidir quando (write vs query), e essa decisão depende do caller. Documentar como "Advanced tuning" em `docs.md`: "For best retrieval quality with `nomic-embed-text`, prefix corpus chunks with `search_document: ` and queries with `search_query: ` before passing to Memory."

### EC-N: `ollama-local-rag` SQLite DB stale entre runs
- **Risco aceito:** Idempotência completa exige clear-on-start ou content-hash dedup, ambos não-trivial para um example. Documentar em README: "Run `rm -f db.sqlite` between runs if you want a fresh state. The example accumulates entries by default."

### EC-O: llama.cpp `./server` é single-model — model name é cosmético
- **Risco aceito:** Implementar enforcement (validar model name vs server-loaded model) requer fetch `/v1/models` e check; mas server loaded com `qwen2.5` retorna `qwen2.5` em `/v1/models` independente do nome solicitado. Documentar em ADR D189 e docs.md: "llama.cpp server carrega um único modelo definido no startup; o argumento `model` no SDK é cosmético — qualquer string funciona, a resposta vem do modelo carregado pelo `./server`."

### EC-P: Dogfood pode falhar por gap de capability Llama3.2 vs Claude/GPT-4o (não bug da SDK)
- **Risco aceito:** Llama3.2 (1B) é capaz para conversa básica, mas perde quando comparado a Claude/GPT-4o em tool selection complexa e instruction following. T8.1 já menciona "documentar pre-existing"; reforçar no report template: cada issue deve ter campo `category: "sdk_bug" | "model_capability_gap"` para separar.

### EC-Q: Workspace build dependency — primeira execução de example requer `pnpm build`
- **Risco aceito:** Padrão de monorepo pnpm workspace. Documentar em README de cada example novo: "First time: run `pnpm build` at monorepo root. After that, `pnpm --filter <example-name> start` works."

## Resumo

| Task  | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|-------|-------------------|----------|-------------|----------|
| T1.1  | 1                 | 1        | 0           | 0        |
| T1.2  | 2                 | 0        | 2           | 0        |
| T2.1  | 1                 | 0        | 1           | 0        |
| T3.1  | 3                 | 2        | 1           | 0        |
| T4.1  | 1                 | 0        | 1           | 0        |
| T5.1  | 2                 | 0        | 2           | 0        |
| T6.1  | 2                 | 0        | 0           | 2        |
| T6.2  | 1                 | 0        | 0           | 1        |
| T7.2  | 1                 | 0        | 0           | 1        |
| T8.1  | 1                 | 0        | 0           | 1        |
| Cross | 3                 | 0        | 0           | 3        |
| **Total** | **17**        | **3**    | **7**       | **7**    |

**Veredicto:** **PLANO PRECISA DE AJUSTE** — 3 MUST FIX (EC-A, EC-B, EC-C) precisam ser incorporados antes de iniciar implementação. SHOULD TEST items são reforço de TDD existente; DOCUMENT items são notas para docs.md / READMEs.
