---
slug: m3-ssrf-guard
created_at: 2026-06-20
goal: Add an SSRF guard to sdk-tools web_fetch — resolveAndScreen(host) + screenedFetch (block-list of private/loopback/link-local/metadata ranges, IPv4-mapped unwrap, resolve-all-A-records, redirect:manual per-hop re-screen) wired secure-by-default into createWebFetchTool, measured by tests/network-guard.test.ts + tests/web-fetch.test.ts passing green.
---

# Plan: M3-1 — SSRF guard for `web_fetch`

> **Version 1.1** (edge-case-plan absorbed: EC-1 non-http-redirect + EC-2 dual-stack + EC-3 decimal-encoding folded into T1.2 TDD) — Close the SSRF hole in `@theokit/sdk-tools` `web_fetch`: a pure `isBlockedIp` block-list + `resolveAndScreen(host)` (resolve ALL A-records, throw `SsrfBlockedError` if any is private/loopback/link-local/CGNAT/metadata/reserved, IPv4-mapped unwrap) + `screenedFetch` (`redirect:"manual"` + bounded per-hop re-screen), wired SECURE-BY-DEFAULT into `createWebFetchTool` (opt-out `allowPrivateHosts`). Closes roadmap gap M3-1 (high sev). Design locked by blueprint `m3-ssrf-guard` (discover-confidence SHIPPABLE 100, ADRs D1-D6).

## Goal

> "Make `web_fetch` reject requests (and redirects) that resolve to private/loopback/link-local/cloud-metadata addresses by default, measured by `tests/network-guard.test.ts` + `tests/web-fetch.test.ts` passing green."

## Context

