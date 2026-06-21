# Blueprint: M3-7 — Web-search adapter (env-driven)

> Design source for `createBraveWebSearchAdapter(opts?): WebSearchCallback` in `@theokit/sdk-tools` — ONE concrete env-driven search adapter (Brave first; YAGNI on the rest) that plugs into the EXISTING provider-agnostic `createWebSearchTool` without coupling the tool to any provider. Reads `process.env.BRAVE_API_KEY` (fail-fast if absent), uses an injectable plain `fetch` (the endpoint host is fixed/public — SSRF screening, which protects user-controlled URLs, adds nothing; and `screenedFetch` cannot carry the `X-Subscription-Token` auth header), and maps Brave's `web.results[].{title,url,description}` onto `WebSearchResult{title,url,snippet}`. Backed by opencode (`tool/websearch.ts` env-driven adapter + auth-header + response mapping), codex (`web_search.rs`), and the in-repo `WebSearchCallback` contract (`web-search.ts:23`) + env convention (`process.env.<PROVIDER>_API_KEY`) + M3-1 injectable-fetch pattern. Discovery plan: `m3-websearch-adapter` (discover-plan-confidence SHIPPABLE 96.7).

**Slug:** `m3-websearch-adapter` · **Date:** 2026-06-21 · **Owner:** paulo

## Context

`createWebSearchTool` (`packages/sdk-tools/src/web-search.ts:32`) is already provider-agnostic: it takes a `WebSearchCallback = (query, maxResults) => Promise<WebSearchResult[]>` (`:23`) and maps a thrown callback to `{ok:false,error:"search_failed"}` (`:62-67`). No adapter ships today. M3-7 adds ONE Brave adapter (env-driven, injectable fetch, fail-fast), leaving the tool untouched.

## Objective

Decide `createBraveWebSearchAdapter(opts?): WebSearchCallback` — env key resolution + fail-fast, injectable plain fetch (+ screenedFetch rejection rationale), Brave GET request + auth header, and the `web.results[]` → `WebSearchResult` mapping (empty-safe). Zero new deps. Backed by opencode + codex + in-repo.

## Coverage Corner 1 — Integration Tests

| Source | What it tests | Seeds these SDK RED tests |
|---|---|---|
| opencode `tool/websearch.ts` (`.claude/knowledge-base/reference/opencode/packages/opencode/src/tool/websearch.ts`) | env key + auth header + provider response mapping | adapter sets `X-Subscription-Token`; maps `web.results` → `{title,url,snippet}` |
| in-repo `web-search.ts` (`packages/sdk-tools/src/web-search.ts:55-67`) | thrown callback → `search_failed` | adapter throwing on non-ok HTTP surfaces as `search_failed` through `createWebSearchTool` |
| in-repo M3-1 injectable fetch (`network-guard.ts:194-205`) | injected fetch lets tests run offline | adapter accepts `fetchImpl`; tests pass a stub Response (no network) |

**SDK RED test set:** maps a Brave response (`{web:{results:[{title,url,description}]}}`) → `WebSearchResult[]` with `snippet=description`; missing key (no `apiKey`, no `BRAVE_API_KEY`) throws a typed error at creation; injected `fetchImpl` returns a stub → adapter works offline; empty/odd response (`{}` or `{web:{}}`) → `[]` (no throw, EC-1); non-ok HTTP (e.g. 401) → adapter throws → `createWebSearchTool` returns `{ok:false,error:"search_failed"}`; sets the `X-Subscription-Token` header + `count` query param.

## Coverage Corner 2 — Dependencies

| Project | Adapter deps | Portable? |
|---|---|---|
| opencode | own http wrapper + Effect | NO |
| codex | Rust reqwest | concept only |
| in-repo | native `fetch` + `URL` + `process.env` + `ConfigurationError` | YES — direct |

