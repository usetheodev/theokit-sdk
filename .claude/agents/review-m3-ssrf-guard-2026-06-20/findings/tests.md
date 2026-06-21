---
agent: review-m3-ssrf-guard-tests
review_target: M3-1 SSRF guard test suite (plan m3-ssrf-guard)
plan: .claude/knowledge-base/plans/m3-ssrf-guard-plan.md
rule: .claude/rules/testing.md
date: 2026-06-20
files_reviewed:
  - packages/sdk-tools/tests/network-guard.test.ts   # 22 tests
  - packages/sdk-tools/tests/web-fetch.test.ts        # 11 tests
  - packages/sdk-tools/src/internal/network-guard.ts  # production
  - packages/sdk-tools/src/web-fetch.ts               # production
  - packages/sdk-tools/src/index.ts                   # barrel
verdict: READY_TO_MERGE (with caveats — gaps are LOW/MEDIUM, none BLOCKER)
---

# Test-quality review — M3-1 SSRF guard

## Verdict

**READY_TO_MERGE_WITH_CAVEATS** — 0 BLOCKER, 0 HIGH, 3 MEDIUM, 5 LOW.

The suite is genuinely strong: AAA/GWT format, fully deterministic (injectable
`lookup`/`fetchImpl` — verified no real DNS/network in unit tests), behavior-not-
implementation, and the `rejects.toBeInstanceOf(SsrfBlockedError)` assertions
**do** exercise the throw path (mutation-verified below). Every block-list range,
the IPv4-mapped unwrap, the 172.15/172.32 boundary, public-allowed, secure-by-
default, `allowPrivateHosts` opt-out, and the barrel export are all covered. The
gaps are missing SSRF *scenarios* the plan/brief explicitly call out, not vacuous
assertions.

## Determinism — PASS

- `isBlockedIp` is pure → no I/O.
- `resolveAndScreen` / `screenedFetch` are always called with injected `lookup`
  and/or `fetchImpl` in `network-guard.test.ts`. No real DNS, no real socket.
- `web-fetch.test.ts` SSRF cases use IP-literal URLs (`127.0.0.1`, `169.254.169.254`,
  `[::1]`) → `resolveAndScreen` short-circuits on `isIP(host) !== 0` before any DNS
  call. Deterministic. Confirmed by reading the production short-circuit
  (`network-guard.ts:129`).
- Test runtime: 22 network-guard tests in 25ms. No `vi.useFakeTimers` needed (no
  time/random in unit paths).
- NOTE (not a finding — out of suite scope): `web-fetch.test.ts` has TWO
  network-touching tests by design — `timeout` (`192.0.2.1:1` TEST-NET) and
  `happy path (live)` (`httpbin.org`). Both are written defensively (accept
  `fetch_failed`/`timeout`) so they are non-flaky, but they are NOT in the
  injectable-determinism contract. They were already in the file pre-M3 and are
  not SSRF tests. Acceptable.

## Vacuous-assertion check — PASS (mutation-verified)

I mutated `network-guard.ts:130` (`if (isBlockedIp(host)) throw …` →
`if (false) throw …`) and re-ran: `test_resolveAndScreen_ip_literal_blocked`
went **red** (1 failed / 21 passed). This proves the
`rejects.toBeInstanceOf(SsrfBlockedError)` assertions are live — they fail when
the throw path is removed. Restored production to original (git diff clean). No
vacuous assertions found.

## Coverage of the plan's required matrix — PASS

| Required (plan/brief) | Covered | Where |
|---|---|---|
| Every block-list IPv4 range (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8, 224/4, 240/4) | YES | network-guard.test.ts:17-37 |
| IPv6 ::1 / fe80::/10 / fc00::/7 | YES | :42-46 |
| IPv4-mapped unwrap (block + allow) | YES | :50-54 |
| Boundary 172.15 / 172.32 allowed | YES | :55-58 |
| Public IPv4/IPv6 allowed | YES | :38-41, :47-49 |
| non-IP → blocked (fail-closed) | YES | :59-61 |
| resolve-all: any-record-private blocks | YES | :76-82 |
| dual-stack (EC-2) | YES | :91-97 |
| decimal-encoding (EC-3) | YES | :98-102 |
| redirect-to-private re-screen (per-hop) | YES (302 only) | :119-130 |
| non-http redirect (EC-1) | YES | :154-161 |
| too-many-redirects | YES | :145-153 |
| secure-by-default tool block | YES | web-fetch.test.ts:51-66 |
| allowPrivateHosts opt-out | YES (both layers) | network-guard:138-144, web-fetch:68-75 |
| barrel export | YES | web-fetch.test.ts:77-82 |