Roadmap gap M3-1 (`docs/gap-audit/ROADMAP.md:121`, high sev, Tema C). `packages/sdk-tools/src/web-fetch.ts:26-118` validates protocol only, never resolves DNS, and follows redirects (native default) → SSRF. The references confirm the gap (opencode `webfetch.ts:85` protocol-only, test `tool-webfetch.test.ts:121-141` ACCEPTS localhost; codex bare urllib). The SDK path-guard (`packages/sdk/src/internal/security/path-guard.ts:33-64` typed errors, `path-safety.ts:16-32` barrel) is the pattern. Node builtins (`node:dns`/`node:net`) suffice — zero new deps. Blueprint decisions: secure-by-default (D2), redirect:manual per-hop (D3), TOCTOU v1 = screen-all + re-screen-hops, IP-pinning deferred (D4), normalize before range-check (D5), guard in sdk-tools internal (D6).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-tools/src/internal/network-guard.ts` (NEW) | 0 | — | (the SSRF guard primitives) | — |
| `packages/sdk-tools/src/web-fetch.ts` | 118 | — | `createWebFetchTool` (protocol-only, follows redirects) | preserve existing returns; ADD screening |
| `packages/sdk-tools/src/index.ts` | (barrel) | — | sdk-tools public exports | additive exports only |
| `packages/sdk-tools/tests/network-guard.test.ts` (NEW) | 0 | — | unit tests — RED first | — |
| `packages/sdk-tools/tests/web-fetch.test.ts` | 63 | — | web_fetch tests (no SSRF cases) | additive SSRF cases |
| `packages/sdk/src/errors.ts` | 698 | — | `ConfigurationError` (extended by `SsrfBlockedError`) | read-only |
| `docs.md` | (contract) | — | public API contract | additive web_fetch SSRF note |
| `packages/sdk/CHANGELOG.md` (root) + `.changeset/` (NEW) | — | — | changelog + changeset | additive entry |

### Current callers / dependents

- **`createWebFetchTool`** (`packages/sdk-tools/src/web-fetch.ts:26`) — exported from the sdk-tools barrel; consumers build coding agents with it. Making the guard default-on changes its behavior (localhost/private now blocked) — the intended security fix; opt-out preserved.
- **NEW symbols** `resolveAndScreen`/`SsrfBlockedError`/`isBlockedIp`/`screenedFetch` — exported from the sdk-tools barrel as reusable network-security primitives (wired into web-fetch + integration-tested → no orphan).
- **`ConfigurationError`** (`@theokit/sdk`, errors.ts:205) — base class for `SsrfBlockedError`; already a sdk-tools peer dep.

### Domain glossary

- **SSRF** — Server-Side Request Forgery: tricking the server into fetching an attacker-chosen internal URL (e.g. cloud metadata `169.254.169.254`).
- **block-list** — the set of IP ranges a fetch must refuse (loopback/private/link-local/CGNAT/metadata/reserved).
- **resolve-all-A-records** — resolving a hostname to EVERY address and screening each (a host with one public + one private record must be blocked).
- **TOCTOU / DNS rebinding** — the race where DNS resolves to a safe IP at screen time and a private IP at fetch time.
- **IPv4-mapped IPv6** — `::ffff:a.b.c.d` — must be unwrapped to the IPv4 address and re-checked.

### Architecture boundaries affected

Per `rules/architecture.md` §2: `network-guard.ts` is a domain security primitive in sdk-tools `internal/`; it depends only on Node builtins + `ConfigurationError` (public). `resolveAndScreen`/`screenedFetch` take injectable `lookup`/`fetchImpl` (DIP — deterministic tests without real DNS/network). The guard is wired at the composition point (`createWebFetchTool`).

## Prior Art & Related Work

- **Internal blueprint** `knowledge-base/discoveries/blueprints/m3-ssrf-guard-blueprint.md` (ADRs D1-D6).
- **SDK security-primitive pattern** `packages/sdk/src/internal/security/path-guard.ts` + `path-safety.ts` (typed `ConfigurationError` subclass + deny-list + barrel).
- **Reference counter-examples** opencode `webfetch.ts` (accepts localhost), codex urllib (no screening) — the gap M3-1 fixes.
- **Canonical SSRF defense** — IETF private/reserved ranges; `dns.promises.lookup({all:true})` + `net.isIP`.

## Objective

- [ ] `network-guard.ts` exports `isBlockedIp`, `resolveAndScreen`, `screenedFetch`, `SsrfBlockedError`.
- [ ] `isBlockedIp(ip)` blocks all canonical IPv4+IPv6 ranges incl. IPv4-mapped unwrap + alternate-encoding normalization.
- [ ] `resolveAndScreen(host,{lookup?})` resolves ALL records, throws `SsrfBlockedError` if any blocked; returns IPs otherwise.
- [ ] `screenedFetch(url,{fetchImpl?,lookup?,maxRedirects?,allowPrivateHosts?,signal?})` screens + `redirect:"manual"` per-hop re-screen.
- [ ] `createWebFetchTool` guards by default; `allowPrivateHosts?:boolean` (default false) opt-out; blocked → `{ok:false,error:"ssrf_blocked"}`.
- [ ] Zero new deps; barrel exports; docs.md + CHANGELOG + changeset.
- [ ] `tests/network-guard.test.ts` + `tests/web-fetch.test.ts` green; typecheck + Biome clean.

## ADRs

### D1 — Pure `isBlockedIp` block-list + `SsrfBlockedError`
**Decision:** `isBlockedIp(ip: string): boolean` checks the parsed address against the canonical ranges (IPv4: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8, 224/4, 240/4; IPv6: ::1, fe80::/10, fc00::/7; IPv4-mapped `::ffff:` → unwrap + re-check). `SsrfBlockedError extends ConfigurationError` (`code:"ssrf_blocked"`). Pure (no I/O) → exhaustively unit-testable.
**Rationale:** mirrors path-guard's pure deny-list + typed error; CIDR via bitwise on parsed octets (`net.isIP` to classify).
**Alternatives considered:** an `ip`/`cidr` npm lib (rejected — Rule 9 says prefer mature libs, but a ~30-line builtin block-list avoids a transitive dep for a security-critical path where auditability matters; blueprint D-deps); allow-list (rejected — the web is an open allow set; deny-list of private ranges is the standard).

### D2 — Secure-by-default in `createWebFetchTool` (opt-out `allowPrivateHosts`)
**Decision:** guard ON by default in `createWebFetchTool`; `allowPrivateHosts?:boolean` (default false) opt-out. Blocked → `{ok:false,error:"ssrf_blocked",reason}` (matches the tool's error-return contract; does NOT throw to the model).
**Rationale:** secure-by-default > a separate guarded factory consumers forget (blueprint D2). Behavior change (localhost blocked) is the intended fix; opt-out is the escape hatch.
**Alternatives considered:** separate `createGuardedWebFetchTool` leaving the open one (rejected — footgun); no opt-out (rejected — breaks local-dev tools).

### D3 — `screenedFetch` with `redirect:"manual"` + bounded per-hop re-screen
**Decision:** `screenedFetch` sets `redirect:"manual"`, follows up to `maxRedirects` (default 5), calling `resolveAndScreen` on each `Location` host before following; injectable `fetchImpl`/`lookup` for tests.
**Rationale:** native redirect-following reaches unscreened internal targets (opencode `:144-176`); per-hop re-screen + injection = deterministic tests.
**Alternatives considered:** `redirect:"error"` (rejected — breaks legit redirects); follow without re-screen (rejected — the hole).

### D4 — TOCTOU v1 = screen-all + re-screen-hops; IP-pinning deferred
**Decision:** v1 screens ALL A-records + re-screens redirect hops; full IP-pinning (undici dispatcher `connect.lookup`) is a documented follow-up; the narrow screen→fetch window is accepted for v1.
**Rationale:** blocks the common vectors; IP-pinning complexity is disproportionate for v1 (KISS/YAGNI), recorded honestly (blueprint EC-1).
**Alternatives considered:** IP-pin now (rejected — complex); ignore TOCTOU (rejected — must state it).

### D5 — Normalize before range-check; reject alternate encodings
**Decision:** range-check the PARSED address: `net.isIP` classifies; a non-IP host is DNS-resolved (which canonicalizes decimal/octal/hex/short forms to real IPs) then screened; IPv4-mapped IPv6 is unwrapped. A 3xx `Location` whose protocol is not http(s) is rejected.
**Rationale:** decimal/octal/hex IP encodings bypass naive string checks; resolving them yields the canonical IP which `isBlockedIp` then catches (edge-case EC-3). Non-http redirect targets have no screenable host (EC-1).
**Alternatives considered:** raw-string prefix match (rejected — trivially bypassed); follow any redirect scheme (rejected — non-http target unscreenable).

### D6 — Placement: `sdk-tools/internal/network-guard.ts`, exported from the sdk-tools barrel
**Decision:** `isBlockedIp`/`resolveAndScreen`/`screenedFetch`/`SsrfBlockedError` live in `packages/sdk-tools/src/internal/network-guard.ts`, exported from `packages/sdk-tools/src/index.ts`. `SsrfBlockedError extends ConfigurationError` (from `@theokit/sdk`, an existing peer dep).
**Rationale:** the guard is tool-specific (web-fetch lives in sdk-tools); reuses the existing sdk-tools→sdk peer dep; matches the tool's error-return contract.
**Alternatives considered:** promote to an `@theokit/sdk` core `network-safety` subpath (rejected — YAGNI until a 2nd consumer; sdk-tools is the right home).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Behavior change — existing consumers fetching localhost/private now get `ssrf_blocked` | Medium | `allowPrivateHosts:true` opt-out; CHANGELOG documents the hardening; it is the intended security fix | SDK |
| Residual DNS-rebinding window (TOCTOU) since v1 does not pin the resolved IP | Medium | screen ALL A-records + re-screen every redirect hop closes the common vectors; IP-pinning is a documented follow-up (ADR D4) | SDK |
| A hand-rolled CIDR block-list could miss a range or mis-normalize an encoding | Medium | exhaustive unit tests per range + per encoding (decimal/octal/hex/short/IPv4-mapped); `net.isIP` for classification | SDK |

## Unresolved Questions

- (none — every decision resolved at plan time via blueprint ADRs D1-D6. Whether to publish `network-safety` as an `@theokit/sdk` core subpath (vs sdk-tools-internal) is deferred — YAGNI until a 2nd consumer; ADR D6.)

## Dependency Graph

```
Phase 1 (pure block-list + resolveAndScreen + screenedFetch) ──▶ Phase 2 (wire into createWebFetchTool + export + docs) ──▶ Final Phase (integration validation)
```

---

## Phase 1: Network-guard primitives

### T1.1 — `isBlockedIp` block-list + `SsrfBlockedError`

#### Objective
Create `internal/network-guard.ts` with the pure `isBlockedIp` block-list + `SsrfBlockedError`.

#### Why this step (action + reasoning)
1. **What** — the pure, I/O-free core: classify an IP against the canonical block-list + the typed error.
2. **Why now** — it is the load-bearing correctness surface (every range + encoding) and is fully unit-testable without DNS/network; `resolveAndScreen`/`screenedFetch` build on it.

#### Evidence
Blueprint D1 + Technique 1/4. Block-list ranges (blueprint Corner 4). `ConfigurationError` (`packages/sdk/src/errors.ts:205`). `net.isIP` (Node builtin).

#### Files to edit
```
packages/sdk-tools/src/internal/network-guard.ts — NEW: isBlockedIp, SsrfBlockedError
packages/sdk-tools/tests/network-guard.test.ts — NEW: RED tests first
```

#### Deep file dependency analysis
- `network-guard.ts` imports `ConfigurationError` from `@theokit/sdk` + `node:net`. No other file changes this task.

#### Pseudo-code / Signatures
```pseudocode
class SsrfBlockedError extends ConfigurationError  // code:"ssrf_blocked"
function isBlockedIp(ip: string): boolean
  fam = net.isIP(ip)              // 0 | 4 | 6
  if fam === 4: return inAnyV4Range(toOctets(ip))   // 127/8,10/8,172.16/12,192.168/16,169.254/16,100.64/10,0/8,224/4,240/4
  if fam === 6:
    if isV4Mapped(ip): return isBlockedIp(unwrapV4(ip))   // ::ffff:a.b.c.d
    return inAnyV6Range(ip)        // ::1, fe80::/10, fc00::/7
  return true   // not a valid IP literal → treat as blocked (caller resolves names first)
