---
slug: web-fetch-redirect-policy
created_at: 2026-06-26
goal: Give createWebFetchTool a maxRedirects option (block-all via 0) with a distinct redirect_blocked error + injectable fetch/lookup, so a consumer needs no app-side SSRF wrapper.
---

# Plan: `createWebFetchTool` — redirect policy + injection seam (delete theocode's SSRF wrapper)

> **Version 1.0** — theocode keeps `server/lib/web-fetch-guard.ts` (`createGuardedWebFetchTool`, 83 LoC) — an SSRF-guarded `web_fetch`. The radar (index.ts review) showed the host-SSRF guard is NO LONGER a differentiator: the sdk `createWebFetchTool` is SSRF-guarded by default (`screenedFetch`, `allowPrivateHosts:false`). The wrapper now differs ONLY by: (a) a STRICTER redirect policy (blocks ALL redirects → `redirect_blocked`, vs the sdk following up to `maxRedirects` SSRF-screened hops), and (b) an injectable `fetch`/`lookup` seam for no-network tests. `screenedFetch` already supports `maxRedirects` (0 blocks all) but `createWebFetchTool` does not expose it, surfaces a redirect-limit hit as the conflated `ssrf_blocked`, and exposes no injection seam. This plan adds to `createWebFetchTool`: a `maxRedirects?` option, a DISTINCT `redirect_blocked` error (separate from `ssrf_blocked`), and injectable `fetchImpl?`/`lookup?` — so theocode can call `createWebFetchTool({ maxRedirects: 0 })` (+ inject in tests) and DELETE its wrapper (next cycle). Same radar pattern as `withShellExitGuidance`.

## Goal

> "Add `maxRedirects`, a distinct `redirect_blocked` error, and injectable `fetchImpl`/`lookup` to `createWebFetchTool`, measured by `pnpm --filter @theokit/sdk-tools test` passing with new tests: `maxRedirects:0` on a 3xx → `{ ok:false, error:'redirect_blocked' }`, a private host still → `ssrf_blocked`, and injected fetch/lookup driving both paths with no network."

## Context

theocode is the radar; each app-side residue reveals a framework gap. The `web-fetch-guard` wrapper's only remaining justification is the block-all-redirects policy + a test seam — both belong in the framework's `createWebFetchTool` (it owns web_fetch). `screenedFetch` already has the `maxRedirects` mechanism + injectable `fetchImpl`/`lookup`; this plan threads them through `createWebFetchTool`'s public surface and splits the redirect-limit error from the SSRF error.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists | Invariant to preserve |
|---|---|---|---|
| `packages/sdk-tools/src/internal/network-guard.ts` | ~230 | `screenedFetch` (SSRF + redirect screening) + `SsrfBlockedError` | existing `screenedFetch`/`resolveAndScreen` behavior UNCHANGED; add a distinct `RedirectBlockedError` for the redirect-limit case |
| `packages/sdk-tools/src/web-fetch.ts` | ~135 | `createWebFetchTool` + `CreateWebFetchToolOptions` | existing options (`defaultTimeoutMs`/`allowPrivateHosts`) + return shape + `ssrf_blocked`/`invalid_url`/`timeout`/`too_large` codes UNCHANGED; ADD `maxRedirects`/`fetchImpl`/`lookup` + `redirect_blocked` |
| `packages/sdk-tools/src/index.ts` | — | barrel | export `RedirectBlockedError` (+ any new type) |
| `packages/sdk-tools/tests/web-fetch.test.ts` | — | tests `createWebFetchTool` | add maxRedirects / redirect_blocked / injection cases |

### Current callers / dependents (empirically verified)

- `screenedFetch(url, { fetchImpl?, lookup?, maxRedirects=5, allowPrivateHosts=false, signal? })` (network-guard.ts:213): loop `for hop in 0..maxRedirects` → screen host → `fetchImpl(redirect:'manual')` → `redirectTarget`; exhausting → `throw SsrfBlockedError(url, "too many redirects")`. So `maxRedirects:0` already blocks a redirect (throws after hop 0) — but as `SsrfBlockedError`.
- `createWebFetchTool` (web-fetch.ts:34): options `defaultTimeoutMs`/`allowPrivateHosts`; calls `screenedFetch(url, { signal, allowPrivateHosts })` — does NOT pass `maxRedirects`/`fetchImpl`/`lookup`; catches `SsrfBlockedError` → `ssrf_blocked`.
- Consumer theocode `createGuardedWebFetchTool` (the wrapper to be deleted next cycle) blocks all redirects → `redirect_blocked`, blocks private host → `blocked_host`, injects `lookupImpl`/`fetchImpl`. theocode tests assert these (web-fetch-guard.test.ts, 5 wrapper cases + 2 isBlockedIp cases).

