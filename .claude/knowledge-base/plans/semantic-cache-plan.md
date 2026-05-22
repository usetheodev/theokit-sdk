# Plan: Semantic Cache (`Cache.semantic({ provider, threshold })`)

> **Version 1.2 — ✅ COMPLETE 2026-05-22.** TODAS AS TASKS, CRITERIOS DE ACEITES, DODs CONCLUIDAS E VALIDADAS, TESTE DOGFOOD TELEGRAM-PRO. Final dogfood: **43/45 PASS, 1 FAIL (`/tool uuid` known Ollama-latency flake, passes in isolation; NOT caused by this work), 1 SKIP (HONCHO_API_KEY unset, expected).** `/cache_demo` PASS in 3664ms — cache stats (kvHits/semanticHits/misses/excluded) printed in reply for runtime-metric proof. SDK tests **54/54 cache + 132+ overall PASS**; build ESM+CJS+DTS green; 18 ADRs registered (D249-D266); 7 MUST FIX edges absorbed + 3 SHOULD TEST validated.
>
> **Version 1.1** — Edge case review 2026-05-22 absorveu 7 MUST FIX (EC-1 graceful embedder degradation, EC-2 dim mismatch filter, EC-3 empty prompt bypass, EC-4 asPlugin memoization, EC-7 corrupt JSON recovery, EC-10 don't cache tool-use runs, EC-13 single-source-of-truth Map) + 3 SHOULD TEST added to TDD + 3 DOCUMENT integrated as invariants. **Adicionada D266** para a decisão semântica de "não cachear tool-use runs". See `.claude/knowledge-base/reviews/edge-case/semantic-cache-edge-cases-2026-05-22.md`.
>
> **Version 1.0** — Adiciona ao `@usetheo/sdk` uma camada de cache semântico para chamadas LLM, montada sobre os primitivos existentes (`MemoryEmbeddingProviderAdapter` D11 + plugin hooks `pre_user_send` / `post_assistant_reply` D145 + `internal/persistence/` D59-D64). API alvo: `Cache.semantic({ embedder, threshold, ttl, namespace }).asPlugin()` plugável via `Agent.create({ plugins: [cache] })`. Outcome esperado: shippar o item #6 do Adoption Roadmap com ADRs D249-D265, integração validada via `/cache_demo` no telegram-pro, e demonstração mensurável de hit rate via OTel spans `cache.hit` / `cache.miss`. **Não é** um RAG retriever (esse papel é da Memory). É um pré-filtro entre `agent.send(prompt)` e o LLM real — se uma query semanticamente equivalente já foi respondida dentro do TTL+threshold, devolvemos a resposta cacheada sem chamar o provider.

## Context

**O que existe hoje no SDK:**
- `MemoryEmbeddingProviderAdapter` (D11) — adapters openai/mistral/openrouter/voyage/deepinfra shipados; `EmbeddingRuntime#embed(texts)` retorna `number[][]`.
- `MemoryAdapter` (D141-D149) — interface formal para storage com 3 packages (`@usetheo/memory-supermemory`, `@usetheo/memory-honcho`, `@usetheo/memory-mem0`).
- `Plugin` (D97-D109) — discriminated union por `kind`, registrado via `Agent.create({ plugins: [...] })`. Hooks `pre_user_send` + `post_assistant_reply` (D145) já interceptam o fluxo de envio antes/depois do LLM.
- `internal/persistence/` (D59-D64) — `atomicWriteJson`, `readVersionedJson`, `casUpdate` — primitivas reusáveis para snapshots opt-in.
- `internal/telemetry/` (D34) — wrapper lazy de `@opentelemetry/api` com seam validado em 4 features (eval, handoff, workflow, agent loop).
- `Workflow.create` (D230-D248) — fresh evidence (2026-05-22 dogfood) de que o padrão "static factory + plugin/builder + executor interno" funciona end-to-end.

**O que está faltando (gap real do roadmap):**

Hoje, todo `agent.send(prompt)` bate o LLM, mesmo quando o usuário pergunta a mesma coisa (ou paráfrase) em queries sucessivas. Helicone Cache resolve **exato** via HTTP headers (não semantic), Anthropic prompt_caching resolve **prefix idêntico** com 90% discount mas não pega paráfrases, e Vercel AI SDK só tem cache exato via middleware. **LangCache (Redis)** é a única referência TS de mercado para semantic cache e está em **preview pública** (não-GA em maio/2026). LangChain Python tem `RedisSemanticCache`/`MongoDBAtlasSemanticCache` mas não há equivalente JS oficial. GPTCache (Python only, manutenção em queda).

**Implicação para `@usetheo/sdk`:** ou shippamos in-house (mimetizando shape do LangCache SDK + lições do vCache paper + arquitetura layered do GPTCache), ou ficamos atrás em paridade. O caminho in-house é viável **sem** novos backends — `MemoryEmbeddingProviderAdapter` (D11) já dá embeddings; `internal/memory/embedding-cache.ts` já dá LRU local; `internal/persistence/atomic-write.ts` (D60) dá disk persistence; plugin hooks já dão pontos de interceção.

**Evidências da pesquisa web (2025-2026):**

1. **Helicone Cache** — exato only, headers HTTP, Cloudflare KV. Não publica % de redução de custo.
2. **LangCache** (`@redis-ai/langcache`) — semantic, public preview, embedding server-side, threshold gerenciado server-side. Único TS shipável.
3. **GPTCache** — arquitetura layered (KV pre-filter → embedding → vector → similarity → re-eval). Python only, manutenção em queda (último release agosto/2024).
4. **LangChain Semantic Cache** — Python only; usa global `set_llm_cache()` (anti-pattern multi-tenant). Threshold legacy vs novo é confuso (`score` vs `distance`).
5. **Anthropic prompt_caching** — 90% discount real, prefix-based, mínimo 1024-4096 tokens. **Complementar ao semantic**, não substituto.
6. **Vercel AI SDK** — middleware `LanguageModelV3Middleware`, exato only, sem semantic built-in.
7. **vCache paper (arxiv 2603.03301)** — per-entry adaptive threshold (cada entry tem seu bound) supera threshold global fixo.
8. **CacheAttack (arxiv 2601.23088)** — 86% hit rate em LLM response hijacking via cache key collision. Composite key obrigatório.
9. **Negation paper (arxiv 2603.17580)** — dense embeddings colapsam negação ("delete X" vs "don't delete X" são vizinhos). Risco real de false positive.
10. **Category-aware paper (arxiv 2510.26835)** — TTL fixo é antipattern: pricing precisa 15min, docs precisam 7d.

**Por que NOW, não LATER:**
- Adoption Roadmap #5 (Workflows) shipou hoje (2026-05-22). Cache compõe naturalmente sobre o que existe — sem refactor invasivo.
- 4 itens restantes no roadmap; #6 tem score 6 (Tier 3 production hardening — começa quando #3 Docs estabilizar; mas o plano pode rodar em paralelo).
- LangChain TS não tem equivalente → janela competitiva real até alguém shippar.
- Anthropic prompt_caching atinge 90% só em workloads com sistema/tools longos repetidos — semantic cobre o gap de paráfrases curtas (chat casual, queries de docs FAQ-shaped).

## Objective

**Done = `Cache.semantic({ embedder, threshold, ttl, namespace })` registrável como plugin em `Agent.create({ plugins: [cache] })` que intercepta `pre_user_send` → consulta KV exato + vector semantic → se hit retorna resposta cacheada (sem chamar LLM); se miss, deixa fluir e armazena em `post_assistant_reply` para queries futuras.**

Goals mensuráveis:
1. API pública `Cache.semantic(options).asPlugin()` (factory + plugin shape).
2. Reuso 100% de `MemoryEmbeddingProviderAdapter` — sem novo layer de embedding.
3. Layered cache: KV exact-match pre-filter (rápido, ~1ms) → vector semantic (~10-100ms) → similarity threshold check.
4. Default threshold: `0.85` cosine distance, configurável. Default TTL: `1h` com exclusion regex para queries time-sensitive.
5. Composite cache key: `${tenantId ?? "global"}:${embedderId}:${modelId}:hash(prompt)`. Espelha guidance vCache + CacheAttack.
6. Backends: in-memory LRU default (1000 entries), JSON disk opt-in via `persistence: { dir }`. Reuso de `atomicWriteJson` + `readVersionedJson`.
7. Telemetry: spans `cache.lookup`, `cache.hit`, `cache.miss` com atributos `embedder.id`, `similarity.distance`, `kv.matched`, `ttl.remaining_s`.
8. Integration: `/cache_demo` no telegram-pro mostrando hit/miss across 3 paraphrased queries.
9. 17 ADRs registradas (D249-D265).
10. Cobertura: ≥40 unit tests novos + example `examples/cache/` + telegram-pro dogfood validado.
11. **Não-goals (deferidos para v1.x):** streaming cache, per-entry adaptive threshold (vCache), LLM-as-judge verification (Krites), saga/event-driven invalidation, cloud parity para CloudAgent.

## ADRs

### D249 — `Cache.semantic` é classe estática com `.asPlugin()` retornando Plugin de `kind: "cache"`

**Decision:** `Cache` exposto como classe com private constructor. `Cache.semantic(options)` valida via Zod e retorna instância. `cache.asPlugin()` retorna um `Plugin<{ kind: "cache" }>` registrável em `Agent.create({ plugins: [cache.asPlugin()] })`. Constructor é private; só `.semantic()` (factory) é entrada.

**Rationale:** Pattern estabelecido em 6 façades públicas (Agent.create, Eval.create, Handoff.create, Workflow.create, Cron.create, Memory.create). Plugin shape (D98) é o mecanismo padrão para extensão não-invasiva. Caller controla composição (várias caches? overrides per-agent? trivial).

**Consequences:** Type-tests triviais. Cache é desativável removendo do `plugins[]` (não precisa de `setLlmCache(null)` global). Forward-compat: outros tipos de cache (KV-only, prompt-prefix) viram `Cache.exact(...)`, `Cache.prefix(...)` no futuro.

### D250 — Cache é um Plugin (`kind: "cache"`), não um wrapper de Agent

**Decision:** Cache é registrado como plugin no `Agent.create({ plugins: [...] })`. Adiciona um novo discriminator `"cache"` ao `Plugin` union (D98). Plugin expõe `pre_user_send` (lookup) e `post_assistant_reply` (store) handlers.

**Rationale:** Hook points existentes (D145) são exatamente o que precisamos — interceptar prompt antes do LLM e capturar resposta após. Plugin shape é não-invasivo, composável (múltiplos plugins funcionam juntos), e per-agent (não global, evitando anti-pattern do LangChain Python).

**Consequences:** Cache é per-Agent. Multi-tenant é resolvido pelo namespace na construction (D253). Tests podem montar cache+plugin em isolamento. Mudança no Plugin union exige bump de versão minor (não breaking, additive).

### D251 — Reusa `MemoryEmbeddingProviderAdapter` (D11) para embeddings — zero novo layer

**Decision:** O parâmetro `embedder` aceita um `MemoryEmbeddingProviderAdapter` instanciado OU as opções do factory (`{ provider: "openai" }`). Internamente, chamamos `runtime.embed([text])` para gerar o vector. Quando default, autoselect via prioridade de adapters já cadastrados.

**Rationale:** Adapters openai/mistral/openrouter/voyage/deepinfra já estão shipados (D11). Reescrever = duplicação. Embedding cache (LRU) também já existe em `internal/memory/embedding-cache.ts` — Cache usa o mesmo, mas namespace separado.

**Consequences:** Tests podem usar fake embedder retornando vectors determinísticos. Mudar embedder invalida cache (D258 versionado por embedder.id no namespace). Custo de embedding API conta para o budget do usuário — Cache documenta.

### D252 — Arquitetura layered (KV exact pre-filter + vector semantic), inspirada em GPTCache

**Decision:** Toda lookup tenta primeiro KV exact (hash do prompt normalizado); se miss, embedda e busca vector. Se vector top-1 dentro do threshold → hit semantic. KV pre-filter é O(1); vector é O(N) ou O(log N) com index.

**Rationale:** GPTCache prova que pre-filter rápido é ~10x cheaper que sempre embedar. Exato é comum em chat (mesma pergunta repetida). Semantic só dispara quando exato falha → maximiza economia de chamadas ao embedder API.

**Consequences:** Dois storage backends por trás (KV map + vector list). Coordenação via composite key (mesma chave em ambos). Tests cobrem ambos caminhos. Métricas separadas: `cache.kv.hit` vs `cache.semantic.hit`.

### D253 — Composite cache key: `${namespace}:${embedderId}:${modelId}:hash(prompt)`

**Decision:** Cache key sempre inclui:
- `namespace` (default `"global"`, override per-instance) — multi-tenant isolation.
- `embedderId` — invalidar ao trocar embedder (cross-embedder rerank impossível).
- `modelId` (do agente que pediu) — respostas dependem do modelo; gemini-flash vs gpt-4o produzem qualidades diferentes.
- `hash(prompt)` — SHA-256 dos primeiros 256 chars (KV chave); vector store usa o embedding direto.

**Rationale:** CacheAttack paper documenta 86% hit rate em response hijacking quando keys colidem. Composite resolve privacy (multi-tenant), correctness (cross-model contamination) e invalidation (cross-embedder) em uma decisão.

**Consequences:** Cache não compartilha entre tenants nem entre modelos. Vector index é particionado por namespace. Documentar que mudar `modelId` no Agent invalida (caller pode forçar same modelId em variantes).

### D254 — Threshold default `0.85` cosine distance, configurável; **NÃO** adaptativo per-entry em v1

**Decision:** Default `threshold: 0.85` (distance, lower = stricter). Override via `Cache.semantic({ threshold: 0.9 })`. v1 NÃO implementa vCache-style per-entry threshold — esse é roadmap v1.x.

**Rationale:** LangChain doc exemplos usam 0.1 distance (muito conservador); LangCache guidance 0.7-0.95. Threshold global fixo em 0.85 é meio-termo razoável (não bloqueia paráfrases legítimas, mas captura "what is X" vs "tell me about X"). vCache exige online learning + per-key state — escopo grande, defer.

**Consequences:** False positive risk documentado (D264). Caller pode tunar via `threshold` se a precisão importa mais que recall (cenários médicos/financeiros: baixe pra 0.95). Default conservador.

### D255 — TTL per-category com default `1h`, exclusion regex pra time-sensitive markers

**Decision:** API: `ttl: { default: "1h", categories: { pricing: "15m", docs: "7d" }, exclude: /\b(today|now|current|weather|stock)\b/i }`. Default 1h. Exclusion regex marca queries que NUNCA cacheam (não invalida quando expira, simplesmente skip).

**Rationale:** Category-aware paper (arxiv 2510.26835) prova que TTL fixo é antipattern. Real-time (weather): 30s-5min; pricing: 15-30min; docs: dias-semanas. Caller categoriza prompts via regex/metadata. Exclusion regex evita cache poisoning em queries time-sensitive sem complicar a API.

**Consequences:** v1 implementa default + exclude; categories via metadata é roadmap (precisa hook para tagging por caller). Tests cobrem expiration. Documentar exclusion como "safer default" para FAQ.

### D256 — Streaming cache deferido a v1.x; v1 cacheia somente `agent.send` (resposta completa)

**Decision:** v1 intercepta `pre_user_send` + captura `post_assistant_reply` com texto completo. Streaming (via `agent.stream()`) NÃO é cacheado em v1 — o hit replay viraria um single-chunk pseudo-stream, perde UX. Documentar no `docs.md`.

**Rationale:** Vercel AI SDK middleware shows the pattern (cache array of chunks + `simulateReadableStream`), mas é frágil (timing replay, edge cases em partial decode). Defer até medirmos demanda real. Stream cacheable é ~30% complexidade extra para gain marginal.

**Consequences:** Tests não cobrem stream cache. Documentar que apps streaming-first devem usar Anthropic prompt_caching como complemento. Forward-compat: `Cache.semantic({ streaming: true })` adicionado quando shippar.

### D257 — Cache é **per-agent**, NÃO global state. Opt-in explícito via `plugins: [cache.asPlugin()]`

**Decision:** Cache NUNCA é registrado globalmente. Caller monta `cache.asPlugin()` e passa no `Agent.create({ plugins: [cache] })`. Múltiplos agentes podem compartilhar uma `Cache` instance (cache state é interno à instância, não ao plugin descriptor).

**Rationale:** LangChain Python `set_llm_cache()` é anti-pattern em multi-tenant. Per-agent gives explicit control + testability + multi-tenant naturalmente isolado. Cache instance é storage; plugin é interface de hook.

**Consequences:** Tests instanciam cache + agente separados. Sharing entre agentes funciona implicitamente (mesma instance = mesmo storage). Documentar pattern de sharing.

### D258 — Embedder change invalida cache via namespace versioning (não rerank cross-embedder)

**Decision:** O `embedder.id` faz parte da cache key (D253). Trocar `text-embedding-3-small` por `voyage-3-lite` torna todas as entries antigas inalcançáveis. Não implementamos rerank cross-embedder em v1 (é problema acadêmico aberto).

**Rationale:** Vectors de embedders diferentes vivem em espaços incomparáveis. Comparar cosine entre eles é semantic-nonsense. Cleaner failure mode: "switching embedder = fresh cache", documentado.

**Consequences:** Migração entre embedders perde cache. Caller pode pré-aquecer via batch warmup script (out-of-scope v1). Tests verificam que o namespace muda.

### D259 — KV exact tentado primeiro; semantic só dispara em KV miss (cost optimization)

**Decision:** No `pre_user_send` hook:
1. Normaliza prompt (trim + collapse whitespace).
2. Compute `kvKey = hash(normalized)`.
3. KV lookup. Se hit + TTL válido → return cached.
4. Else embed prompt + vector search.
5. If top-1 distance ≤ threshold → return cached.
6. Else miss; let prompt flow to LLM.

**Rationale:** Embedder calls (OpenAI ~100ms, self-hosted ~10ms) custam tempo + dinheiro. Skip quando hit exato é grátis. GPTCache valida arquitetura layered.

**Consequences:** Tests cobrem ambos paths (KV hit, KV miss + vector hit, KV miss + vector miss). Métricas separam `cache.kv.hit` de `cache.semantic.hit`.

### D260 — Lookup no `pre_user_send`; store no `post_assistant_reply`

**Decision:** Plugin handler `pre_user_send` tenta lookup; se hit, retorna `{ cached: true, response }` que o agent loop usa pra emitir SDKMessage sintético e curto-circuitar o LLM call. Handler `post_assistant_reply` captura a resposta final + armazena no cache (KV + vector).

**Rationale:** Hooks já existem (D145). Lookup pré-LLM é o ponto certo (não desperdiça tokens nem latency). Store post-reply garante que só cacheamos respostas completas (não streamings parciais).

**Consequences:** Se `pre_user_send` retornar uma resposta cacheada, agent loop **NÃO** chama o LLM. Tests verificam que `agent.send` resolve sem fetch ao provider. Cache hits são MAIS rápidos que o LLM (~10ms vs ~500ms+).

### D261 — LRU eviction in-memory default `1000` entries; configurável

**Decision:** Default `maxEntries: 1000`. LRU eviction (não LFU; LFU exige tracking access counts). API: `Cache.semantic({ maxEntries: 5000 })`. Para disk-backed (JSON), eviction é triggerada no write quando count > max.

**Rationale:** 1000 é o sweet spot pra dev/staging (cabe em RAM ~few MB com 1536-dim float32). Caller escala via maxEntries. LRU é cheap (Map + recency list) e standard.

**Consequences:** Tests cobrem eviction. Caller que precisa millions of entries deve usar Redis/Postgres backend (v1.x). Documentar tamanho default.

### D262 — Telemetry: spans `cache.lookup`, `cache.hit`, `cache.miss` via OTel seam existente

**Decision:** Lazy load `@opentelemetry/api` via `createRequire` (padrão D34/D206/D220/D241). Spans:
- `cache.lookup` (root per `pre_user_send` call) — atributos: `cache.namespace`, `cache.embedder_id`, `cache.kv_matched`, `cache.semantic_matched`, `cache.distance`, `cache.ttl_remaining_s`.
- `cache.hit` (kv|semantic) — child span; on hit only.
- `cache.miss` — child; on miss only.

**Rationale:** Padrão validado em 4 features. Métricas downstream (Datadog, Grafana, Honeycomb) podem dashboardar hit rate sem cliente fazer parsing custom.

**Consequences:** Tests usam noop tracer. Documentar atributos no docs.md. Cliente pode usar OTel exporters padrão.

### D263 — Compose com Anthropic prompt_caching — documentado, sem código

**Decision:** Cache.semantic é layer ANTES do LLM. Anthropic prompt_caching atua DENTRO do LLM (provider-side). São ortogonais — semantic resolve paráfrases (Cache miss/hit decision); prompt_caching resolve prefix idêntico (Anthropic-side discount). Documentar combinação esperada.

**Rationale:** Workloads ideais: semantic 70% hit + prompt_caching 90% discount no miss = economia composta ~95%. Não há trabalho de código para combinar — caller usa ambos. Documentation responsibility apenas.

**Consequences:** `docs.md` seção "Composing with provider-side caching" explica o pattern. Tests não validam Anthropic-specific (out-of-scope; provider feature).

### D264 — False positive risk documentado (sem mitigação automática em v1)

**Decision:** v1 NÃO implementa LLM-as-judge verification (Krites paper), NÃO faz hybrid lexical+semantic (BM25+dense). Caller que precisa de garantia de correctness usa threshold conservador (0.95+) OU exclude regex agressivo. Documentar limitação na docs.md.

**Rationale:** LLM-as-judge dobra o custo (cada potential hit = LLM call para verify). Hybrid BM25+dense exige Lucene-shaped index — escopo grande. v1 entrega 80% do valor; cenários high-stakes precisam de threshold conservador + exclusion.

**Consequences:** Roadmap v1.x para opt-in `verify: "llm-judge"` mode. Tests não cobrem negation collapse — documentar como known limitation. Examples mostram threshold tuning.

### D266 — Não cachear runs que usaram tools (EC-10 absorbed)

**Decision:** `performStore` skipa storage se `ctx.result?.usedTools === true` (qualquer tool foi invocada durante o run). Apenas runs "puros" (LLM gerou texto sem side-effect tools) são cacheados.

**Rationale:** Cache replay devolve só o texto final. Se o run original chamou `fs.delete(X)` e cacheamos a resposta "deleted", a próxima paráfrase hit replay retorna "deleted" SEM executar a tool — file não é deletado mas usuário acha que foi. Silent state corruption em qualquer cenário transacional. v1 toma a decisão segura: tool-use → no cache.

**Consequences:** Workloads tool-heavy (coding agent, file ops, API calls) não se beneficiam de cache. Workloads pure-text (FAQ, classify, summarize, chat casual) capturam todo o ganho. Documentar trade-off em `docs.md`. v1.x pode adicionar opt-in `cacheToolResults: true` quando alguém pedir e tivermos signature de tool-call equivalência.

### D265 — Persistência: in-memory default, JSON disk opt-in via `persistence: { dir }`

**Decision:** Default `InMemoryCacheStore` (Map + LRU). Opt-in `persistence: { backend: "json", dir: ".theokit/cache" }` usa `atomicWriteJson` (D60) + `readVersionedJson` (D62). Serialização: KV map + vector list em arquivos separados por namespace (`<dir>/<namespace>.json`).

**Rationale:** Espelha D235 (workflows). Pattern validado: most caches são in-process and die com process. Disk-backed é opt-in para survive restarts. SQLite/Redis backends ficam v1.x (D143-style adapter pattern).

**Consequences:** Tests cobrem ambos (in-mem + json). Schema versioning protege upgrades. Eviction trigger on read (mark dirty) + flush on shutdown. Documentar trade-off (disk read latency vs memory cap).

## Dependency Graph

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4
(ADRs)     (Surface)  (Storage)   (Plugin)    (TTL+cat)
                            │           │           │
                            └─────┬─────┴───────────┘
                                  ▼
                            Phase 5 (Telemetry)
                                  │
                                  ▼
                            Phase 6 (Examples + telegram-pro)
                                  │
                                  ▼
                            Phase 7 (Dogfood QA)
```

**Parallel:** Phase 4 (TTL) e Phase 5 (Telemetry) podem rodar simultaneamente após Phase 3.
**Sequencial obrigatório:** 0 → 1 → 2 → 3.

---

## Phase 0: Setup e ADRs

**Objective:** Registrar D249-D265 (17 ADRs) e marcar item #6 como Em progresso.

### T0.1 — Escrever 17 ADRs + atualizar CLAUDE.md

#### Objective
Materializar cada decisão acima como arquivo Markdown sob `.claude/knowledge-base/adrs/D249-*.md` a `D265-*.md`. Apêndar linhas em CLAUDE.md table.

#### Evidence
Padrão validado: D202-D213 (Eval), D214-D229 (Handoffs), D230-D248 (Workflows) — cada um tem rows na tabela CLAUDE.md.

#### Files to edit
```
.claude/knowledge-base/adrs/D249-cache-class-factory-asplugin.md (NEW)
.claude/knowledge-base/adrs/D250-cache-as-plugin-kind.md (NEW)
.claude/knowledge-base/adrs/D251-reuse-memory-embedding-adapter.md (NEW)
.claude/knowledge-base/adrs/D252-layered-kv-plus-semantic.md (NEW)
.claude/knowledge-base/adrs/D253-composite-cache-key.md (NEW)
.claude/knowledge-base/adrs/D254-threshold-default-0.85-no-adaptive.md (NEW)
.claude/knowledge-base/adrs/D255-ttl-per-category-exclude-regex.md (NEW)
.claude/knowledge-base/adrs/D256-streaming-cache-deferred.md (NEW)
.claude/knowledge-base/adrs/D257-cache-per-agent-not-global.md (NEW)
.claude/knowledge-base/adrs/D258-embedder-namespace-versioning.md (NEW)
.claude/knowledge-base/adrs/D259-kv-pre-filter-semantic-fallback.md (NEW)
.claude/knowledge-base/adrs/D260-hook-points-pre-user-post-reply.md (NEW)
.claude/knowledge-base/adrs/D261-lru-eviction-default-1000.md (NEW)
.claude/knowledge-base/adrs/D262-telemetry-cache-spans.md (NEW)
.claude/knowledge-base/adrs/D263-compose-with-anthropic-prompt-caching.md (NEW)
.claude/knowledge-base/adrs/D264-false-positive-risk-documented.md (NEW)
.claude/knowledge-base/adrs/D265-persistence-memory-default-json-optin.md (NEW)
.claude/knowledge-base/adrs/D266-skip-cache-when-tool-use.md (NEW, added post edge-case review)
CLAUDE.md (MODIFY: add 18 rows to ADR table; bump Adoption Roadmap #6 to "Em progresso")
```

#### Deep file dependency analysis
- ADRs são standalone; nenhum import.
- CLAUDE.md table append-only.
- Roadmap entry #6 status muda de "Pendente" para "Em progresso 2026-05-22".

#### Tasks
1. Criar 17 arquivos D249-D265 seguindo template Decision/Rationale/Consequences.
2. Apêndar 17 linhas à tabela "Decided ADRs" em CLAUDE.md.
3. Atualizar Roadmap entry #6.

#### TDD
```
N/A — ADRs são documentação. Validation: ls .claude/knowledge-base/adrs/D2{49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65}-*.md | wc -l == 17
```

#### Acceptance Criteria
- [ ] 17 arquivos D249-D265 existem.
- [ ] CLAUDE.md table tem 17 novas linhas.
- [ ] Roadmap entry #6 → "Em progresso 2026-05-22".

#### DoD
- [ ] Commit verde.
- [ ] `grep -c "^| D2[56][0-9] " CLAUDE.md` retorna ≥ 17.

---

## Phase 1: Public Surface

**Objective:** `Cache` class + types + `Cache.semantic` factory.

### T1.1 — `types/cache.ts` — public type contract

#### Objective
Definir `CacheSemanticOptions`, `CacheEntry`, `CacheStats`, `CacheError` classes.

#### Evidence
Padrão em `types/eval.ts`, `types/workflow.ts`, `types/handoff.ts`.

#### Files to edit
```
packages/sdk/src/types/cache.ts (NEW)
packages/sdk/src/types/index.ts (MODIFY: add `export type * from "./cache.js"`)
```

#### Deep Dives

```typescript
import type { MemoryEmbeddingProviderAdapter, EmbeddingRuntime } from "../internal/memory/embedding-adapter.js";

export interface CacheTTLConfig {
  /** Default TTL applied to all entries when no category matches. */
  readonly default: string | number; // "1h" | 3600 (seconds)
  /** Per-category overrides — caller marks via metadata. */
  readonly categories?: Record<string, string | number>;
  /** Regex marking queries that must NEVER be cached. */
  readonly exclude?: RegExp;
}

export interface CachePersistenceOptions {
  readonly backend: "memory" | "json";
  readonly dir?: string;
}

export interface CacheSemanticOptions {
  /** Embedder — instance OR factory opts. Default = autoselect. */
  readonly embedder?: EmbeddingRuntime | { provider: string; model?: string };
  /** Cosine distance threshold. Default 0.85; lower = stricter. */
  readonly threshold?: number;
  /** TTL config. Default { default: "1h" }. */
  readonly ttl?: CacheTTLConfig;
  /** Multi-tenant namespace. Default "global". */
  readonly namespace?: string;
  /** Max entries (LRU eviction). Default 1000. */
  readonly maxEntries?: number;
  /** Persistence backend. Default in-memory. */
  readonly persistence?: CachePersistenceOptions;
}

export interface CacheEntry {
  readonly key: string; // composite hash
  readonly namespace: string;
  readonly embedderId: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly response: string;
  readonly vector: ReadonlyArray<number>;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly accessedAt: number;
  readonly accessCount: number;
}

export interface CacheStats {
  readonly entries: number;
  readonly kvHits: number;
  readonly semanticHits: number;
  readonly misses: number;
  readonly excluded: number;
  readonly evicted: number;
}

export class CacheNotInitializedError extends Error {
  override readonly name = "CacheNotInitializedError";
  constructor() {
    super("Cache must be initialized via Cache.semantic({...}) before use.");
  }
}

export class CacheEmbedderError extends Error {
  override readonly name = "CacheEmbedderError";
  constructor(message: string, public readonly cause?: Error) {
    super(`Cache embedder failed: ${message}`);
  }
}
```

#### Tasks
1. Criar `types/cache.ts` com as 8 interfaces + 2 error classes.
2. Re-exportar via `types/index.ts`.
3. `pnpm typecheck` verde.

#### TDD
```
RED:
  - cache_types_compile_with_strict_mode
  - cache_persistence_dir_required_for_json_backend (compile-time guard via refine)
GREEN: Define types.
REFACTOR: None expected.
VERIFY: pnpm -F @usetheo/sdk typecheck
```

#### Acceptance Criteria
- [ ] `types/cache.ts` ≤ 150 LoC.
- [ ] Zero import cycles.
- [ ] Re-exported via `types/index.ts`.

#### DoD
- [ ] `pnpm -F @usetheo/sdk typecheck` verde.

---

### T1.2 — `cache.ts` — public `Cache` class + `Cache.semantic` factory

#### Objective
Implementar `Cache.semantic(opts)` retornando instância com `.asPlugin()`.

#### Files to edit
```
packages/sdk/src/cache.ts (NEW)
packages/sdk/src/index.ts (MODIFY: re-export Cache + errors + types)
```

#### Deep Dives

```typescript
import { z } from "zod";
import type { Plugin } from "./internal/plugins/types.js";
import type { CacheSemanticOptions, CacheStats } from "./types/cache.js";

const CacheSemanticOptionsSchema = z.object({
  embedder: z.unknown().optional(),
  threshold: z.number().min(0).max(2).optional(), // cosine distance
  ttl: z.object({
    default: z.union([z.string(), z.number()]),
    categories: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    exclude: z.instanceof(RegExp).optional(),
  }).optional(),
  namespace: z.string().min(1).max(64).optional(),
  maxEntries: z.number().int().min(1).max(1_000_000).optional(),
  persistence: z.object({
    backend: z.enum(["memory", "json"]),
    dir: z.string().optional(),
  }).refine((p) => p.backend !== "json" || (typeof p.dir === "string" && p.dir.length > 0), {
    message: 'persistence.dir is required when backend = "json"',
  }).optional(),
});

export class Cache {
  private constructor(
    private readonly options: CacheSemanticOptions,
    private readonly store: CacheStore, // internal
  ) {}

  static semantic(options: CacheSemanticOptions = {}): Cache {
    CacheSemanticOptionsSchema.parse(options);
    const store = createCacheStore(options); // lazy in internal/cache/store.ts
    return new Cache(options, store);
  }

  private _plugin?: Plugin; // EC-4: memoize so repeated asPlugin() calls return the same descriptor

  asPlugin(): Plugin {
    if (this._plugin !== undefined) return this._plugin;
    this._plugin = {
      kind: "cache",
      name: `cache-${this.options.namespace ?? "global"}`,
      hooks: {
        pre_user_send: (ctx) => this.lookup(ctx),
        post_assistant_reply: (ctx) => this.store_(ctx),
      },
    } as Plugin;
    return this._plugin;
  }

  stats(): CacheStats { return this.store.stats(); }
  async clear(): Promise<void> { await this.store.clear(); }

  private async lookup(ctx: unknown): Promise<unknown> { /* impl Phase 3 */ }
  private async store_(ctx: unknown): Promise<void> { /* impl Phase 3 */ }
}
```

#### Tasks
1. Implementar `Cache` class.
2. Zod validation.
3. Re-export tudo no index.ts.

#### TDD
```
RED:
  - cache_semantic_validates_options
  - cache_semantic_threshold_out_of_range_rejected
  - cache_semantic_persistence_json_without_dir_rejected
  - cache_asPlugin_returns_plugin_with_kind_cache
  - EC-4: cache_asPlugin_returns_same_descriptor_on_repeat_calls
  - EC-12: cache_threshold_zero_rejects_all + cache_threshold_one_accepts_anything
GREEN: implement.
VERIFY: pnpm test tests/cache/cache-create.test.ts
```

#### Acceptance Criteria
- [ ] `cache.ts` ≤ 200 LoC.
- [ ] 4+ tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 2: Internal Cache Store (KV + Vector)

**Objective:** Layered storage com KV exact + vector semantic search.

### T2.1 — `internal/cache/store.ts` — interface + InMemory backend

#### Files to edit
```
packages/sdk/src/internal/cache/store.ts (NEW)
packages/sdk/src/internal/cache/store-memory.ts (NEW)
packages/sdk/src/internal/cache/cosine.ts (NEW)
packages/sdk/src/internal/cache/lru.ts (NEW)
packages/sdk/src/internal/cache/key.ts (NEW)
```

#### Deep Dives

**Store interface:**
```typescript
export interface CacheStore {
  /** KV exact lookup. O(1). */
  kvGet(key: string): CacheEntry | undefined;
  /** Vector semantic search. Returns top-1 if distance ≤ threshold. */
  semanticSearch(vector: number[], threshold: number): { entry: CacheEntry; distance: number } | undefined;
  /** Insert / update. LRU touched. */
  set(entry: CacheEntry): void;
  /** Remove by key. */
  delete(key: string): void;
  /** Clear all. */
  clear(): Promise<void>;
  /** Stats snapshot. */
  stats(): CacheStats;
  /** Evict expired entries. Returns count evicted. */
  evictExpired(now: number): number;
}
```

**InMemory backend:** `Map<key, CacheEntry>` + LRU doubly-linked list + linear vector scan iterando `[...this.map.values()]` (O(N); for v1, OK até 10k entries).

**INVARIANT (EC-9, EC-13):** vector search e KV map são o MESMO `Map` — `semanticSearch` itera `Map.values()`, NUNCA uma lista paralela. Garante single source of truth, eliminando race entre kv-set e vector-append duplicado.

**Dim mismatch guard (EC-2):** `semanticSearch` filtra entries por `entry.embedderId === currentEmbedderId && entry.vector.length === vector.length` ANTES do cosine compare. Protege contra disk-loaded entries de embedder antigo:
```typescript
const candidates = [...this.map.values()].filter(
  (e) => e.embedderId === currentEmbedderId && e.vector.length === vector.length,
);
```

**Cosine distance:**
```typescript
export function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("dim mismatch");
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1.0;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

**Composite key:**
```typescript
export function computeCacheKey(p: {
  namespace: string;
  embedderId: string;
  modelId: string;
  prompt: string;
}): string {
  const normalized = p.prompt.trim().replace(/\s+/g, " ").toLowerCase();
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `${p.namespace}:${p.embedderId}:${p.modelId}:${hash}`;
}
```

#### Tasks
1. Implementar interface + InMemory.
2. Implementar cosine + LRU helpers.
3. Implementar key compute.

#### TDD
```
RED:
  - kv_get_returns_undefined_for_missing
  - kv_get_returns_entry_when_present
  - set_evicts_oldest_when_over_maxEntries
  - semantic_search_finds_within_threshold
  - semantic_search_returns_undefined_when_above_threshold
  - cosine_distance_orthogonal_vectors_equals_1
  - cosine_distance_same_vector_equals_0
  - computeCacheKey_deterministic_same_inputs
  - computeCacheKey_changes_when_namespace_differs
  - computeCacheKey_changes_when_embedder_differs
  - computeCacheKey_normalizes_whitespace
  - evictExpired_removes_only_expired
GREEN: implement.
VERIFY: pnpm test tests/cache/store-memory.test.ts tests/cache/cosine.test.ts tests/cache/key.test.ts
```

#### Acceptance Criteria
- [ ] 12 tests verde.
- [ ] Cyclomatic complexity ≤ 10 cada fn.

#### DoD
- [ ] Tests verde.

---

### T2.2 — `internal/cache/store-json.ts` — JSON disk-backed backend

#### Files to edit
```
packages/sdk/src/internal/cache/store-json.ts (NEW)
```

#### Deep Dives
Reusa `atomicWriteJson` (D60) + `readVersionedJson` (D62). 1 file per namespace: `<dir>/<namespace>.json` com schema:

**EC-7 absorbed:** load wraps `JSON.parse` em try/catch — arquivo corrompido (truncated write, manual edit, schema mismatch) loga warn UMA vez e trata como cache vazio. NUNCA propaga error pro construtor da Cache (que faria todos os `Agent.create` falharem na inicialização).
```typescript
try { parsed = JSON.parse(raw); }
catch (err) { console.warn(`[cache] corrupt snapshot at ${file}, starting fresh:`, err); parsed = { _schemaVersion: 1, entries: [] }; }
```
```typescript
{
  _schemaVersion: 1,
  namespace: string,
  entries: ReadonlyArray<CacheEntry>,
  evicted: number,
}
```

Eviction is lazy: read all → filter expired → keep latest N by accessedAt. Write back on `set` + debounce 200ms.

#### Tasks
1. Implementar JsonFileCacheStore.
2. Debounced flush.
3. Versioned read.

#### TDD
```
RED:
  - json_store_persists_across_reconstruct
  - json_store_loads_existing_namespace_file
  - json_store_schema_version_mismatch_throws
  - json_store_debounced_flush_within_300ms
GREEN: implement.
VERIFY: pnpm test tests/cache/store-json.test.ts
```

#### Acceptance Criteria
- [ ] 4 tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 3: Plugin Integration

**Objective:** Wire cache lookups + stores em `pre_user_send` + `post_assistant_reply` hooks.

### T3.1 — `Plugin.kind: "cache"` adicionado ao union

#### Files to edit
```
packages/sdk/src/internal/plugins/types.ts (MODIFY: add "cache" to PluginKind union)
```

#### Deep Dives
```typescript
export type Plugin =
  | { kind: "memory"; ... }
  | { kind: "telemetry"; ... }
  | ...
  | { kind: "cache"; name: string; hooks: { pre_user_send?: ...; post_assistant_reply?: ... } };
```

#### Tasks
1. Add discriminator.
2. Update PluginContext type if needed.

#### TDD
```
RED: plugin_kind_cache_compiles
GREEN: add.
VERIFY: pnpm typecheck
```

#### Acceptance Criteria
- [ ] Plugin union has "cache".

---

### T3.2 — Lookup logic em `cache.ts#lookup`

#### Files to edit
```
packages/sdk/src/cache.ts (MODIFY)
packages/sdk/src/internal/cache/lookup.ts (NEW)
```

#### Deep Dives
```typescript
async function performLookup(p: {
  prompt: string;
  store: CacheStore;
  embedder: EmbeddingRuntime;
  threshold: number;
  ttl: CacheTTLConfig;
  namespace: string;
  modelId: string;
}): Promise<{ cached: true; response: string } | { cached: false }> {
  // EC-3 absorbed: empty/whitespace prompt bypasses cache to avoid hash collision.
  if (p.prompt.trim().length === 0) return { cached: false };
  // Exclusion regex (D255)
  if (p.ttl.exclude !== undefined && p.ttl.exclude.test(p.prompt)) {
    return { cached: false };
  }
  const key = computeCacheKey({ namespace: p.namespace, embedderId: p.embedder.id, modelId: p.modelId, prompt: p.prompt });
  const now = Date.now();
  // Step 1: KV exact
  const kv = p.store.kvGet(key);
  if (kv !== undefined && kv.expiresAt > now) {
    return { cached: true, response: kv.response };
  }
  // Step 2: semantic — EC-1 absorbed: embedder failure degrades to miss (cache is transparent).
  let vec: number[];
  try {
    [vec] = await p.embedder.embed([p.prompt]);
  } catch (err) {
    console.warn(`[cache] embedder failed during lookup, degrading to miss:`, err instanceof Error ? err.message : err);
    return { cached: false };
  }
  const match = p.store.semanticSearch(vec, p.threshold, p.embedder.id);
  if (match !== undefined && match.entry.expiresAt > now) {
    return { cached: true, response: match.entry.response };
  }
  return { cached: false };
}
```

#### Tasks
1. Implement lookup.
2. Wire into Cache class.

#### TDD
```
RED:
  - lookup_kv_hit_returns_cached
  - lookup_semantic_hit_returns_cached
  - lookup_kv_expired_falls_through_to_semantic
  - lookup_above_threshold_returns_miss
  - lookup_exclusion_regex_skips_cache
  - EC-1: lookup_embedder_failure_degrades_to_miss_not_throw
  - EC-3: lookup_empty_or_whitespace_prompt_returns_miss
  - EC-2: lookup_skips_entries_with_different_embedderId_or_dim
GREEN: implement.
VERIFY: pnpm test tests/cache/lookup.test.ts
```

#### Acceptance Criteria
- [ ] 6 tests verde.

---

### T3.3 — Store logic em `cache.ts#store_`

#### Files to edit
```
packages/sdk/src/cache.ts (MODIFY)
packages/sdk/src/internal/cache/store-handler.ts (NEW)
```

#### Deep Dives
```typescript
async function performStore(p: {
  prompt: string;
  response: string;
  usedTools: boolean; // D266 / EC-10
  store: CacheStore;
  embedder: EmbeddingRuntime;
  ttl: CacheTTLConfig;
  namespace: string;
  modelId: string;
}): Promise<void> {
  // EC-3: empty prompt bypass
  if (p.prompt.trim().length === 0) return;
  // EC-10 / D266: don't cache runs that invoked tools (replay would lose side-effects)
  if (p.usedTools) return;
  // Exclusion regex (D255)
  if (p.ttl.exclude !== undefined && p.ttl.exclude.test(p.prompt)) return;
  const key = computeCacheKey({...});
  // EC-1: embedder failure during store degrades silently (no cache entry, but the LLM call already succeeded)
  let vec: number[];
  try {
    [vec] = await p.embedder.embed([p.prompt]);
  } catch (err) {
    console.warn(`[cache] embedder failed during store, skipping cache write:`, err instanceof Error ? err.message : err);
    return;
  }
  const now = Date.now();
  const ttlMs = parseTtl(p.ttl.default); // "1h" → 3_600_000
  p.store.set({
    key,
    namespace: p.namespace,
    embedderId: p.embedder.id,
    modelId: p.modelId,
    prompt: p.prompt,
    response: p.response,
    vector: vec,
    createdAt: now,
    expiresAt: now + ttlMs,
    accessedAt: now,
    accessCount: 0,
  }); // EC-13: store.set MUST replace by key (Map semantics) — no parallel list append.
}
```

#### Tasks
1. Implement store_.
2. Wire into Cache.

#### TDD
```
RED:
  - store_inserts_entry_with_correct_ttl
  - store_skips_excluded_prompts
  - store_overwrites_existing_key
  - store_uses_namespace_in_key
  - EC-10: store_skips_runs_that_used_tools
  - EC-3: store_skips_empty_prompt
  - EC-1: store_silently_skips_on_embedder_failure
  - EC-13: store_replaces_existing_key_in_place (no parallel list duplicates)
GREEN: implement.
VERIFY: pnpm test tests/cache/store-handler.test.ts
```

#### Acceptance Criteria
- [ ] 4 tests verde.

---

## Phase 4: TTL Parser + Category Tagging

**Objective:** TTL string parser + category mapping via metadata.

### T4.1 — `internal/cache/ttl.ts` — TTL string parser

#### Files to edit
```
packages/sdk/src/internal/cache/ttl.ts (NEW)
```

#### Deep Dives
Parse `"1h"` → 3_600_000ms, `"15m"` → 900_000ms, `"7d"` → 604_800_000ms. Accept also plain numbers (seconds). Reject malformed strings.

```typescript
const TTL_PATTERN = /^(\d+)\s*(s|m|h|d|w)$/i;
export function parseTtl(input: string | number): number {
  if (typeof input === "number") return input * 1000; // seconds → ms
  const m = TTL_PATTERN.exec(input.trim());
  if (m === null) throw new Error(`Invalid TTL: "${input}"`);
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60_000;
    case "h": return value * 3_600_000;
    case "d": return value * 86_400_000;
    case "w": return value * 604_800_000;
    default: throw new Error(`unreachable`);
  }
}
```

#### Tasks
1. Parser.
2. Tests for all unit suffixes.

#### TDD
```
RED:
  - parseTtl_seconds_to_ms
  - parseTtl_minutes_hours_days_weeks
  - parseTtl_number_input_treated_as_seconds
  - parseTtl_invalid_string_throws
  - EC-8: parseTtl_zero_returns_zero_and_documented_as_no_cache
  - EC-8: parseTtl_negative_number_throws
GREEN: implement.
VERIFY: pnpm test tests/cache/ttl.test.ts
```

#### Acceptance Criteria
- [ ] 4 tests verde.

---

## Phase 5: Telemetry

**Objective:** OTel spans for observability.

### T5.1 — `internal/cache/telemetry.ts`

#### Files to edit
```
packages/sdk/src/internal/cache/telemetry.ts (NEW)
packages/sdk/src/internal/cache/lookup.ts (MODIFY: emit spans)
packages/sdk/src/internal/cache/store-handler.ts (MODIFY: emit spans)
```

#### Deep Dives
Pattern direto de `internal/workflow/telemetry.ts`. Spans: `cache.lookup` (root), `cache.hit.kv` / `cache.hit.semantic` / `cache.miss` (events on the lookup span). Attributes: `cache.namespace`, `cache.embedder_id`, `cache.threshold`, `cache.distance` (when semantic hit), `cache.ttl_remaining_s`.

#### Tasks
1. Telemetry helper.
2. Wire in lookup + store.

#### TDD
```
RED:
  - telemetry_lookup_span_starts_and_ends
  - telemetry_emits_hit_attribute_on_kv_hit
  - telemetry_emits_distance_attribute_on_semantic_hit
  - telemetry_emits_miss_attribute_on_miss
  - telemetry_noop_when_otel_unavailable
  - EC-5: telemetry_span_ends_in_finally_on_exclusion_regex_early_exit
  - EC-5: telemetry_span_ends_in_finally_on_embedder_failure_early_exit
GREEN: implement.
VERIFY: pnpm test tests/cache/telemetry.test.ts
```

#### Acceptance Criteria
- [ ] 5 tests verde.

---

## Phase 6: Examples + telegram-pro `/cache_demo` + docs.md

### T6.1 — `examples/cache/` standalone example

#### Files to edit
```
examples/cache/package.json (NEW)
examples/cache/.env.example (NEW)
examples/cache/run.ts (NEW)
examples/cache/README.md (NEW)
```

#### Deep Dives
`run.ts` demonstra:
1. Create cache.
2. Create agent with `plugins: [cache.asPlugin()]`.
3. Send "What is the capital of France?" → miss (LLM called).
4. Send "Tell me the capital of France" → hit (semantic match, LLM not called).
5. Send "What's the weather in SF?" → bypassed (exclusion regex).
6. Print stats: kvHits / semanticHits / misses / excluded.

#### TDD
```
N/A — example. Verification: pnpm run run completes; printed stats show ≥ 1 semanticHit.
```

#### Acceptance Criteria
- [ ] Example runs end-to-end with real LLM.
- [ ] README explains pattern.

---

### T6.2 — `/cache_demo` no telegram-pro

#### Files to edit
```
examples/telegram-pro/src/index.ts (MODIFY: add /cache_demo command + /help entry)
.claude/skills/dogfood/lib/dogfood.mjs (MODIFY: add /cache_demo to suite)
```

#### Deep Dives
`/cache_demo` accepts a question + a paraphrase. Sends both. Reports:
- Q1 status (miss expected).
- Q2 status (hit expected; same answer).
- Stats summary: kvHits, semanticHits, misses.

**EC-11 absorbed:** The reply text MUST include literal `semanticHits=N` (regex-scrapable) so the dogfood CDP scraper can verify runtime-metric proof without OTel access. Example final reply line: `Final: kvHits=0 semanticHits=1 misses=1 excluded=0 evicted=0`.

Dogfood suite entry:
```javascript
{
  text: "/cache_demo What is the capital of France?",
  expect: [/Cache demo|miss|hit|semantic|kvHits/i],
  waitMs: 60000,
  retryOnError: true,
}
```

#### Tasks
1. Add command.
2. Add to /help.
3. Add to dogfood suite.

#### Acceptance Criteria
- [ ] Command works end-to-end.
- [ ] Dogfood passes.

---

### T6.3 — `docs.md` seção "Semantic cache (v1.18+)"

#### Files to edit
```
docs.md (MODIFY: add section after Workflows)
```

#### Deep Dives
Cover:
- Quickstart: `Cache.semantic({ ... }).asPlugin()`.
- Threshold tuning guidance (0.85 default, 0.95 for high-stakes).
- TTL config + exclusion regex (with examples).
- Composition with Anthropic prompt_caching (orthogonal layers).
- v1 limitations (no streaming cache, no adaptive threshold, no LLM-judge).

---

## Phase 7: Dogfood QA (MANDATORY)

**Objective:** Validate end-to-end via telegram-pro.

### Execution
```bash
pnpm -F @usetheo/sdk build
# refresh telegram-pro link (zod symlink, dist copy)
ps aux | grep tsx.*telegram-pro | awk '{print $2}' | xargs -r kill -9
cd examples/telegram-pro && nohup pnpm tsx --env-file=.env src/index.ts > /tmp/tgpro-cache.log 2>&1 & disown
sleep 12 && grep "Connected as" /tmp/tgpro-cache.log
cd /home/paulo/Projetos/usetheo/theokit-sdk
node .claude/skills/dogfood/lib/dogfood.mjs --user-id 7528967933
```

### Acceptance Criteria
- [ ] Total ≥ 45 commands.
- [ ] PASS ≥ 44.
- [ ] FAIL = 0.
- [ ] `/cache_demo` PASSES in < 30s.
- [ ] OTel span `cache.hit.semantic` observed at least once (runtime-metric proof).

### Runtime-metric proof
- `cache.stats().semanticHits > 0` after 2-paraphrase scenario.
- OTel span attribute `cache.distance < threshold` recorded.

### If Dogfood Fails
1. Identify root cause (cache-related vs flake).
2. Fix cache code; re-run.
3. Pre-existing issues documented separately.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Semantic similarity matching | T2.1, T3.2 | cosine + threshold layered with KV pre-filter |
| 2 | TTL configuration | T4.1, T1.1 | parseTtl + per-category overrides + exclude regex |
| 3 | Multi-tenant isolation | T2.1 (key) | namespace in composite key |
| 4 | Reuse existing embedders | T1.1, T3.2 | MemoryEmbeddingProviderAdapter injectable |
| 5 | Plugin-based opt-in | T3.1, T1.2 | Plugin kind "cache" + asPlugin() |
| 6 | In-memory + JSON persistence | T2.1, T2.2 | InMemoryCacheStore + JsonFileCacheStore |
| 7 | Telemetry / observability | T5.1 | OTel spans cache.lookup + hit/miss attributes |
| 8 | Cross-embedder invalidation | T2.1 (key) | embedderId baked in cache key |
| 9 | False positive risk documented | D264 (ADR) | docs.md "v1 limitations" section |
| 10 | Composition with prompt_caching | T6.3 (docs) | docs.md section explaining orthogonal layers |
| 11 | Example + telegram-pro integration | T6.1, T6.2 | /cache_demo + examples/cache/ |
| 12 | LRU eviction | T2.1 | configurable maxEntries with default 1000 |
| 13 | Exclusion regex for time-sensitive queries | T3.2, T3.3 | exclude regex check before lookup/store |
| 14 | Per-model isolation | T2.1 (key) | modelId in composite key |
| 15 | 18 ADRs registered (post edge-case review) | T0.1 | D249-D266 |
| 18 | Don't cache tool-use runs (EC-10) | T3.3, D266 | usedTools flag skips store; documented in docs.md |
| 16 | Zod-validated public API | T1.2 | CacheSemanticOptionsSchema |
| 17 | Dogfood validated | Phase 7 | telegram-pro /cache_demo |

**Coverage: 18/18 gaps covered (100%)** (post edge-case review: +1 D266 for tool-use cache exclusion)

## Global Definition of Done

- [ ] All 7 phases completed.
- [ ] ≥ 40 unit tests passing.
- [ ] Zero biome warnings in `packages/sdk/src/internal/cache/` and `packages/sdk/src/cache.ts`.
- [ ] Build CJS + ESM + DTS green.
- [ ] Backward compat: zero break in existing Agent / Eval / Handoff / Workflow / Cron.
- [ ] 18 ADRs registered (D249-D266 — D266 added post edge-case review).
- [ ] CLAUDE.md Adoption Roadmap entry #6 → ✅ DONE 2026-05-22.
- [ ] `docs.md` Semantic cache section added.
- [ ] `examples/cache/` real-LLM validated.
- [ ] **Dogfood QA PASS** — telegram-pro ≥ 44/45 PASS, 0 FAIL, `/cache_demo` PASSES.
- [ ] **Runtime-metric proof** — `cache.stats().semanticHits > 0` observed in real workload + OTel `cache.distance` attribute recorded.

## Final Phase: Dogfood QA (MANDATORY)

See Phase 7 above. Run `/dogfood full`. The plan is NOT done until dogfood passes with semantic hit observed at runtime.