## Findings

### F-tests-1 — MEDIUM — only 302 redirects exercised; 307/308 (method-preserving) untested
- file: packages/sdk-tools/tests/network-guard.test.ts:119, :145, :154
- plan_ref: ADR D3 / T1.2 — `REDIRECT_STATUSES = {301,302,303,307,308}`
- detail: The brief explicitly asks "a 307/308 redirect" as a meaningful scenario.
  Production treats all five statuses identically (`network-guard.ts:143`), but
  the tests only ever emit `302`. 307/308 are the method-preserving redirects an
  attacker is most likely to use to smuggle a POST to an internal host. A
  regression that narrowed `REDIRECT_STATUSES` to drop 307/308 would NOT be caught.
- fix: Add `test_screenedFetch_blocks_307_redirect_to_private` (302→307) and
  ideally parametrize the redirect-to-private case over all five statuses.

### F-tests-2 — MEDIUM — no public-IPv6 host allowed through resolveAndScreen/screenedFetch
- file: packages/sdk-tools/tests/network-guard.test.ts:83, :131
- plan_ref: brief — "an IPv6 public address allowed"
- detail: Public IPv6 is asserted only at the pure `isBlockedIp` layer
  (`2606:4700:4700::1111` → false, :48). No test feeds a public IPv6 record
  through `resolveAndScreen` (e.g. `fakeLookup([{address:"2606:4700:4700::1111"}])`
  → resolves) nor through `screenedFetch`. The resolve/screen *allow* path is only
  exercised with IPv4 (`8.8.8.8`). A bug that mishandled an IPv6 record in the
  resolve loop (e.g. an over-broad `isBlockedV6` prefix match) on the allow side
  would slip through.
- fix: Add `test_resolveAndScreen_allows_public_ipv6` →
  `resolves.toEqual(["2606:4700:4700::1111"])`.

### F-tests-3 — MEDIUM — resolveAndScreen "no addresses" throw path untested
- file: packages/sdk-tools/src/internal/network-guard.ts:135 (untested branch)
- plan_ref: plan T1.2 pseudo-code `if addrs.length === 0: throw SsrfBlockedError(host,"no addresses")` + § Failure scenarios "FAILS CLOSED"
- detail: The fail-closed branch `if (addrs.length === 0) throw …` has no test.
  `fakeLookup([])` is never used. This is the explicit "guard fails closed on
  empty resolution" invariant from the plan's Failure-scenarios section — a
  security-load-bearing branch with zero coverage. A mutation deleting this line
  (returning `[]`/allowing the fetch) would not be caught.
- fix: Add `test_resolveAndScreen_throws_when_no_addresses` with
  `lookup: fakeLookup([])` → `rejects.toBeInstanceOf(SsrfBlockedError)`.

### F-tests-4 — LOW — mixed public+private is single-direction only (private-first untested)
- file: packages/sdk-tools/tests/network-guard.test.ts:76
- plan_ref: brief — "a host resolving to mixed public+private"
- detail: `test_resolveAndScreen_blocks_if_any_record_private` orders records as
  `[public, private]` (`8.8.8.8` then `10.0.0.1`). The dual-stack test is
  `[8.8.8.8, ::1]` — also public-first. Production iterates the full array, so a
  `[private, public]` ordering exercises the same loop, but an order-dependent
  regression (e.g. a future short-circuit-on-first-public optimization) would
  pass these tests while being exploitable. Low because current code is order-
  agnostic.
- fix: Add a `[10.0.0.1, 8.8.8.8]` (private-first) variant, or parametrize.