```

#### TDD
```
RED: test_isBlockedIp_loopback_v4() — 127.0.0.1 / 127.255.255.255 → true
RED: test_isBlockedIp_private_v4() — 10.0.0.1 / 172.16.0.1 / 172.31.255.255 / 192.168.1.1 → true
RED: test_isBlockedIp_link_local_and_metadata() — 169.254.1.1 / 169.254.169.254 → true
RED: test_isBlockedIp_cgnat() — 100.64.0.1 → true
RED: test_isBlockedIp_zero_and_reserved() — 0.0.0.0 / 224.0.0.1 / 240.0.0.1 → true
RED: test_isBlockedIp_public_v4_allowed() — 8.8.8.8 / 1.1.1.1 → false
RED: test_isBlockedIp_v6_loopback_linklocal_ula() — ::1 / fe80::1 / fc00::1 → true
RED: test_isBlockedIp_v6_public_allowed() — 2606:4700:4700::1111 → false
RED: test_isBlockedIp_ipv4_mapped_unwraps() — ::ffff:127.0.0.1 / ::ffff:169.254.169.254 → true; ::ffff:8.8.8.8 → false
RED: test_isBlockedIp_172_15_and_172_32_allowed() — 172.15.0.1 / 172.32.0.1 → false (boundary)
RED: test_isBlockedIp_non_ip_returns_true() — "not-an-ip" → true (defensive)
GREEN: implement network-guard.ts
REFACTOR: Biome complexity ≤ 10 (extract inV4Range/inV6Range helpers)
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/network-guard.test.ts -t isBlockedIp
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/network-guard.test.ts -t "isBlockedIp"` reports 11/11 tests passed
- [ ] `test_isBlockedIp_ipv4_mapped_unwraps` passes (ADR D1 unwrap)
- [ ] `test_isBlockedIp_172_15_and_172_32_allowed` passes (CIDR boundary correctness)
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check packages/sdk-tools/src/internal/network-guard.ts` reports 0 errors

