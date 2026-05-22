# example: semantic cache

Demonstrates `Cache.semantic` + `Cache.consult` (Adoption Roadmap #6; ADRs D249-D266).

## Run (OpenRouter cloud)

```bash
export OPENROUTER_API_KEY=sk-or-...
pnpm install
pnpm run run
```

## What it shows

- `Cache.semantic({ embedder, threshold, ttl, namespace })` factory.
- `cache.consult(prompt)` — direct lookup with `hit: boolean` outcome + `source: "kv" | "semantic"`.
- `cache.remember(prompt, response)` — explicit store after dispatching the LLM yourself.
- `ttl.exclude` regex — time-sensitive prompts (weather, today, now) bypass cache.
- `cache.stats()` — kvHits / semanticHits / misses / excluded counters.

## v1 limitations (documented)

- **Plugin mode provides recall + context inject** — the LLM is still called on hit and pre-loaded with the cached answer. For true short-circuit (skip the LLM call entirely), use `cache.consult()` directly and dispatch your own LLM call only on miss (the demo shows this pattern).
- **No streaming cache** (D256) — only `agent.send` is cached, not `agent.stream`.
- **No adaptive threshold per entry** (D254) — single global threshold; tune via `Cache.semantic({ threshold: 0.95 })` for high-stakes scenarios.
- **No tool-use cache** (D266 / EC-10) — runs that invoked tools are NEVER cached (replay would lose side-effects).
- **Embedder change invalidates** (D258) — `embedder.id` is part of the cache key.

## Pairing with Anthropic prompt_caching (D263)

Cache.semantic resolves paraphrases BEFORE the LLM. Anthropic prompt_caching gives 90%
discount on prefix-identical input AFTER hitting the LLM. They're orthogonal — use both
for compound savings (~95% in ideal workloads):

```
[user query] → Cache.semantic hit? → return cached
              → miss → LLM call with cache_control on system/tools (90% discount)
```
