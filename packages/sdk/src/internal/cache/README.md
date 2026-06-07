# `@theokit/sdk` — `internal/cache/`

The cache subsystem implements semantic + exact-key LLM response caching as an opt-in plugin (ADR D249-D266). Backed by `CacheStore` interface with multiple in-tree implementations (JSON file, in-memory).

## Files

| File | Responsibility |
|---|---|
| `store.ts` | `CacheStore` interface — the public contract every backend implements |
| `store-json.ts` | JSON-file backend (default for opt-in cache plugin) |
| `store-handler.ts` | Hook wiring for `pre_user_send` / `post_assistant_reply` cache lifecycle (ADR D260) |
| `lookup.ts` | Semantic similarity scoring + KV exact-key pre-filter (ADR D252/D259) |
| `cosine.ts` | Vector cosine similarity primitive |
| `embed-helper.ts` | Wraps `MemoryEmbeddingProviderAdapter` reuse (ADR D251) — no parallel embedding stack |
| `key.ts` | Composite cache key construction `${namespace}:${embedderId}:${modelId}:hash(prompt)` (ADR D253) |

## Auditor-acknowledged interface size (info-level)

The 2026-06-06 architecture audit (`/loop-architecture-review` Phase 3 principles-auditor) flagged one item in this folder at **INFO severity** — auditor-noted, not actionable as a fix:

- **PV#11 — `CacheStore` interface in `store.ts:18` has 9 methods (above 7-method ISP heuristic).** 9 methods is 2 above the folklore Miller's 7±2 ceiling per `rules/cycle-rule-schema.md` heuristic-source legend ("Methods per fat interface ≤ 7 (folklore)"). The interface groups orthogonal operations on the same backend lifecycle: `init`, `dispose`, `has`, `get`, `set`, `delete`, `clear`, `getKeys`, `getStats`. Splitting into role-shaped sub-interfaces (`ReadableCacheStore` + `WritableCacheStore` + `IntrospectableCacheStore`) would create ISP-clean micro-interfaces but increase consumer wiring noise — every consumer of the cache plugin would need to compose 2-3 references where 1 sufficed. KISS trade-off: keep the single interface; revisit IF a future consumer needs a strict subset (YAGNI).

Plan `arch-review-fixes-2026-06-06` T11.2 records this trade-off. Audit DB row `principle_violations.id=11` @ `packages/sdk/src/internal/cache/store.ts:18`; report at `architecture-output/final_report.md § Findings by dimension` PV#11.

## Related ADRs

- D249 — Cache as plugin (kind: "cache") with `Cache.semantic` factory + `.asPlugin()`
- D250 — Cache is a Plugin, not Agent wrapper
- D251 — Reuse `MemoryEmbeddingProviderAdapter` — no new embedding layer
- D252 — Layered: KV exact pre-filter + vector semantic fallback
- D253 — Composite cache key (namespace + embedderId + modelId + hash(prompt))
- D254 — Default semantic-similarity threshold 0.85
- D255 — TTL per-category + exclude regex
- D259 — KV exact pre-filter; semantic only on KV miss
- D260 — Hook points: lookup at `pre_user_send`, store at `post_assistant_reply`
- D261 — LRU eviction in-memory default 1000 entries
- D265 — Persistence: memory default; JSON disk opt-in
- D266 — Skip cache for runs that invoked tools