#### DoD
- [ ] those tests green; `pnpm --filter @theokit/sdk-tools typecheck` exits 0

### T1.2 — `resolveAndScreen` + `screenedFetch` (injectable lookup/fetch)

#### Objective
Add `resolveAndScreen(host,{lookup?})` + `screenedFetch(url,opts)` to `network-guard.ts`.

#### Why this step (action + reasoning)
1. **What** — resolve-all-A-records screening + the `redirect:"manual"` per-hop re-screen fetch wrapper.
2. **Why now** — builds on T1.1's `isBlockedIp`; the injectable `lookup`/`fetchImpl` make the DNS + redirect paths deterministically testable (DIP).

#### Evidence
Blueprint D1/D3/D4 + Technique 2/3. `dns.promises.lookup(host,{all:true})` (Node builtin). opencode redirect-follow gap (`tool-webfetch.test.ts:144-176`).

#### Files to edit
```
packages/sdk-tools/src/internal/network-guard.ts — add resolveAndScreen + screenedFetch
packages/sdk-tools/tests/network-guard.test.ts — add RED tests
```

#### Deep file dependency analysis
- adds `import { lookup } from "node:dns/promises"` (default injectable). `screenedFetch` defaults `fetchImpl` to global `fetch`. No production caller yet (wired in T2.1).