### F-tests-5 — LOW — redirect re-screen only proven at hop 1; multi-hop public→…→private untested
- file: packages/sdk-tools/tests/network-guard.test.ts:119
- plan_ref: ADR D3 "bounded per-hop re-screen"
- detail: `test_screenedFetch_blocks_redirect_to_private` blocks on the FIRST
  redirect target. The "per-hop" claim (re-screen on EVERY hop, not just hop 1)
  is not proven for a deep chain (e.g. public → public/2 → 127.0.0.1 blocked at
  hop 2). The allow-chain test (:131) is 2 hops but both public. Combining: no
  test proves a private target at hop ≥ 2 is caught.
- fix: Add a 3-response sequence (302 public, 302 →127.0.0.1, …) asserting the
  block fires at the later hop, with a per-host `lookup`.

### F-tests-6 — LOW — IPv6 `::` (unspecified/wildcard) and bare-`::1` resolve path not tested
- file: packages/sdk-tools/src/internal/network-guard.ts:81
- plan_ref: D1 IPv6 ranges
- detail: Production blocks bare `::` (`isBlockedV6` :81) — the "all interfaces"
  wildcard, an SSRF vector — but no test asserts `isBlockedIp("::")` → true. Only
  `::1` is tested. Low: defensive branch, but it's a real range with no guard test.
- fix: Add `::` and `0.0.0.0` (the latter IS covered at :34) to the v6 block list test.

### F-tests-7 — LOW — plan/test count drift (documentation accuracy, not coverage)
- file: packages/sdk-tools/tests/network-guard.test.ts
- plan_ref: plan T1.2 lists 11 RED tests for resolveAndScreen+screenedFetch; the file has 11 (6 resolveAndScreen + 5 screenedFetch). T1.1 lists 11 isBlockedIp; the file has 11. Total 22 ✓.
- detail: The plan's TDD block for T1.2 enumerates `test_resolveAndScreen_blocks_resolved_private`,
  `…_blocks_if_any_record_private`, `…_allows_public`, `…_ip_literal_blocked` (4),
  + 5 screenedFetch + 2 edge (dual-stack, decimal) = 11, but the decimal/dual-stack
  are resolveAndScreen tests not screenedFetch. The file groups them correctly (6+5).
  The count matches (22 total per acceptance criterion T1.2). No coverage loss —
  flagged only so the reviewer doesn't mistake the grouping for a missing test.
- fix: None required. Informational.

### F-tests-8 — LOW — web-fetch SSRF cases don't assert the `reason` field surfaced to the model
- file: packages/sdk-tools/tests/web-fetch.test.ts:53, :60, :65
- plan_ref: ADR D2 — blocked → `{ok:false,error:"ssrf_blocked",reason}`
- detail: Production returns `{ ok:false, error:"ssrf_blocked", url, reason: err.message }`
  (web-fetch.ts:118). Tests use `toMatchObject({ok:false,error:"ssrf_blocked"})`
  which (correctly) ignores `reason`. The `reason`/`url` passthrough is part of the
  documented tool contract but unverified. Low — the headline `error` field is
  asserted.
- fix: Optionally assert `parsed.reason` is a non-empty string in one case.

## Pyramid / hygiene — PASS

- No `.only`, `.skip`, `xit`, `xtest`, commented-out tests (BLOCKER check — clean).
- Test names describe behavior; the `test_*` literals match the plan's TDD RED list.
- One behavior per test; no "and"-named tests.
- Tests are independent (no shared mutable state; `fakeFetchSeq` closes over its own
  counter per invocation).
- Mocks are precise: `fakeLookup` / `fakeFetchSeq` mock exactly the DNS + fetch
  boundary, not the world. No over-mocking.

## Summary counts

- BLOCKER: 0
- HIGH: 0
- MEDIUM: 3 (F-tests-1 307/308, F-tests-2 public-IPv6 resolve path, F-tests-3 no-addresses fail-closed)
- LOW: 5 (F-tests-4..8)
- Vacuous assertions: 0 (mutation-verified)
- Determinism violations in the SSRF unit suite: 0