**Verdict:** ZERO new deps — native `fetch`/`URL`/`process.env` + the existing `ConfigurationError` peer. No SDK-side search SDK (Unbreakable Rule 9 / KISS).

## Coverage Corner 3 — Tools

Module / export shape:
- in-repo `WebSearchCallback = (query, maxResults) => Promise<WebSearchResult[]>` + `WebSearchResult{title,url,snippet}` (`web-search.ts:17-23`) — the contract the adapter satisfies.
- in-repo env convention `apiKey ?? process.env.<PROVIDER>_API_KEY` (`packages/sdk/src/internal/memory/adapters/ollama-embedding.ts:71`).
- in-repo injectable `fetchImpl` (`network-guard.ts:194-205`) — testability seam (but no header support → not used here).
- opencode `tool/websearch.ts` — env-driven provider + auth header + response map.

**SDK module shape:** `packages/sdk-tools/src/web-search-brave.ts`, barrel-exported:
```
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
interface CreateBraveWebSearchAdapterOptions { apiKey?: string; fetchImpl?: FetchLike; endpoint?: string }
createBraveWebSearchAdapter(opts?: CreateBraveWebSearchAdapterOptions): WebSearchCallback
```
Consumer: `createWebSearchTool({ search: createBraveWebSearchAdapter() })` — the tool stays provider-agnostic.

## Coverage Corner 4 — Techniques

### Technique 1 — env key + fail-fast + injectable fetch (Q5/Q4)

```
createBraveWebSearchAdapter(opts):
  apiKey = opts.apiKey ?? process.env.BRAVE_API_KEY
  if (!apiKey) throw new ConfigurationError("BRAVE_API_KEY is not set", { code: "no_api_key" })  // fail-fast at creation
  fetchImpl = opts.fetchImpl ?? globalThis.fetch
  endpoint = opts.endpoint ?? "https://api.search.brave.com/res/v1/web/search"
  return async (query, maxResults) => { ...request + map... }
```
Fail-fast at creation (not in the callback) so a misconfigured consumer learns immediately. Injectable `fetchImpl` (default `globalThis.fetch`) makes the adapter offline-testable. `endpoint` overridable (self-host / test).

**Why plain fetch, not screenedFetch:** `ScreenedFetchOptions` (`network-guard.ts:194-205`) carries no request headers, so it cannot send `X-Subscription-Token`; and the endpoint host is FIXED (not user-controlled), so SSRF screening — which protects user-controlled URLs in `web_fetch` — adds no protection here. Plain injectable fetch is correct.

### Technique 2 — Brave request + empty-safe response mapping (Q4, EC-1/EC-2)

```
callback(query, maxResults):
  url = new URL(endpoint)
  url.searchParams.set("q", query)
  url.searchParams.set("count", String(maxResults))
  res = await fetchImpl(url.toString(), { headers: { "X-Subscription-Token": apiKey, Accept: "application/json" } })
  if (!res.ok) throw new Error(`brave_search_failed: HTTP ${res.status}`)   // → search_failed via the tool
  json = await res.json()
  return (json?.web?.results ?? []).map(r => ({               // empty-safe (EC-1)
    title: String(r?.title ?? ""),                            // coerce partial (EC-2)
    url: String(r?.url ?? ""),
    snippet: String(r?.description ?? ""),
  }))
```
`json?.web?.results ?? []` → an empty/odd response yields `[]` (no throw). Each field coerced to a string. The tool's existing `slice(0, maxResults)` is the final bound (EC-3).

## Cross-cutting Comparison

| Dimension | codex | opencode | in-repo | SDK decision |
|---|---|---|---|---|
| provider selection | built-in | env `OPENCODE_WEBSEARCH_PROVIDER` | (tool is agnostic) | explicit adapter (no router; YAGNI) |
| auth | reqwest header | env key + header | n/a | `X-Subscription-Token` from `BRAVE_API_KEY` |
| fetch | reqwest | own http | injectable `fetchImpl` | injectable plain `fetch` (not screenedFetch) |
| response map | struct | per-provider | `WebSearchResult` | `web.results[]` → `{title,url,snippet}` |
| deps | Rust | Effect | none | none (native fetch) |
| missing key | n/a | runtime | n/a | fail-fast typed error at creation |

