# Discovery Plan: M3-7 — Web-search adapter (env-driven)

> **Version 1.0** — Investigate how to implement ONE concrete env-driven web-search adapter (Brave first; YAGNI on the rest) that plugs into the existing provider-agnostic `createWebSearchTool` (`packages/sdk-tools/src/web-search.ts`) without coupling the tool to any provider, to design `createBraveWebSearchAdapter(opts?): WebSearchCallback` — reading `process.env.BRAVE_API_KEY`, using an injectable plain `fetch` (the endpoint host is fixed/public, so SSRF screening — which protects user-controlled URLs — does not apply, and `screenedFetch` cannot carry the required auth header anyway), and mapping Brave's `web.results[].{title,url,description}` onto the SDK's `WebSearchResult{title,url,snippet}`. opencode (`tool/websearch.ts` — env-driven provider selection + auth-header + per-provider response mapping) and codex (`web_search.rs`) provide the precedent; the in-repo `WebSearchCallback` contract + the SDK env-config convention (`process.env.<PROVIDER>_API_KEY`) + the M3-1 injectable-fetch testability pattern are the load-bearing in-repo pieces. Blueprint output: the adapter signature, the env+fetch injection, the Brave request/response mapping, and the fail-fast-on-missing-key contract.

**Slug:** `m3-websearch-adapter`
**Owner:** paulo
**Created:** 2026-06-21
**Time budget:** 2h (per-project breakdown in ADR D1)

## Context

Roadmap gap M3-7 (`docs/gap-audit/ROADMAP.md:129`, low sev, size S, Tema C, "optional, YAGNI: ship 1 adapter first"). Baseline (confirmed via Explore): `createWebSearchTool` (`packages/sdk-tools/src/web-search.ts:32`) is ALREADY provider-agnostic — it takes a `WebSearchCallback = (query, maxResults) => Promise<WebSearchResult[]>` (`web-search.ts:23`) and on a thrown callback returns `{ok:false,error:"search_failed",message}` (`:62-67`). No concrete adapter ships today. The SDK env convention is `process.env.<PROVIDER>_API_KEY` (e.g. `ollama-embedding.ts:71`). M3-1's `screenedFetch` takes an injectable `fetchImpl` for testability — BUT `ScreenedFetchOptions` (`network-guard.ts:194-205`) carries NO request headers, so it cannot send Brave's `X-Subscription-Token` auth header; and because the adapter's endpoint host is FIXED (not user-controlled), SSRF screening adds no protection here. The roadmap scopes M3-7 as ONE env-driven adapter keeping `createWebSearchTool` provider-agnostic. Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps (native fetch).

## Objective

Decide `createBraveWebSearchAdapter(opts?): WebSearchCallback` — the env-driven key resolution (`apiKey ?? process.env.BRAVE_API_KEY`, fail-fast if absent), the injectable plain `fetch` (default `globalThis.fetch`; the fixed-host rationale for NOT using `screenedFetch`), the Brave request (GET `q`+`count` + `X-Subscription-Token` header), and the response mapping (`web.results[]` → `{title,url,snippet}`) — backed by opencode's env-driven adapter, codex's web-search, and the in-repo `WebSearchCallback` contract. Success criteria:

