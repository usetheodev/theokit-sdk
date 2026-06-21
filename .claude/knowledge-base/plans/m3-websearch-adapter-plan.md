---
slug: m3-websearch-adapter
created_at: 2026-06-21
goal: Add env-driven createBraveWebSearchAdapter(opts?) (a WebSearchCallback reading BRAVE_API_KEY, injectable fetch, empty-safe Brave response mapping) to sdk-tools, keeping createWebSearchTool provider-agnostic, measured by tests/web-search-brave.test.ts passing green.
---

# Plan: M3-7 — Web-search adapter (env-driven)

> **Version 1.1** (edge-case-plan absorbed: EC-1 malformed-json-body-throws folded into T1.1 TDD) — Close roadmap gap M3-7: ship ONE concrete env-driven web-search adapter in `@theokit/sdk-tools` — `createBraveWebSearchAdapter(opts?): WebSearchCallback` — that plugs into the EXISTING provider-agnostic `createWebSearchTool` (untouched) via its callback seam. Reads `process.env.BRAVE_API_KEY` (fail-early `ConfigurationError(code:"no_api_key")` at creation if absent), uses an injectable plain `fetch` (default `globalThis.fetch`; NOT `screenedFetch` — it carries no auth header + the endpoint host is fixed so SSRF screening adds nothing), and maps Brave's `web.results[].{title,url,description}` → `WebSearchResult{title,url,snippet}` (empty-safe, string-coerced). YAGNI: Brave first; Tavily/etc later. Design locked by blueprint `m3-websearch-adapter` (discover-confidence SHIPPABLE 97.3, five ADRs covering adapter/env-fail-early/injectable-fetch/mapping/placement).

## Goal

> "Ship `createBraveWebSearchAdapter(opts?): WebSearchCallback` in `@theokit/sdk-tools` — env-driven, injectable fetch, empty-safe Brave mapping, tool stays agnostic — measured by `tests/web-search-brave.test.ts` passing green."

## Context

Roadmap gap M3-7 (`docs/gap-audit/ROADMAP.md:129`, low sev, size S, Tema C, "optional, YAGNI: ship 1 adapter first"). Baseline (confirmed): `createWebSearchTool` (`packages/sdk-tools/src/web-search.ts:32`) is ALREADY provider-agnostic — it takes `WebSearchCallback = (query, maxResults) => Promise<WebSearchResult[]>` (`:23`) and maps a thrown callback to `{ok:false,error:"search_failed"}` (`:62-67`). No concrete adapter ships. SDK env convention: `apiKey ?? process.env.<PROVIDER>_API_KEY` (`packages/sdk/src/internal/memory/adapters/ollama-embedding.ts:71`). `screenedFetch` (`network-guard.ts:194-205`) carries no request headers and the endpoint host is fixed → use a plain injectable `fetch`. Respects `rules/architecture.md` §2 + `rules/no-stubs-no-mocks-no-wired.md`. Zero new deps (native fetch).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-tools/src/web-search-brave.ts` (NEW) | 0 | — | (the Brave adapter) | — |
| `packages/sdk-tools/src/index.ts` | 75 | 95d9210 | sdk-tools barrel | additive exports only |
| `packages/sdk-tools/tests/web-search-brave.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `packages/sdk-tools/src/web-search.ts` | (existing) | — | provider-agnostic tool | READ-ONLY — must NOT be coupled to Brave |
| `docs.md` | (contract) | — | public API contract | additive Brave-adapter note |
| `CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive Added entry |

### Current callers / dependents

- **NEW** `createBraveWebSearchAdapter` — barrel-exported. A consumer does `createWebSearchTool({ search: createBraveWebSearchAdapter() })`. Exercised through the barrel + with an injected stub fetch in tests → no orphan. Consistent with the LEGO-piece precedent.
- **`createWebSearchTool` / `WebSearchCallback` / `WebSearchResult`** (`web-search.ts`) — the agnostic seam the adapter satisfies (NOT modified).
- **`ConfigurationError`** (`@theokit/sdk`) — fail-early error base (existing peer dep).

### Domain glossary

- **WebSearchCallback** — `(query, maxResults) => Promise<WebSearchResult[]>`; the provider-agnostic seam of `createWebSearchTool`.
- **adapter** — a concrete `WebSearchCallback` that calls a real search API (Brave) using an env-driven key.
- **fail-early** — a missing `BRAVE_API_KEY` (and no explicit `apiKey`) throws at adapter CREATION, not lazily mid-run.

### Architecture boundaries affected

Per `rules/architecture.md` §2: `web-search-brave.ts` is an adapter (it performs I/O via an injectable `fetch`) in sdk-tools, barrel-exported. It depends on the `WebSearchCallback` contract + `ConfigurationError` (both public). `createWebSearchTool` stays provider-agnostic (no reverse coupling).

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/m3-websearch-adapter-blueprint.md` (five ADRs).
- **In-repo precedent** `createWebSearchTool` callback seam (`packages/sdk-tools/src/web-search.ts:23-32`); the env convention (`packages/sdk/src/internal/memory/adapters/ollama-embedding.ts:71`); the M3-1 injectable-fetch pattern (`packages/sdk-tools/src/internal/network-guard.ts:194-205`).
- **Reference precedent** opencode `tool/websearch.ts` env-driven adapter + auth header + response mapping (`.claude/knowledge-base/reference/opencode/packages/opencode/src/tool/websearch.ts`); codex `web_search.rs` (`.claude/knowledge-base/reference/codex/codex-rs/core/src/web_search.rs`).