## ADRs

### D1 — One Brave adapter as a `WebSearchCallback` factory; tool stays agnostic
**Decision:** `createBraveWebSearchAdapter(opts?): WebSearchCallback` in a new `web-search-brave.ts`; `createWebSearchTool` is NOT modified.
**Rationale:** the tool is already provider-agnostic; M3-7 adds an adapter that plugs into its callback seam. YAGNI: Brave first (GET + header is the cleanest), Tavily/etc later.
**Alternatives considered:** modify `createWebSearchTool` to know providers (rejected — couples the tool); a provider router (rejected — over-scope for "1 first").

### D2 — env key resolution + fail-fast at creation
**Decision:** `apiKey ?? process.env.BRAVE_API_KEY`; throw `ConfigurationError(code:"no_api_key")` at adapter creation if absent.
**Rationale:** SDK env convention (`<PROVIDER>_API_KEY`); fail-fast surfaces misconfiguration at wiring, not mid-run.
**Alternatives considered:** return a callback that throws lazily (rejected — defers the error; the consumer wants it at setup); silent no-op (rejected — hides misconfig).

### D3 — injectable plain fetch (NOT screenedFetch)
**Decision:** `fetchImpl?: FetchLike` default `globalThis.fetch`; do NOT use `screenedFetch`.
**Rationale:** `screenedFetch` carries no auth header + the endpoint host is fixed (no SSRF surface); plain injectable fetch is correct + offline-testable.
**Alternatives considered:** screenedFetch (rejected — no header support, no SSRF benefit for a fixed host); non-injectable fetch (rejected — untestable offline).

### D4 — Brave request + empty-safe, string-coerced mapping
**Decision:** GET `q`+`count` + `X-Subscription-Token`; map `json?.web?.results ?? []` → `{title,url,snippet}` with `String(... ?? "")`; non-ok HTTP throws (→ `search_failed`).
**Rationale:** empty/partial responses must not throw (EC-1/EC-2); the existing tool maps a throw to `search_failed`.
**Alternatives considered:** `json.web.results.map` (rejected — throws on empty); return partial objects (rejected — `WebSearchResult` needs three strings).

### D5 — Placement + barrel export
**Decision:** `packages/sdk-tools/src/web-search-brave.ts` (sibling of `web-search.ts`); barrel-export `createBraveWebSearchAdapter` + its options type.
**Rationale:** flat sibling of the tool it adapts; consistent with `web-search.ts`/`web-fetch.ts` placement.
**Alternatives considered:** an `adapters/` subdir (rejected — only one adapter; the flat layout matches the existing tools).

## Recommendations for the project

1. Implement `createBraveWebSearchAdapter(opts?): WebSearchCallback` in `packages/sdk-tools/src/web-search-brave.ts`, zero deps, barrel-exported (D1/D5).
2. Resolve `apiKey ?? process.env.BRAVE_API_KEY`, fail-fast with `ConfigurationError(code:"no_api_key")` at creation (D2).
3. Injectable plain `fetch` (default `globalThis.fetch`), NOT screenedFetch (no header support + fixed host) (D3).
4. Brave GET + `X-Subscription-Token`; map `json?.web?.results ?? []` → `{title,url,snippet}` string-coerced; non-ok HTTP throws → `search_failed` (D4, EC-1/EC-2).
5. TDD with an injected stub fetch (offline): mapping, missing-key throw, empty-results→[], non-ok→throw, header+count set. Keep `createWebSearchTool` untouched (provider-agnostic).

## Blocked questions (if any)

- (none) — design fully resolved; the adapter plugs into the existing agnostic callback seam with zero deps and an injectable fetch.
