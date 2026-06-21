# Review: m3-websearch-adapter

**Date:** 2026-06-21
**Reviewers (spawned agents):** 2 — architecture+wiring+behavior, test-auditor+cross-validation (general-purpose, opus-class)
**Findings (initial):** 0 BLOCKER, 0 HIGH, 2 LOW (lazy endpoint validation + non-string coercion untested), INFO
**Findings (after hardening `1341590`):** 0 BLOCKER, 0 HIGH, 0 MEDIUM, advisory INFO only
**Verdict:** READY_TO_MERGE

> Per-agent finding files: `.claude/agents/review-m3-websearch-adapter-2026-06-21/findings/*.md`.

## Scope reviewed

Commits `a52184c` (T1.1) + `30ad16e` (T2.1 docs) + hardening `1341590`, on `develop` vs `main`. Files: `packages/sdk-tools/src/web-search-brave.ts`, `index.ts`, `tests/web-search-brave.test.ts`, `docs.md`, root `CHANGELOG.md`, `.changeset/m3-websearch-adapter.md`. `packages/sdk-tools/src/web-search.ts` confirmed UNCHANGED (the provider-agnostic tool is not coupled to Brave).

## BLOCKER / HIGH findings

_None._ Both reviewers independently reached 0 BLOCKER, 0 HIGH. The adapter plugs into the existing provider-agnostic `WebSearchCallback` seam; `createWebSearchTool` is verified untouched; behavior (env fail-early, URL/header build, empty-safe mapping, error→`search_failed` via the tool) is correct.

## LOW findings (addressed in hardening `1341590`)

- **[FIXED] `new URL(endpoint)` threw lazily inside the callback on a malformed `endpoint` override** (architecture F5): moved the `new URL(endpoint)` to adapter-creation time (fail-early symmetry with the key check) and clone it per call; added a test asserting a malformed endpoint throws at creation.
- **[FIXED] non-string result-field coercion not mutation-covered** (test-auditor): the `String(... ?? "")` coercion was only exercised for the empty-default path. Added a test feeding `{title:123, url:null, description:true}` → `{title:"123", url:"", snippet:"true"}`.

## INFO confirmations

- `createWebSearchTool` / `web-search.ts` NOT modified — the tool stays provider-agnostic (the M3-7 commits touched only `web-search-brave.ts`, `index.ts`, the test, then docs/changeset/CHANGELOG).
- env fail-early: `apiKey ?? process.env.BRAVE_API_KEY`; missing key → `ConfigurationError(code:"no_api_key")` at creation. URL encoding correct (`q=hello+world`, `count=3`); `X-Subscription-Token` + `Accept` headers set; non-ok HTTP throws → `createWebSearchTool` maps to `{ok:false,error:"search_failed"}`; empty/odd response → `[]`; partial/non-string fields coerced to strings.
- SSRF: the endpoint host is fixed (user input only in the `q` query param); plain `fetch` (not `screenedFetch`) is justified — `screenedFetch` cannot carry the auth header and a fixed host has no SSRF surface (ADR D3, documented in-code).
- real-key validation honestly deferred: this is a network adapter; the stub-fetch suite covers the contract (mapping/errors/env/auth/compose) offline; the real Brave API is a documented manual/dogfood step per `real-llm-validation.md` — never claimed as validated.
- non-vacuous assertions: `toEqual` on full result objects; exact header value + `count` + URL-encoded `q`; compose test asserts `error==="search_failed"`. Determinism: `beforeEach` deletes `BRAVE_API_KEY` + `afterEach` restores (no pollution, no ambient-env dependence); no real network.
- all 5 ADRs honored + Coverage Matrix 8/8; zero new deps (only types + `ConfigurationError`); changeset `@theokit/sdk-tools:minor` correct; docs/CHANGELOG accurate (fail-early, screenedFetch rationale, Tavily as follow-up) — no overclaim; no scope creep (no Tavily adapter, no provider router).

## Quality gate re-validation (after `1341590`)

- Full sdk-tools suite: 26 files / **265 passed, 0 failed** (+14 from M3-7: 13 adapter + 1 barrel).
- typecheck exit 0; Biome clean (59 files, 0 warnings, complexity ≤ 10); knip exit 0; build emits ESM+CJS+DTS; code-quality PASS.

## Edge-case coverage

Plan EC-1 (malformed-JSON body throws → search_failed) covered, plus the review-added malformed-endpoint fail-early and non-string-coercion cases; empty/odd-response→[] and partial-field coercion covered.

## Verdict rationale

0 BLOCKER, 0 HIGH from two independent reviewers. Both LOW findings (lazy endpoint validation + non-string coercion coverage) are addressed in `1341590`; the central invariant — `createWebSearchTool` remains provider-agnostic and unmodified — is verified. Per `cycle-review.md § Verdicts`: **READY_TO_MERGE.**

## Recommended next step

`/release` (a `@theokit/sdk-tools` minor — additive Brave web-search adapter). M3 is now complete: all 7 items (M3-1 … M3-7) are READY_TO_MERGE.
