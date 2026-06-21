# Review: m3-ssrf-guard

**Date:** 2026-06-20
**Reviewers (spawned agents):** 5 — architecture, tests, wiring, cross-validation, domain-security (general-purpose, opus-class)
**Findings (initial):** 0 BLOCKER, 0 HIGH, ~7 MEDIUM (2 distinct production root causes + test-coverage gaps + 1 process note), several LOW, INFO
**Findings (after fix `83438a6`):** 0 BLOCKER, 0 HIGH, 0 MEDIUM (production defects fixed; gaps closed), advisory LOW/INFO only
**Verdict:** READY_TO_MERGE

> Per-agent finding files: `.claude/agents/review-m3-ssrf-guard-2026-06-20/findings/*.md`.

## Scope reviewed

Commits `06e7b1c` (Phase 1) + `f7f67d0` (T2.1) + review-fix `83438a6`, on `develop` vs `main`. Files: `packages/sdk-tools/src/internal/network-guard.ts`, `web-fetch.ts`, `index.ts`, `tests/network-guard.test.ts`, `tests/web-fetch.test.ts`, `docs.md`, CHANGELOG, changeset.

## BLOCKER / HIGH findings

_None._ (The domain-security agent ran an adversarial bypass sweep — every headline vector, incl. metadata `169.254.169.254`, alternate IP encodings, redirect-to-private, `file://` redirect, `0.0.0.0`, and fail-closed paths, is blocked through the `web_fetch`/`screenedFetch` path.)

## MEDIUM findings (production defects — RESOLVED in `83438a6`)

### [MEDIUM → FIXED] IPv6 classification used string `startsWith` (over-block) + only compressed IPv4-mapped (under-block)
- Flagged by: architecture (2 MEDIUM), domain-security (F-dom-1 MEDIUM)
- file: `packages/sdk-tools/src/internal/network-guard.ts` (original `isBlockedV6`/`ipv4Mapped`)
- detail: `startsWith("fc")/("fe8")…` on the RAW string false-positived on compressed short forms (`fc::1` = `00fc::1`, `fe8::1` = `0fe8::1` — not actually in `fc00::/7` / `fe80::/10`); and `ipv4Mapped` only matched the compressed `::ffff:` regex, so the EXPANDED `0:0:0:0:0:ffff:127.0.0.1` returned `false` from the exported `isBlockedIp` primitive (a false-negative reachable by a second consumer or the DNS-resolved path).
- **fix (`83438a6`):** rewrote the IPv6 path to parse the address to its 16 bytes (`ipv6ToBytes` handling `::` compression + dotted-tail, split into `foldDottedTail`/`expandHextets` for complexity) and classify NUMERICALLY (`isBlockedV6Bytes`): exact `fe80::/10` (`b[0]==0xfe && (b[1]&0xc0)==0x80`), `fc00::/7` (`(b[0]&0xfe)==0xfc`), `::1`/`::`, and IPv4-mapped/compatible unwrap → re-check IPv4. +2 regression tests (`expanded_ipv4_mapped_blocked`, `compressed_v6_shortforms_not_overblocked`).

### [MEDIUM → FIXED] Test-coverage gaps (production handled them; gaps were regression risk)
- Flagged by: tests (3 MEDIUM)
- detail: 307/308 redirects, public-IPv6 through `resolveAndScreen`, and the `addrs.length===0` fail-closed branch had no tests (production handled all three correctly).
- **fix (`83438a6`):** +3 tests — `test_screenedFetch_308_redirect_to_private_rescreened`, `test_resolveAndScreen_allows_public_ipv6`, `test_resolveAndScreen_no_addresses_fails_closed`.

### [MEDIUM — accepted, no change] Undeclared but necessary bracket-strip edit
- Flagged by: cross-validation (F-xval-1)
- detail: T2.1 added a 5-line IPv6-bracket-strip in `resolveAndScreen` (required for `http://[::1]/` where `URL.hostname` = `[::1]`). Correct, tested, biome-clean — a necessary in-task fix, not scope creep. No action.

## LOW / INFO findings (advisory)

- domain-security F-dom-2 (LOW): 6to4 `2002::/16`, NAT64 `64:ff9b::/96` embedding private IPv4 not unwrapped — explicitly out of the plan's v1 IPv6 scope; the new numeric parser makes adding them trivial later. (The deprecated IPv4-compatible `::a.b.c.d` form IS now unwrapped as a bonus of the fix.)
- TOCTOU/DNS-rebinding IP-pinning honestly deferred (ADR D4) — confirmed by domain-security as documented, not silently ignored.
- INFO confirmations: DIP injection clean (architecture/wiring); secure-by-default at both layers (`allowPrivateHosts ?? false`, `if (!allowPrivateHosts)`); raw `fetch` REPLACED not aliased (wiring — sole network egress is `screenedFetch`); 6/6 ADRs honored + Coverage Matrix 8/8 + zero new deps (cross-validation); tests deterministic + mutation-verified non-vacuous (tests).
- INFO note (cross-validation): ADR D5 prose said "DNS canonicalizes" alternate encodings — actually `URL.hostname` + the resolve path does; same outcome (blocked), mechanism wording imprecise. Non-defect.

## Quality gate re-validation

- Full sdk-tools suite: 20 files / **169 passed, 0 failed** (network-guard 27 + web-fetch 11 + 131 other; +27 from M3-1 incl. 5 review regression tests).
- typecheck exit 0; Biome clean (complexity ≤ 10 after `ipv6ToBytes` + `screenedFetch` refactors); knip clean; dep-cruiser clean; build emits dist; code-quality PASS.

## Edge-case coverage

Plan EC-1 (non-http redirect), EC-2 (dual-stack), EC-3 (decimal-encoding) covered, plus the 5 review-added cases (expanded-mapped, short-form-not-overblocked, no-addresses fail-closed, public-IPv6, 308 re-screen). Adversarial bypass sweep passed for the v1 scope.

## Verdict rationale

0 BLOCKER, 0 HIGH. The 2 distinct production MEDIUM root causes (IPv6 string-classification + test gaps) are FIXED in `83438a6` with regression tests — not deferred (goal: no re-work, all DoDs validated). The remaining items are out-of-v1-scope LOW (additional IPv6 embedding forms) + INFO confirmations. Per `cycle-review.md § Verdicts`: **READY_TO_MERGE.**

## Recommended next step

`/release` (a `@theokit/sdk-tools` minor — the SSRF guard is a security hardening with a documented behavior change + opt-out). Then continue M3 with M3-2 (catastrophic shell screen).