## Objective

- [ ] `web-search-brave.ts` exports `createBraveWebSearchAdapter(opts?): WebSearchCallback` + `CreateBraveWebSearchAdapterOptions`.
- [ ] Resolves `apiKey ?? process.env.BRAVE_API_KEY`; throws `ConfigurationError(code:"no_api_key")` at creation if absent.
- [ ] Uses an injectable plain `fetch` (default `globalThis.fetch`); sets `X-Subscription-Token` header + `q`/`count` query params.
- [ ] Maps `json?.web?.results ?? []` → `{title,url,snippet}` string-coerced (empty-safe); non-ok HTTP throws (→ `search_failed` via the tool).
- [ ] `createWebSearchTool` is NOT modified (stays provider-agnostic).
- [ ] Zero new deps; barrel exports; docs.md + CHANGELOG + changeset.
- [ ] `tests/web-search-brave.test.ts` green; typecheck + Biome clean; build emits dist.

## ADRs

### D1 — One Brave adapter as a `WebSearchCallback` factory; tool stays agnostic
**Decision:** `createBraveWebSearchAdapter(opts?): WebSearchCallback` in `web-search-brave.ts`; `createWebSearchTool` NOT modified.
**Rationale:** the tool is already agnostic; M3-7 adds an adapter at its callback seam. YAGNI: Brave first (GET + header cleanest); Tavily later.
**Alternatives considered:** modify the tool to know providers (rejected — couples it); a provider router (rejected — over-scope).

### D2 — env key + fail-early at creation
**Decision:** `apiKey ?? process.env.BRAVE_API_KEY`; throw `ConfigurationError(code:"no_api_key")` at creation if absent.
**Rationale:** SDK env convention; fail-early surfaces misconfig at wiring.
**Alternatives considered:** lazy throw in the callback (rejected — defers the error); silent no-op (rejected — hides misconfig).

### D3 — injectable plain fetch (NOT screenedFetch)
**Decision:** `fetchImpl?: FetchLike` default `globalThis.fetch`; do NOT use `screenedFetch`.
**Rationale:** `screenedFetch` carries no auth header + the endpoint host is fixed (no SSRF surface); plain injectable fetch is correct + offline-testable.
**Alternatives considered:** screenedFetch (rejected — no header support, no SSRF benefit for a fixed host); non-injectable fetch (rejected — untestable offline).