- [ ] All research questions answered with citations to `.claude/knowledge-base/reference/` + in-repo
- [ ] Cross-cutting comparison populated (codex / opencode / in-repo web-search+network-guard)
- [ ] Recommendations give ≥ 1 concrete proposal per question (esp. the adapter signature + the Brave mapping)
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/reference/opencode/` | `packages/opencode/src/tool/websearch.ts` | env-driven provider selection + auth-header + per-provider request/response mapping — the exact adapter pattern |
| `.claude/knowledge-base/reference/codex/` | `codex-rs/core/src/web_search.rs` | how codex models a web-search tool/result |
| (in-repo) `packages/sdk-tools/src/web-search.ts` | — | the `WebSearchCallback`/`WebSearchResult` contract the adapter satisfies |
| (in-repo) `packages/sdk-tools/src/internal/network-guard.ts` | — | the injectable-fetch testability pattern (and why screenedFetch can't carry the auth header) |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| A Tavily adapter (and other providers) | YAGNI — roadmap says "ship 1 adapter first"; Brave is the cleaner first (GET + header). Tavily is a <1h follow-up once the pattern is proven |
| Modifying `createWebSearchTool` to know about providers | It is ALREADY provider-agnostic; M3-7 must NOT couple it to Brave |
| A provider-selection router (env-driven multi-provider like opencode) | over-scope for "1 adapter first"; the consumer picks the adapter explicitly |
| `.claude/knowledge-base/reference/*/{node_modules,dist,target}/` | Build artifacts |

## ADRs

### D1 — Time budget + stop conditions
**Decision:** opencode websearch.ts: 1h, codex web_search.rs: 0.25h, in-repo web-search + network-guard + env convention: 0.75h.
**Rationale:** opencode is the closest env-driven-adapter precedent; the in-repo `WebSearchCallback` contract + env convention are load-bearing.
**Stop condition — per question:** empty search after 3 variants → BLOCKED, continue. **Per project:** budget exhausted → mark remaining BLOCKED; if all done/blocked, emit BLUEPRINT_BLOCKED.
**Anti-pattern:** NEVER make a real network call during discovery; NEVER couple `createWebSearchTool` to Brave (it stays provider-agnostic).

### D2 — Investigation depth
**Decision:** Read opencode `websearch.ts` (env key + auth header + response mapping), skim codex `web_search.rs`; map onto the in-repo `WebSearchCallback` + the env convention + the injectable-fetch pattern; confirm Brave's known request/response shape (no live call).
**Rationale:** the adapter signature + the Brave mapping + the env/fetch injection is the high-value output.
**Consequences:** the SDK ships ONE Brave adapter (env-driven, injectable fetch, fail-fast on missing key) as a `WebSearchCallback` factory; `createWebSearchTool` is untouched.

## Research Questions

| # | Question | Corner | Reference(s) | Fase A (broad) | Fase B (deep Read) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does opencode TEST its env-driven web-search adapter, and how is the in-repo web-search tool tested? | tests | opencode, in-repo | Grep opencode websearch tests + web-search.test.ts | Read opencode `websearch.ts` request build + `packages/sdk-tools/tests/web-search.test.ts` | Table → SDK RED tests (adapter maps Brave response → WebSearchResult[]; missing key throws; injected fetch lets tests run offline; non-ok HTTP → throw → search_failed) |
| Q2 | What does the adapter DEPEND on? Zero deps (native fetch)? | deps | opencode, in-repo | Read opencode http client + web-search imports | Confirm native `fetch` + `process.env` suffice; no SDK-side search lib | Verdict: zero new deps — native fetch + URL + process.env; opencode uses its own http wrapper (not portable) |
| Q3 | What is the adapter SIGNATURE + how does it plug into createWebSearchTool? | tools | opencode, in-repo | Read `web-search.ts:23-32` (WebSearchCallback + createWebSearchTool) | Read the callback contract + the env convention (`ollama-embedding.ts:71`) | Module shape → `createBraveWebSearchAdapter(opts?): WebSearchCallback` in `sdk-tools/src/web-search-brave.ts`; consumer does `createWebSearchTool({ search: createBraveWebSearchAdapter() })` |
| Q4 | REQUEST/RESPONSE MAPPING: Brave GET + auth header + response → WebSearchResult; why plain fetch not screenedFetch? | techniques | opencode, in-repo | Read opencode auth-header + response map; read screenedFetch options | Confirm `ScreenedFetchOptions` has no headers + the fixed-host SSRF rationale | Brave GET `q`+`count` + `X-Subscription-Token`; map `web.results[].{title,url,description}` → `{title,url,snippet}`; injectable plain fetch (default globalThis.fetch); screenedFetch rejected (no header support + fixed host) |
| Q5 | ENV + FAIL-FAST + ERROR PROPAGATION: key resolution, missing-key behavior, HTTP-error → search_failed | techniques | opencode, in-repo | Read opencode env key + web-search error path | Decide: resolve `apiKey ?? process.env.BRAVE_API_KEY`; throw `ConfigurationError(code:"no_api_key")` at adapter creation if absent (fail-fast); a thrown callback (non-ok HTTP) becomes `search_failed` via the existing tool | Env+fail-fast contract: fail-fast at creation on missing key; non-ok HTTP / network error throws → `createWebSearchTool` maps to `{ok:false,error:"search_failed"}` |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1 | Covered |
| Dependencies | Q2 | Covered |
| Tools | Q3 | Covered |
| Techniques | Q4, Q5 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | every cited path (reference + in-repo) exists | mark Qx BLOCKED, continue |
| After answering Qx | the Qx section has ≥ 1 citation | re-iterate (1 retry) |
| Q3 agnostic gate | the design adds an ADAPTER; `createWebSearchTool` is NOT modified / NOT coupled to Brave | re-iterate; keep the tool provider-agnostic |
| Q4 fetch gate | the design uses an injectable plain `fetch` (NOT screenedFetch — it cannot carry the auth header; the endpoint host is fixed so SSRF screening adds nothing) + maps `web.results[]` → WebSearchResult | re-iterate; record the fetch rationale |
| Q5 fail-fast gate | a missing `BRAVE_API_KEY` (and no explicit `apiKey`) fails fast with a typed error at adapter creation; a runtime HTTP error becomes `search_failed` via the existing tool | re-iterate; record the env + error contract |
| Before promising complete | all 4 corners populated + ≥ 1 ADR | refuse promise, continue |

## Acceptance Criteria

- [ ] All 5 research questions answered OR marked BLOCKED with reason
- [ ] Every citation resolves (reference + in-repo)
- [ ] Cross-cutting comparison populated (codex / opencode / in-repo)
- [ ] Blueprint proposes `createBraveWebSearchAdapter` signature + env/fetch injection + Brave mapping + fail-fast contract, backed by opencode + in-repo, keeping `createWebSearchTool` provider-agnostic
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS (per `rules/discover-blueprint-golden-rule.md`)
- [ ] No fabricated citations
- [ ] All 4 coverage corners populated
- [ ] ADRs cover: adapter signature, env key + fail-fast, injectable plain fetch (+ screenedFetch rejection rationale), Brave request/response mapping, placement, keep-tool-agnostic
