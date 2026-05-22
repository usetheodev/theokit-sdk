# Edge Case Review — semantic-cache

Data: 2026-05-22
Tasks analisadas: 13 (T0.1, T1.1, T1.2, T2.1, T2.2, T3.1, T3.2, T3.3, T4.1, T5.1, T6.1, T6.2, T6.3)
Edge cases encontrados: 13 (MUST FIX: 7, SHOULD TEST: 3, DOCUMENT: 3)

---

## MUST FIX

### EC-1: Embedder API failure inside `lookup` mata a chamada do agente

- **Task afetada:** T3.2 (lookup) e T3.3 (store)
- **Família:** I/O / Network
- **Cenário:** `embedder.embed([prompt])` joga `NetworkError`, `RateLimitError` ou `AuthenticationError` (provider down, quota exceeded, key inválida). O hook `pre_user_send` propaga essa exceção pro agent loop, e `agent.send()` rejeita inteiramente — **mesmo que o LLM esteja saudável**. Cache vira ponto único de falha.
- **Impacto:** Cache deve ser transparente em falha. Cliente perde acesso ao LLM porque um service auxiliar caiu. Em prod isso é incident-level.
- **Fix sugerido:** Wrap embedder em try/catch em `performLookup` e `performStore`. Em erro: log+warn uma vez e retornar `{ cached: false }` (lookup) ou skip silencioso (store). 3 linhas cada:
  ```typescript
  let vec: number[];
  try { [vec] = await p.embedder.embed([p.prompt]); }
  catch (err) { console.warn(`[cache] embedder failed, degrading to miss:`, err); return { cached: false }; }
  ```

### EC-2: Dimension mismatch quando entries antigas têm embedder diferente

- **Task afetada:** T2.1 (`semanticSearch`) e T2.2 (JSON store load)
- **Família:** Format / Boundary
- **Cenário:** D258 diz "embedder change invalidates via namespace", mas se o usuário trocar o embedder SEM trocar o namespace explicitamente, OR se o JSON disk-backed cache for carregado com entries de embedder antigo, `cosineDistance(a, b)` joga `Error: dim mismatch` porque os vectors têm tamanhos diferentes (1536 vs 384).
- **Impacto:** Cache crash em todo lookup. Pior em prod: aparece só depois que disk-backed cache acumulou entries de release anterior.
- **Fix sugerido:** Em `semanticSearch`, filtrar entries por `entry.embedderId === currentEmbedder.id` antes do cosine compare. 1 linha:
  ```typescript
  const candidates = [...this.map.values()].filter((e) => e.embedderId === currentEmbedderId && e.vector.length === vector.length);
  ```

### EC-3: Prompt vazio gera hash determinístico → cache poisoning

- **Task afetada:** T2.1 (`computeCacheKey`) e T3.2/T3.3 (lookup/store)
- **Família:** Input
- **Cenário:** `agent.send("")` ou `agent.send("   ")` normaliza para `""`. Hash é sempre o mesmo. KV hit com qualquer coisa que foi armazenada anteriormente sob essa chave. Pior cenário: response previamente cacheada para query trivial vira default pra qualquer empty input.
- **Impacto:** Cache poisoning + responses corruptas pra prompts vazios. Não-determinismo em testes.
- **Fix sugerido:** No início de `performLookup` e `performStore`, bypass se prompt vazio. 1 linha:
  ```typescript
  if (p.prompt.trim().length === 0) return { cached: false };
  ```

### EC-4: `cache.asPlugin()` chamado N vezes registra N hooks duplicados

- **Task afetada:** T1.2 (`asPlugin`)
- **Família:** State / Idempotency
- **Cenário:** Usuário escreve `Agent.create({ plugins: [cache.asPlugin(), cache.asPlugin()] })` (por engano OU por composição de helpers). Cada call mints um novo plugin descriptor, e o agent loop invoca o handler 2x → 2 lookups + 2 stores por turn. Custo de embedder API dobra.
- **Impacto:** Custo silenciosamente dobra/triplica conforme `asPlugin()` é chamado. Difícil de debugar.
- **Fix sugerido:** Memoizar o plugin descriptor (cached field). 3 linhas:
  ```typescript
  private _plugin?: Plugin;
  asPlugin(): Plugin {
    if (this._plugin === undefined) this._plugin = { kind: "cache", name: `cache-${...}`, hooks: {...} };
    return this._plugin;
  }
  ```