### D4 — Brave request + empty-safe, string-coerced mapping
**Decision:** GET `q`+`count` + `X-Subscription-Token`; map `json?.web?.results ?? []` → `{title,url,snippet}` with `String(... ?? "")`; non-ok HTTP throws.
**Rationale:** empty/partial responses must not throw (EC-1/EC-2); the existing tool maps a throw to `search_failed`.
**Alternatives considered:** `json.web.results.map` (rejected — throws on empty); partial objects (rejected — `WebSearchResult` needs three strings).

### D5 — Placement + barrel export
**Decision:** `packages/sdk-tools/src/web-search-brave.ts` (sibling of `web-search.ts`); barrel-export the adapter + options type.
**Rationale:** flat sibling of the tool it adapts; matches `web-search.ts`/`web-fetch.ts`.
**Alternatives considered:** an `adapters/` subdir (rejected — one adapter; flat matches existing tools).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Real Brave API not exercised in CI (no key) | Low | injected stub fetch covers mapping/errors offline; a real-key check is a manual/dogfood step (per `real-llm-validation.md`, this is a network adapter — fixture covers the contract; real-key validation is documented as manual) | SDK |
| Brave response schema could change | Low | empty-safe `?? []` + string coercion degrade gracefully; a schema drift yields `[]`, not a crash | SDK |
| Exported adapter with no in-SDK runtime caller (consumer-facing) | Low | barrel-exported LEGO piece; exercised with a stub fetch in tests; `no-stubs` §3 scoped to `packages/sdk/src` | SDK |

## Unresolved Questions