### Domain glossary

- **redirect policy** — how many redirect hops `web_fetch` follows. `maxRedirects:0` = block all (a 3xx is refused, not followed).
- **redirect_blocked vs ssrf_blocked** — a refused redirect (policy: too many hops) is a DIFFERENT event from a blocked private/reserved host (SSRF). A security tool benefits from distinct diagnostics.
- **injection seam** — `fetchImpl`/`lookup` options let a test drive the tool deterministically with no real network/DNS.

### Architecture boundaries affected

- None new. Internal additions to `network-guard.ts` + `web-fetch.ts` + a barrel export. No new dependency. `docs.md` (the `@theokit/sdk` API contract) is unaffected — sdk-tools is a sibling package documented in its own d.ts/README.

## Prior Art & Related Work

- **`screenedFetch` + `SsrfBlockedError`** (`network-guard.ts`) — the SSRF + redirect mechanism this plan exposes.
- **theocode `createGuardedWebFetchTool`** — the proven block-all-redirects + injection behavior being promoted.
- **In-repo precedent** — `withShellExitGuidance` (just shipped, sdk-tools@0.5.0): same radar move (promote app residue to the framework, then the app deletes it).

## Objective

- [ ] `CreateWebFetchToolOptions` gains `maxRedirects?: number`, `fetchImpl?`, `lookup?` (passed through to `screenedFetch`).
- [ ] A redirect-limit hit surfaces as a DISTINCT `{ ok:false, error:'redirect_blocked' }` (not `ssrf_blocked`); a host SSRF block stays `ssrf_blocked`.
- [ ] `RedirectBlockedError` added in `network-guard.ts` + exported; `screenedFetch` throws it on redirect-limit exhaustion (was `SsrfBlockedError("too many redirects")`).
- [ ] Backward-compatible: absent options ⇒ today's behavior (maxRedirects 5, global fetch/lookup); the existing `ssrf_blocked`/`invalid_url`/`timeout`/`too_large` codes + return shape UNCHANGED.
- [ ] Injection works: a test drives both the block-redirect + block-host paths with injected `fetchImpl`/`lookup`, no network.
- [ ] Gates: `pnpm --filter @theokit/sdk-tools test` green; typecheck 0; biome clean; changeset (minor).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none changed) | | | Internal addition; no dependency change. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Expose `maxRedirects` on `createWebFetchTool` (block-all via 0), reusing `screenedFetch`

- **Decision:** add `maxRedirects?: number` to `CreateWebFetchToolOptions`, passed to `screenedFetch`; `0` blocks all redirects.
- **Rationale:** `screenedFetch` already implements the redirect loop + limit; exposing the existing knob (Rule 9 — reuse) is the minimal change. A consumer wanting a strict no-redirect policy (theocode) sets `0`; the default (5) is unchanged.
- **Alternatives considered:** (a) A boolean `followRedirects?` — REJECTED: less expressive than a hop count; `maxRedirects` matches the underlying `screenedFetch` option name (one vocabulary). (b) Bake block-all into the tool unconditionally — REJECTED: a behavior change for every consumer; redirect-following is a reasonable default.
- **Consequences:** consumers opt into strict redirect policy; default preserved.

### D2 — Distinct `RedirectBlockedError` → `redirect_blocked` (split from `ssrf_blocked`)