#### Pseudo-code / Signatures
```pseudocode
async resolveAndScreen(host, { lookup = dnsLookup } = {}): Promise<string[]>
  if net.isIP(host): if isBlockedIp(host) throw SsrfBlockedError(host); return [host]
  addrs = await lookup(host, { all: true })           // [{address}]
  for a of addrs: if isBlockedIp(a.address) throw SsrfBlockedError(host, a.address)
  if addrs.length === 0: throw SsrfBlockedError(host, "no addresses")
  return addrs.map(a => a.address)

async screenedFetch(url, { fetchImpl = fetch, lookup, maxRedirects = 5, allowPrivateHosts = false, signal } = {}): Promise<Response>
  let current = url
  for hop in 0..maxRedirects:
    if not allowPrivateHosts: await resolveAndScreen(new URL(current).hostname, { lookup })
    res = await fetchImpl(current, { redirect: "manual", signal })
    if res.status in {301,302,303,307,308} and res.headers.Location:
      next = new URL(res.headers.Location, current)
      if next.protocol not in {http:,https:}: throw SsrfBlockedError(url, "non-http redirect")  // EC-1
      current = next.href; continue
    return res
  throw SsrfBlockedError(url, "too many redirects")
```

#### TDD
```
RED: test_resolveAndScreen_blocks_resolved_private() — fake lookup → [{address:"127.0.0.1"}] → throws SsrfBlockedError
RED: test_resolveAndScreen_blocks_if_any_record_private() — lookup → [{8.8.8.8},{10.0.0.1}] → throws (any-blocked)
RED: test_resolveAndScreen_allows_public() — lookup → [{8.8.8.8}] → returns ["8.8.8.8"]
RED: test_resolveAndScreen_ip_literal_blocked() — host "169.254.169.254" → throws (no DNS)
RED: test_screenedFetch_blocks_redirect_to_private() — fakeFetch: 302 Location http://127.0.0.1/ → screenedFetch throws SsrfBlockedError on the hop
RED: test_screenedFetch_allows_public_redirect_chain() — fakeFetch: 302→public→200 → returns final Response
RED: test_screenedFetch_allowPrivateHosts_skips_screen() — allowPrivateHosts:true + private host → does NOT throw (delegates to fakeFetch)
RED: test_screenedFetch_too_many_redirects() — fakeFetch always 302 → throws after maxRedirects
RED: test_screenedFetch_blocks_non_http_redirect() — 302 Location file:///etc/passwd → throws SsrfBlockedError (edge-case EC-1)
RED: test_resolveAndScreen_blocks_dual_stack_when_any_family_blocked() — lookup → [{8.8.8.8},{::1}] → throws (edge-case EC-2)
RED: test_resolveAndScreen_blocks_decimal_encoded_localhost() — lookup("2130706433") → [{127.0.0.1}] → throws (edge-case EC-3)
GREEN: implement resolveAndScreen + screenedFetch
REFACTOR: Biome complexity ≤ 10
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/network-guard.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/network-guard.test.ts` reports 22/22 tests passed (11 from T1.1 + 11 here)
- [ ] `test_resolveAndScreen_blocks_if_any_record_private` passes (resolve-all, ADR D1)
- [ ] `test_screenedFetch_blocks_redirect_to_private` passes (per-hop re-screen, ADR D3)
- [ ] `grep -c "redirect: \"manual\"\|redirect:\"manual\"" packages/sdk-tools/src/internal/network-guard.ts` returns ≥ 1
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check packages/sdk-tools/src/internal/network-guard.ts` reports 0 errors

#### DoD
- [ ] 22/22 green; typecheck exit 0

---

## Phase 2: Wire into `web_fetch` + export

### T2.1 — Secure-by-default `createWebFetchTool` + barrel export + docs

#### Objective
Wire `screenedFetch` into `createWebFetchTool` (default-on, `allowPrivateHosts` opt-out), export the primitives, add SSRF integration tests + docs + changeset + CHANGELOG.

#### Why this step (action + reasoning)
1. **What** — replace the raw `fetch` in the handler with `screenedFetch`; add `allowPrivateHosts` to options; return `{ok:false,error:"ssrf_blocked"}` on block; export `resolveAndScreen`/`SsrfBlockedError`/`isBlockedIp`/`screenedFetch`.
2. **Why now** — per `no-stubs-no-mocks-no-wired.md` the primitives need a real caller; per CLAUDE.md docs.md reflects the public-surface change.

#### Evidence
`web-fetch.ts:64` (`fetch(url,{signal})` → replace), `:21-24` options, the handler's error-return shape. Blueprint D2/D6.

#### Files to edit
```
packages/sdk-tools/src/web-fetch.ts — screenedFetch + allowPrivateHosts opt-out + ssrf_blocked return
packages/sdk-tools/src/index.ts — export resolveAndScreen, SsrfBlockedError, isBlockedIp, screenedFetch
packages/sdk-tools/tests/web-fetch.test.ts — SSRF integration cases
docs.md — web_fetch SSRF note
packages/sdk/CHANGELOG.md (root) — [Unreleased] § Added/Security entry
.changeset/m3-ssrf-guard.md — NEW minor changeset
```

#### Deep file dependency analysis
- `web-fetch.ts` imports `screenedFetch` + `SsrfBlockedError` from `./internal/network-guard.js`; handler wraps the fetch + catches `SsrfBlockedError`. `index.ts` additive exports. web-fetch tests add SSRF cases using literal-IP URLs (deterministic, no DNS) + an injected-fetch redirect case via `screenedFetch` (already covered in T1.2; here assert the TOOL returns `{ok:false,error:"ssrf_blocked"}`).

#### TDD
```
RED: test_web_fetch_blocks_loopback_ip() — createWebFetchTool().handler({url:"http://127.0.0.1/"}) → {ok:false,error:"ssrf_blocked"}
RED: test_web_fetch_blocks_metadata_ip() — url "http://169.254.169.254/latest/meta-data/" → ssrf_blocked
RED: test_web_fetch_blocks_ipv6_loopback() — url "http://[::1]/" → ssrf_blocked
RED: test_web_fetch_allowPrivateHosts_opt_out() — createWebFetchTool({allowPrivateHosts:true}).handler({url:"http://127.0.0.1:1/"}) → NOT ssrf_blocked (fetch_failed/timeout instead)
RED: test_web_fetch_still_rejects_non_http() — file:// → invalid_url (regression — existing behavior preserved)
RED: test_network_guard_symbols_exported() — import { resolveAndScreen, SsrfBlockedError, isBlockedIp, screenedFetch } from sdk-tools barrel → all defined
GREEN: wire screenedFetch + allowPrivateHosts + barrel exports + docs + changeset + CHANGELOG
REFACTOR: keep handler complexity ≤ existing budget (extract if needed)
VERIFY: pnpm --filter @theokit/sdk-tools exec vitest run tests/web-fetch.test.ts
```

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/sdk-tools exec vitest run tests/web-fetch.test.ts` reports all tests passed (existing + 6 new)
- [ ] `test_web_fetch_blocks_metadata_ip` passes (cloud-metadata blocked — the headline fix)
- [ ] `test_web_fetch_allowPrivateHosts_opt_out` passes (opt-out, ADR D2)
- [ ] `node -e "const m=require('./packages/sdk-tools/dist/index.cjs'); process.exit(m.resolveAndScreen&&m.SsrfBlockedError&&m.isBlockedIp?0:1)"` exits 0 after build (barrel exports) — OR a source-level import assertion in the test
- [ ] `grep -c "@theokit/sdk-tools" docs.md` shows the web_fetch SSRF note present (`grep -c "ssrf" docs.md` ≥ 1) AND `ls .changeset/m3-ssrf-guard.md` exists AND `grep -c "ssrf" packages/sdk/CHANGELOG.md` ≥ 1
- [ ] `pnpm --filter @theokit/sdk-tools exec biome check` clean on changed files