- (none — every decision resolved at plan time via the blueprint's five ADRs. A Tavily adapter, a provider router, and a real-key CI check are explicitly deferred — YAGNI here.)

## Dependency Graph

```
Phase 1 (createBraveWebSearchAdapter + tests) ──▶ Phase 2 (barrel export + docs + changeset + CHANGELOG) ──▶ Final Phase (integration validation)
```

---

## Phase 1: The Brave adapter

### T1.1 — `web-search-brave.ts`

#### Objective
Create `web-search-brave.ts` with the env-driven, injectable-fetch Brave adapter.

#### Why this step (action + reasoning)
1. **What** — `createBraveWebSearchAdapter` resolving the env key (fail-early), building the Brave GET + auth header, and mapping the response empty-safely.
2. **Why now** — it is the whole feature; the env/fail-early + empty-safe mapping are the load-bearing correctness surface; fully testable with an injected stub fetch (offline).

#### Evidence
Blueprint D1-D4 + Technique 1/2. `web-search.ts:17-32` (`WebSearchCallback`/`WebSearchResult`/tool). env convention `ollama-embedding.ts:71`. `network-guard.ts:194-205` (injectable fetch, no headers). opencode `websearch.ts` (auth header + mapping).

#### Files to edit
```
packages/sdk-tools/src/web-search-brave.ts — NEW: createBraveWebSearchAdapter, CreateBraveWebSearchAdapterOptions
packages/sdk-tools/tests/web-search-brave.test.ts — NEW: RED tests first (injected stub fetch)
```

#### Deep file dependency analysis
- `web-search-brave.ts` imports the `WebSearchCallback`/`WebSearchResult` types from `./web-search.js` (type-only) + `ConfigurationError` from `@theokit/sdk`. It does NOT modify `web-search.ts`. Tests inject a stub `fetchImpl` (no network).

#### Pseudo-code / Signatures
```pseudocode
import type { WebSearchCallback, WebSearchResult } from "./web-search.js"
import { ConfigurationError } from "@theokit/sdk"
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
interface CreateBraveWebSearchAdapterOptions { apiKey?: string; fetchImpl?: FetchLike; endpoint?: string }
function createBraveWebSearchAdapter(opts = {}): WebSearchCallback
  apiKey = opts.apiKey ?? process.env.BRAVE_API_KEY
  if (!apiKey) throw new ConfigurationError("BRAVE_API_KEY is not set", { code: "no_api_key" })
  fetchImpl = opts.fetchImpl ?? globalThis.fetch
  endpoint = opts.endpoint ?? "https://api.search.brave.com/res/v1/web/search"
  return async (query, maxResults) =>
    url = new URL(endpoint); url.searchParams.set("q", query); url.searchParams.set("count", String(maxResults))
    res = await fetchImpl(url.toString(), { headers: { "X-Subscription-Token": apiKey, Accept: "application/json" } })
    if (!res.ok) throw new Error(`brave_search_failed: HTTP ${res.status}`)
    json = await res.json()
    return (json?.web?.results ?? []).map(r => ({ title: String(r?.title ?? ""), url: String(r?.url ?? ""), snippet: String(r?.description ?? "") }))
```

#### TDD
```
RED: test_maps_brave_response_to_results() — stub fetch returns {web:{results:[{title,url,description}]}} → [{title,url,snippet:description}]
RED: test_missing_key_throws_at_creation() — no apiKey + no BRAVE_API_KEY → createBraveWebSearchAdapter({}) throws ConfigurationError (code "no_api_key")
RED: test_uses_explicit_apiKey_over_env() — opts.apiKey provided → no throw even if env unset
RED: test_sets_auth_header_and_count() — stub captures the init → headers["X-Subscription-Token"] === key AND url has count=<maxResults> AND q=<query>
RED: test_empty_results_maps_to_empty_array() — stub returns {} and {web:{}} → [] (no throw) (edge EC-1)
RED: test_partial_result_coerced_to_strings() — a result missing description → snippet === "" (edge EC-2)
RED: test_non_ok_http_throws() — stub returns {ok:false,status:401} → callback rejects (so the tool maps to search_failed)
RED: test_malformed_json_body_throws() — stub {ok:true} but res.json() rejects → callback rejects → search_failed via the tool (edge EC-1)
RED: test_composes_with_createWebSearchTool() — createWebSearchTool({search: adapter}) handler with stub → {ok:true,results,count} (integration, tool untouched)
GREEN: implement web-search-brave.ts
REFACTOR: Biome complexity ≤ 10
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/web-search-brave.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/web-search-brave.test.ts` reports 9/9 tests passed
- [ ] `test_missing_key_throws_at_creation` passes (fail-early, D2)
- [ ] `test_empty_results_maps_to_empty_array` + `test_partial_result_coerced_to_strings` pass (empty-safe, D4)
- [ ] `test_non_ok_http_throws` + `test_composes_with_createWebSearchTool` pass (error → search_failed via the untouched tool)
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check packages/sdk-tools/src/web-search-brave.ts` reports 0 errors

#### DoD
- [ ] those tests green; `pnpm --filter @theokit/sdk-tools typecheck` exits 0

---

## Phase 2: Export + document

### T2.1 — Barrel export + docs + changeset + CHANGELOG

#### Objective
Export the adapter from the barrel; add docs.md note, changeset, CHANGELOG entry; barrel re-export test.

#### Why this step (action + reasoning)
1. **What** — add exports to `index.ts`; document; changeset + CHANGELOG.
2. **Why now** — per `no-stubs-no-mocks-no-wired.md` the adapter needs a reachable surface; per CLAUDE.md docs.md reflects the public surface change.

#### Evidence
`index.ts` barrel. Blueprint D5. The `createWebSearchTool` export precedent (`index.ts`).

#### Files to edit
```
packages/sdk-tools/src/index.ts — export createBraveWebSearchAdapter, CreateBraveWebSearchAdapterOptions
packages/sdk-tools/tests/web-search-brave.test.ts — barrel re-export test
docs.md — Brave-adapter note (env var + compose-with-tool example)
CHANGELOG.md (root) — [Unreleased] § Added entry
.changeset/m3-websearch-adapter.md — NEW minor changeset
```

#### Deep file dependency analysis
- `index.ts` additive exports from `./web-search-brave.js`. Barrel test imports from `../src/index.js`.

#### TDD
```
RED: test_brave_adapter_symbol_exported() — import { createBraveWebSearchAdapter } from barrel → function
GREEN: add barrel exports + docs + changeset + CHANGELOG
REFACTOR: none (additive)
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/web-search-brave.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/web-search-brave.test.ts` reports all tests passed (9 + 1 barrel)
- [ ] `test_brave_adapter_symbol_exported` passes (barrel)
- [ ] `grep -c "createBraveWebSearchAdapter\|BRAVE_API_KEY" docs.md` returns ≥ 1 AND `ls .changeset/m3-websearch-adapter.md` exists AND `grep -c "createBraveWebSearchAdapter\|Brave" CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check` clean on changed files

#### DoD
- [ ] tests green; typecheck exit 0; `pnpm --filter @theokit/sdk-tools build` succeeds; docs/changeset/CHANGELOG present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No concrete web-search adapter (M3-7) | T1.1 | `createBraveWebSearchAdapter` (D1) |
| 2 | env-driven | T1.1 | `process.env.BRAVE_API_KEY` + fail-early (D2) |
| 3 | keep tool provider-agnostic | T1.1 | adapter satisfies the callback seam; tool untouched (D1) |
| 4 | injectable/testable fetch | T1.1 | `fetchImpl` default globalThis.fetch (D3) |
| 5 | Brave mapping empty-safe | T1.1 | `?? []` + String coercion (D4) |
| 6 | error → search_failed | T1.1 | non-ok HTTP throws → existing tool maps it (D4) |
| 7 | zero new deps | T1.1 | native fetch/URL/process.env (D3/Rule 9) |
| 8 | Document + record + export | T2.1 | barrel + docs.md + changeset + CHANGELOG + barrel test |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-tools exec biome check`
- [ ] Dead-code gate — `pnpm quality:dead` (knip) exits 0 (NOTE: sdk-tools is not a knip workspace, so this does not prove the export is wired; orphan-safety is the stub-fetch test + the compose-with-tool integration test + the LEGO precedent; `no-stubs` §3 is scoped to `packages/sdk/src`)
- [ ] Build clean — `pnpm --filter @theokit/sdk-tools build`
- [ ] File-size budget respected (`web-search-brave.ts` ≤ 500, target ≤ 100)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] `docs.md` reflects the Brave adapter (env var + compose example)
- [ ] Plan-specific: env-driven + fail-early; injectable plain fetch (not screenedFetch); empty-safe mapping; tool stays agnostic; zero new deps
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M3-7 introduces ZERO new dependencies — native `fetch`/`URL`/`process.env` + the existing `@theokit/sdk` `ConfigurationError` peer (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` (`ConfigurationError`) | workspace | npm/TS | fail-early error base (existing peer dep) |
| (in-repo) `WebSearchCallback`/`WebSearchResult` | workspace | npm/TS | the agnostic seam (same package) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | A Brave/Tavily SDK was considered + rejected: a single GET with a header + a tiny response map is ~40 lines; an SDK adds a dep + surface for no gain. | n/a — native fetch |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

`createBraveWebSearchAdapter` fails fast (typed `ConfigurationError`) at creation on a missing key. The returned callback throws on a non-ok HTTP response or a network error — `createWebSearchTool` catches it and returns `{ok:false,error:"search_failed"}` (the existing, tested behavior). An empty/odd Brave response maps to `[]` (never throws). The adapter performs no other I/O.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk-tools exec vitest run tests/web-search-brave.test.ts
pnpm --filter @theokit/sdk-tools exec vitest run        # full sdk-tools suite — no regression
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk-tools build
```

### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/web-search-brave.test.ts` reports 10 tests passed (0 failed)
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run` exits 0 with 0 failed tests (full suite, no regression)
- [ ] `pnpm --filter @theokit/sdk-tools typecheck` exits 0 (0 type errors) and `pnpm --filter @theokit/sdk-tools exec biome check` reports 0 warnings
- [ ] `pnpm quality:dead` exits 0
- [ ] `pnpm --filter @theokit/sdk-tools build` succeeds (dist emitted)
- [ ] Runtime-metric proof — N/A (adapter; observable via the returned results / search_failed); real-key validation is a documented manual step (`real-llm-validation.md`)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures. 2. Fix all plan-caused. 3. Re-run. 4. Log pre-existing in the PR.