### EC-7: JSON store corrompido (truncated/edited) crasha o agente na inicialização

- **Task afetada:** T2.2 (`JsonFileCacheStore` load)
- **Família:** Format / I/O
- **Cenário:** Disk write interrompido a meio (SIGKILL, disk full), OR usuário edita manualmente `<dir>/<namespace>.json` e quebra o JSON. Próximo `Cache.semantic({ persistence: { backend: "json" } })` chama `JSON.parse(raw)` que joga `SyntaxError`. Cache nunca instancia → todos `Agent.create` falham.
- **Impacto:** Bot/app não sobe após crash. Single point of failure no startup.
- **Fix sugerido:** No load do JSON store, catch parse error e tratar como cache vazio. 3 linhas:
  ```typescript
  try { parsed = JSON.parse(raw); }
  catch (err) { console.warn(`[cache] corrupt snapshot at ${file}, starting fresh:`, err); return /* empty */; }
  ```

### EC-10: Cachear respostas que envolveram tool calls perde a execução interna

- **Task afetada:** T3.3 (store)
- **Família:** Semantics / Correctness
- **Cenário:** `agent.send("delete file X")` chama tool `fs.delete`, retorna "deleted". Cache armazena `response = "deleted"`. Próxima chamada paráfrase "remove file X" → cache hit → retorna "deleted" SEM chamar a tool. **Arquivo não é deletado, mas usuário acha que foi.** Silent corruption.
- **Impacto:** Cache replay perde side-effects. Cenários transacionais (delete/create/send-email) corrompem state real.
- **Fix sugerido:** Em `performStore`, skip storage se o run usou tools. Caller passa `meta.usedTools: boolean` via context, OU plugin inspeciona `result.toolCalls.length > 0`. 3 linhas:
  ```typescript
  if (ctx.result?.usedTools === true) return; // don't cache side-effect-ful runs
  ```
  Adicionar ADR (D266) explicando esse trade-off.

### EC-13: Race de stores concurrent com mesma chave bloata vector list

- **Task afetada:** T2.1 (`set`)
- **Família:** Concurrency
- **Cenário:** Dois `agent.send("X")` simultâneos → ambos hit miss → ambos chamam `store.set(entry)` com mesmo `key` mas vectors potencialmente diferentes (embedder pode ser non-deterministic). KV map overwrites OK, mas se o vector list for separado, vira 2 entries pra mesma key → lookup retorna primeira encontrada inconsistentemente.
- **Impacto:** Memory bloat ao longo do tempo. Inconsistência entre KV e vector views.
- **Fix sugerido:** Em `store.set`, se a key já existe, replace IN-PLACE (não append). Garantir que vector list e KV map sejam **o mesmo Map** (single source of truth — vector search itera `Map.values()`). 1 linha:
  ```typescript
  this.map.set(entry.key, entry); // Map.set replaces; vector iteration via [...this.map.values()] is consistent
  ```

---

## SHOULD TEST

### EC-5: Telemetry span ends in finally on early exit (exclusion regex)

- **Task afetada:** T5.1
- **Teste sugerido:** `telemetry_lookup_span_ends_when_exclusion_regex_hits` — assert que `span.end()` é chamado mesmo quando `exclude` regex faz early-return ANTES do embed/search. Sem `finally`, span vaza recursos OTel.

### EC-8: TTL `"0s"` / `"0h"` / número negativo

- **Task afetada:** T4.1 (`parseTtl`)
- **Teste sugerido:** `parseTtl_zero_or_negative_handled_explicitly` — assert que `parseTtl("0s")` retorna 0 (efectivamente desabilita cache) **OU** que lança erro com mensagem clara. Decidir antes de implementar. `parseTtl(-1)` deve throw. Documentar comportamento no docs.md.