#### DoD
- [ ] web-fetch tests green; typecheck exit 0; `pnpm --filter @theokit/sdk-tools build` succeeds; docs/changeset/CHANGELOG present

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No IP block-list (M3-1) | T1.1 | `isBlockedIp` canonical ranges + IPv4-mapped unwrap (D1) |
| 2 | No DNS resolve-all screening | T1.2 | `resolveAndScreen` resolves all + throws on any blocked (D1) |
| 3 | Redirects followed unscreened | T1.2 | `screenedFetch` `redirect:"manual"` + per-hop re-screen (D3) |
| 4 | web_fetch unguarded | T2.1 | secure-by-default `createWebFetchTool` + `allowPrivateHosts` opt-out (D2) |
| 5 | Typed error | T1.1 | `SsrfBlockedError extends ConfigurationError` |
| 6 | Zero new deps | T1.1/T1.2 | Node `dns`/`net` builtins only |
| 7 | TOCTOU + encoding normalization | T1.1/T1.2 | screen-all + re-screen-hops (D4); normalize before range-check (D5) |
| 8 | Document + record + export | T2.1 | barrel exports + docs.md + changeset + CHANGELOG + integration tests |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools exec vitest run` green
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Zero lint warnings — `pnpm --filter @theokit/sdk-tools exec biome check`
- [ ] Dead-code clean — `pnpm quality:dead` (knip)
- [ ] Build clean — `pnpm --filter @theokit/sdk-tools build`
- [ ] File-size budget respected (`network-guard.ts` ≤ 500, target ≤ 200)
- [ ] CHANGELOG.md updated under `[Unreleased]` + changeset added (Unbreakable Rule 6)
- [ ] Backward compatibility: documented behavior change (private now blocked) + `allowPrivateHosts` opt-out
- [ ] `docs.md` reflects the web_fetch SSRF guard
- [ ] Plan-specific: cloud-metadata `169.254.169.254` blocked; IPv4-mapped unwrapped; redirect-to-private blocked; resolve-all-A-records; secure-by-default with opt-out
- [ ] Plan archived after `/review` READY_TO_MERGE + PR merge

## Dependencies

M3-1 introduces ZERO new dependencies — Node `node:dns` + `node:net` builtins (Rule 9 / KISS).

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` (`ConfigurationError`, `CustomTool`, `defineTool`) | workspace | npm/TS | error base + tool contract (existing sdk-tools peer dep) |
| `zod` | existing | npm/TS | input schema (already used) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | An `ip`/`is-ip`/`cidr` npm lib was evaluated + rejected: a ~30-line builtin block-list over `node:net` avoids a transitive dependency on a security-critical path (auditability) and matches the references which use zero screening libs. | n/a — Node builtins only |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Failure scenarios