- **Decision:** add `RedirectBlockedError` in `network-guard.ts`; `screenedFetch` throws it when redirects are exhausted (replacing `SsrfBlockedError(url, "too many redirects")`); `createWebFetchTool` catches it → `{ ok:false, error:'redirect_blocked' }`.
- **Rationale:** a refused redirect is a different event from a blocked private host; conflating both as `ssrf_blocked` loses diagnostic signal (and is what theocode's wrapper avoids with a distinct code). Honest error taxonomy (fail-clear). The non-redirect SSRF path keeps `SsrfBlockedError`→`ssrf_blocked` UNCHANGED.
- **Alternatives considered:** (a) Keep throwing `SsrfBlockedError` for redirects, map by message — REJECTED: fragile (string-matching `err.message`). (b) A flag on `SsrfBlockedError` — REJECTED: a distinct type is clearer + `instanceof`-checkable. 
- **Consequences:** a redirect-limit hit now surfaces as `redirect_blocked` (more precise) for ALL `createWebFetchTool` callers — a minor behavior refinement (was `ssrf_blocked`); documented in the changeset. The `RedirectBlockedError` is exported for consumers that catch `screenedFetch` directly.

### D3 — Injectable `fetchImpl`/`lookup` on `CreateWebFetchToolOptions` (testability seam)

- **Decision:** add `fetchImpl?`/`lookup?` to `CreateWebFetchToolOptions`, forwarded to `screenedFetch` (which already accepts them).
- **Rationale:** `screenedFetch` is already injectable; not exposing it on the tool forces consumers to hit the real network in tests (or keep an app wrapper — the residue this radar closes). The seam mirrors V4-R's `streamFactory` rationale (the framework must be drivable deterministically in a consumer's tests).
- **Alternatives considered:** (a) No seam; tell consumers to use a local server — REJECTED: heavier; the seam already exists internally, just unexposed. 
- **Consequences:** theocode (next cycle) can drive `createWebFetchTool` in its no-network tests + delete the wrapper.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Splitting the redirect error changes the code for an existing too-many-redirects hit (`ssrf_blocked`→`redirect_blocked`) | Low | documented in the changeset as a minor refinement; result is still `{ok:false}`; rare (a redirect loop) | maintainer |
| Larger `CreateWebFetchToolOptions` surface | Low | all optional + additive; mirrors `ScreenedFetchOptions` (familiar) | maintainer |
| Injected `lookup` shape must match the sdk `LookupFn` (not Node's `lookup(all:true)`) | Medium | the seam forwards to `screenedFetch`'s existing `lookup` type; tests use that exact shape; documented in the option's JSDoc | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (network-guard: RedirectBlockedError + throw it on redirect-limit) ──▶ Phase 2 (web-fetch: maxRedirects/fetchImpl/lookup options + redirect_blocked mapping + barrel export + tests)
                                                                                  │
                                                                                  ▼
                                                                         Final Phase: Integration Validation
```

## Phase 1: `RedirectBlockedError` in network-guard

### T1.1 — Add RedirectBlockedError; throw it on redirect-limit exhaustion

#### Objective
Add `export class RedirectBlockedError` in `network-guard.ts`; change the loop's final `throw new SsrfBlockedError(url, "too many redirects")` to throw `RedirectBlockedError`. Keep all host-screen throws as `SsrfBlockedError`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — splits the redirect-limit failure into its own error type so the tool can map it distinctly (ADR D2).
2. **Why it is necessary now** — it is the precondition for the `redirect_blocked` tool error; without it the redirect block stays conflated as `ssrf_blocked`.

#### Evidence
`network-guard.ts:229` (`throw new SsrfBlockedError(url, "too many redirects")`); `SsrfBlockedError` class (network-guard.ts:19).

#### Files to edit
```
packages/sdk-tools/src/internal/network-guard.ts — add RedirectBlockedError; throw it at the redirect-limit
```

#### Deep file dependency analysis
- `RedirectBlockedError extends Error` (mirror `SsrfBlockedError`'s shape: `(url, detail?)`, `name`). Only the redirect-limit `throw` changes; `resolveAndScreen` / `redirectTarget` SSRF throws stay `SsrfBlockedError`. A non-http redirect target currently throws `SsrfBlockedError` (`redirectTarget`) — that is a SSRF-class block (target screened), keep it `SsrfBlockedError`.

#### Deep Dives
- **Backward-compat:** any caller catching `SsrfBlockedError` for the too-many-redirects case now sees `RedirectBlockedError`. The only in-repo caller is `createWebFetchTool` (updated in Phase 2). 
- **TDD:** RED test (a no-op stub fetch that always 3xx with `maxRedirects:0` → expect `RedirectBlockedError`) before the change.

#### Pseudo-code / Signatures
```ts
export class RedirectBlockedError extends Error {
  constructor(public readonly url: string, public readonly detail?: string) {
    super(`redirect blocked: ${url}${detail ? ` (${detail})` : ""}`);
    this.name = "RedirectBlockedError";
  }
}
// loop end:
throw new RedirectBlockedError(url, "too many redirects");
```

#### Tasks
1. RED test in `web-fetch.test.ts` (or a network-guard test) for `RedirectBlockedError` on redirect-limit.
2. Add the class + change the throw.
3. typecheck.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `RedirectBlockedError` exists: `grep -q "class RedirectBlockedError" packages/sdk-tools/src/internal/network-guard.ts` exits 0
- [ ] redirect-limit throws it: a test asserts `screenedFetch` with a 3xx stub + `maxRedirects:0` throws `RedirectBlockedError` (`expect(...).rejects.toThrow(RedirectBlockedError)`)
- [ ] host-screen still throws `SsrfBlockedError`: a private-host test asserts `rejects.toThrow(SsrfBlockedError)`
- [ ] Types compile: `pnpm --filter @theokit/sdk-tools typecheck` exits 0

#### DoD (Definition of Done)
- [ ] All task acceptance criteria above pass: `pnpm --filter @theokit/sdk-tools test` exits 0
- [ ] Tests passing — `pnpm --filter @theokit/sdk-tools test`
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Biome clean

## Phase 2: `createWebFetchTool` options + mapping + export + tests

### T2.1 — Add maxRedirects/fetchImpl/lookup options + redirect_blocked mapping + barrel export

#### Objective
Add `maxRedirects?`/`fetchImpl?`/`lookup?` to `CreateWebFetchToolOptions`, forward to `screenedFetch`; catch `RedirectBlockedError` → `{ ok:false, error:'redirect_blocked' }`; export `RedirectBlockedError` from the barrel; test all paths with injection.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — exposes the redirect policy + injection seam on the public tool surface and maps the new error to a distinct code, completing the consumer-facing capability.
2. **Why it is necessary now** — it is the surface theocode adopts next cycle to delete its wrapper.

#### Evidence
`web-fetch.ts:23` (`CreateWebFetchToolOptions`), `:77-81` (`screenedFetch(...)` call), `:115-119` (`SsrfBlockedError`→`ssrf_blocked` catch); `src/index.ts` barrel.

#### Files to edit
```
packages/sdk-tools/src/web-fetch.ts — options + screenedFetch passthrough + RedirectBlockedError→redirect_blocked
packages/sdk-tools/src/index.ts — export RedirectBlockedError
packages/sdk-tools/tests/web-fetch.test.ts — maxRedirects/redirect_blocked/injection cases
```

#### Deep file dependency analysis
- `CreateWebFetchToolOptions += maxRedirects?: number; fetchImpl?: ScreenedFetchOptions['fetchImpl']; lookup?: ScreenedFetchOptions['lookup']`. In the handler, `screenedFetch(url, { signal, allowPrivateHosts, maxRedirects, fetchImpl, lookup })`. Catch order: `if (err instanceof RedirectBlockedError) return {ok:false, error:'redirect_blocked', url}`; then the existing `SsrfBlockedError`→`ssrf_blocked`; then AbortError→timeout; then fetch_failed.

#### Deep Dives
- **Edge case:** `maxRedirects:0` + a 200 response → returns content normally (no redirect → no throw). Only a 3xx triggers `redirect_blocked`.
- **Backward-compat:** absent `maxRedirects` ⇒ 5 (today); absent fetchImpl/lookup ⇒ global.
- **Injection test (no network):** `createWebFetchTool({ maxRedirects:0, lookup: ()=>[{address:'8.8.8.8'}], fetchImpl: async()=>new Response(null,{status:302}) })` → `redirect_blocked`; `lookup: ()=>[{address:'10.0.0.1'}]` → `ssrf_blocked`; public 200 → content.

#### Pseudo-code / Signatures
```ts
export interface CreateWebFetchToolOptions {
  defaultTimeoutMs?: number;
  allowPrivateHosts?: boolean;
  maxRedirects?: number;                       // 0 = block all redirects
  fetchImpl?: ScreenedFetchOptions["fetchImpl"]; // test seam
  lookup?: ScreenedFetchOptions["lookup"];       // test seam
}
// catch:
if (err instanceof RedirectBlockedError) return JSON.stringify({ ok:false, error:"redirect_blocked", url });
```

#### Tasks
1. RED tests (maxRedirects:0 → redirect_blocked; private host → ssrf_blocked; public 200 → content; all injected).
2. Add options + passthrough + catch mapping; export `RedirectBlockedError`.
3. Run full sdk-tools suite + typecheck + biome.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Options added: `grep -q "maxRedirects" packages/sdk-tools/src/web-fetch.ts` exits 0
- [ ] redirect_blocked path: a test with injected fetch (302) + `maxRedirects:0` asserts `JSON.parse(out).error === 'redirect_blocked'`
- [ ] ssrf_blocked path: an injected private-host test asserts `JSON.parse(out).error === 'ssrf_blocked'`
- [ ] injection (no network): the new tests pass with injected `fetchImpl`/`lookup` — `grep -c "fetchImpl" packages/sdk-tools/tests/web-fetch.test.ts` returns `>= 1`
- [ ] `RedirectBlockedError` exported: `grep -q "RedirectBlockedError" packages/sdk-tools/src/index.ts` exits 0
- [ ] Full suite green: `pnpm --filter @theokit/sdk-tools test` exits 0; typecheck 0; biome clean

#### DoD (Definition of Done)
- [ ] All task acceptance criteria above pass: `pnpm --filter @theokit/sdk-tools test` exits 0
- [ ] Full suite green — `pnpm --filter @theokit/sdk-tools test`
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Biome clean
- [ ] changeset added (minor)

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | createWebFetchTool can't block all redirects | T2.1 | `maxRedirects` option (0 blocks) (ADR D1) |
| G2 | redirect block conflated with ssrf_blocked | T1.1, T2.1 | distinct RedirectBlockedError → redirect_blocked (ADR D2) |
| G3 | no injection seam for no-network tests | T2.1 | fetchImpl/lookup options (ADR D3) |
| G4 | backward compat (defaults + existing codes) | T1.1, T2.1 | all optional; ssrf_blocked/invalid_url/timeout/too_large unchanged |
| G5 | consumer (theocode) can delete its wrapper | T2.1 | the option surface + seam covers the wrapper's behavior (next cycle) |
| G6 | no regression | T1.1, T2.1 | full suite + typecheck + biome green after both tasks |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] Full suite green — `pnpm --filter @theokit/sdk-tools test`
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Biome clean — `pnpm --filter @theokit/sdk-tools lint`
- [ ] changeset added (minor bump): `ls .changeset/*.md` lists the new entry
- [ ] Backward compatibility preserved: the pre-existing web-fetch tests still pass — `pnpm --filter @theokit/sdk-tools test web-fetch` exits 0 with the prior cases green
- [ ] Existing error codes unchanged: `grep -c "ssrf_blocked\|invalid_url\|timeout\|too_large" packages/sdk-tools/src/web-fetch.ts` returns `>= 4`
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged

## Failure scenarios (when I/O external)

```
web_fetch is the external-I/O surface. The tests inject `fetchImpl`/`lookup` to drive every path
WITHOUT a real network:
  - redirect (3xx) under maxRedirects:0      → redirect_blocked
  - DNS resolves to a private/reserved IP    → ssrf_blocked
  - DNS resolves to a public IP, 200         → content returned
  - non-http(s) URL                          → invalid_url
No live network is touched (the seam is the point of this slice).
```

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 1-2. The plan is NOT done until this chain passes.

### Execution
```
pnpm --filter @theokit/sdk-tools test
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools lint
```

### Acceptance Criteria
- [ ] Full sdk-tools suite green
- [ ] Zero type errors
- [ ] Biome clean
- [ ] `maxRedirects`/`fetchImpl`/`lookup` options + `redirect_blocked` + `RedirectBlockedError` export present + tested
- [ ] changeset present

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