### EC-12: Threshold bounds — 0.0 (rejeita tudo) e 1.0+ (aceita tudo)

- **Task afetada:** T1.2 (validation), T2.1 (search)
- **Teste sugerido:** `threshold_zero_rejects_all_semantic_hits` + `threshold_one_accepts_anything` — confirmar comportamento de bordas. Zod valida `.min(0).max(2)` mas semantics em bordas pode confundir. Test documenta intent.

---

## DOCUMENT

### EC-6: Sem single-flight em concurrent lookups — risco aceito

- **Risco aceito:** Dois `agent.send("X")` simultâneos resultam em 2 embed calls + 2 LLM calls (ambos miss). Single-flight per cache key exigiria coordenação extra (Map<key, Promise>) e adiciona complexidade. Em prod isso é minoritário — mesma query exata simultaneamente é raro fora de stress tests. Documentar como limitação v1; v1.x pode adicionar single-flight via pattern D213/D242 (Eval/Workflow já têm).

### EC-9: KV + vector view devem ser single source of truth

- **Risco aceito:** O plano menciona "KV map + vector list" como conceitos separados, mas implementação correta exige que vector search itere o MESMO Map (não uma cópia/lista paralela). Documentar como invariant na T2.1: `semanticSearch` usa `[...this.map.values()]`. Adicionar essa nota no plano + na implementação (`// INVARIANT: vector search reads from the same Map as KV lookups`).

### EC-11: `/cache_demo` deve imprimir `cache.stats()` ao final para dogfood scraping

- **Risco aceito:** O plano diz "OTel span cache.hit.semantic observed at least once" mas o dogfood scraper (CDP DOM read) não tem acesso a OTel spans. Mitigation: `/cache_demo` no telegram-pro deve imprimir as stats no reply final (`kvHits=0 semanticHits=1 misses=1`). Dogfood scraper bate na regex `/semanticHits[=:]\s*\d+/`. Adicionar isso ao T6.2 spec.

---

## Resumo

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 1 | 1 (EC-4) | 0 | 0 |
| T2.1 | 3 | 2 (EC-2, EC-13) | 0 | 1 (EC-9) |
| T2.2 | 1 | 1 (EC-7) | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 3 | 2 (EC-1, EC-3) | 0 | 1 (EC-6) |
| T3.3 | 2 | 2 (EC-1 dup, EC-10) | 0 | 0 |
| T4.1 | 1 | 0 | 1 (EC-8) | 0 |
| T5.1 | 1 | 0 | 1 (EC-5) | 0 |
| T6.1 | 0 | 0 | 0 | 0 |
| T6.2 | 1 | 0 | 0 | 1 (EC-11) |
| T6.3 | 0 | 0 | 0 | 0 |
| (xs) | 1 | 0 | 1 (EC-12) | 0 |
| **Total** | **13** | **7** | **3** | **3** |

**Veredicto:** PLANO OK COM AJUSTES — absorver os 7 MUST FIX como sub-tasks ANTES de iniciar implementação. Cada um é 1-3 linhas de código. SHOULD TEST adicionados aos TDD blocks. DOCUMENT integrados como invariants no plano + docs.md.

**Nenhum MUST FIX exige nova camada de abstração** — todos são guards/early-returns/cached fields. KISS preservado.

**Notas pragmáticas:**

- EC-1 (graceful degradation em embedder failure) é o mais crítico — protege contra "cache acidentalmente derruba o app" que documentei como anti-pattern em pesquisa.
- EC-10 (não cachear tool-use runs) merece um ADR próprio (sugiro D266) — é uma decisão semântica significativa, não só guard.
- EC-2 (dim filter) e EC-7 (corrupt JSON) são "failures de upgrade" comuns em prod — cliente sobe versão nova com embedder/format diferente. Ambos resolvem-se com 1-3 linhas.
- EC-13 (race + bloat) só importa se vector list for separada do Map. Documentando como single-source-of-truth (EC-9) o problema some.