`screenedFetch` performs network I/O (DNS + fetch). Failure modes: (a) DNS lookup fails → `resolveAndScreen` rejects; the web-fetch handler maps it to `{ok:false,error:"fetch_failed"}` (or surfaces a resolution error) — NOT silently allowed. (b) `SsrfBlockedError` → `{ok:false,error:"ssrf_blocked"}`. (c) timeout (existing AbortController) → `{ok:false,error:"timeout"}`. (d) redirect loop exceeds `maxRedirects` → `SsrfBlockedError` ("too many redirects") → `ssrf_blocked`. Resilience-under-failure: the guard FAILS CLOSED (any screening/resolution failure blocks rather than allows).

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/sdk-tools exec vitest run tests/network-guard.test.ts tests/web-fetch.test.ts
pnpm --filter @theokit/sdk-tools exec vitest run        # full sdk-tools suite — no regression
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools exec biome check
pnpm quality:dead
pnpm --filter @theokit/sdk-tools build
```

### Acceptance Criteria
- [ ] Unit + integration suites green (28 new tests)
- [ ] Full sdk-tools suite green (no regression)
- [ ] Zero type errors / zero lint warnings
- [ ] knip clean (new exports not orphan — wired into web-fetch + integration-tested)
- [ ] `pnpm --filter @theokit/sdk-tools build` succeeds
- [ ] Runtime-metric proof — N/A (the guard fails closed; observable via the `ssrf_blocked` error result, consistent with the tool's error contract)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description; they do not block.
