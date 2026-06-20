# Architecture Review — M3-1 SSRF guard

review_target: main..HEAD for plan m3-ssrf-guard
plan: .claude/knowledge-base/plans/m3-ssrf-guard-plan.md
rule: .claude/rules/architecture.md

## [MEDIUM] IPv6 `isBlockedV6` startsWith logic is structurally wrong — false-positives on short-form prefixes

- file: packages/sdk-tools/src/internal/network-guard.ts:79-91
- detail: `isBlockedV6` matches `fe80::/10` via `startsWith("fe8"|"fe9"|"fea"|"feb")` and `fc00::/7` via `startsWith("fc"|"fd")` on the RAW lowercased input string, never canonicalizing the address first. This over-blocks compressed short forms whose FIRST hextet is NOT actually in the target range:
  - `fe8::1` expands to `0fe8:0000:...:1` (first hextet `0fe8`) — NOT link-local — but `"fe8::1".startsWith("fe8")` is true → wrongly BLOCKED. Same for `fe9::1`, `fea::1`, `feb::1`.
  - `fc::1` expands to `00fc:0000:...:1` (first hextet `00fc`) — NOT ULA — but `startsWith("fc")` is true → wrongly BLOCKED. Same for `fd::1`.
  Verified by IPv6 expansion: `fe8::1 => 0fe8:0000:0000:0000:0000:0000:0000:0001`, `fc::1 => 00fc:0000:...:0001`. `net.isIP` confirms all are valid IPv6 (it validates, it does NOT normalize), so these strings reach the broken comparison verbatim.
  Real-world severity today is MEDIUM not HIGH: the over-blocked addresses (`0fe8::/16`, `00fc::/8`, etc.) sit OUTSIDE the `2000::/3` global-unicast block, so they are currently reserved/unassigned and not reachable public hosts. But the logic is plainly incorrect, it WILL mis-block if IANA assigns those blocks, and string-prefix range checks are exactly the anti-pattern the plan's own ADR D5 says to avoid ("raw-string prefix match rejected — trivially bypassed"). The IPv4 path correctly uses parsed bitwise CIDR (`inV4Cidr`); the IPv6 path does not, an internal inconsistency.
- fix: Classify IPv6 by parsing to its 128-bit form (or at minimum normalize the first hextet to 4 digits via `padStart(4,"0")` on the leading group after `::` expansion) and compare the high bits numerically: `fe80::/10` = first 10 bits == `0xFE80 >> 6`; `fc00::/7` = first 7 bits == `0xFC`. Equivalently, expand the first hextet and test `0xfe80 <= h0 <= 0xfebf` and `0xfc00 <= h0 <= 0xfdff`. Do not branch on `startsWith` of an un-normalized string.

## [MEDIUM] IPv6 block-list is incomplete — missing IPv4-embedded transition forms and other reserved ranges

- file: packages/sdk-tools/src/internal/network-guard.ts:65-77, 79-91
- detail: `ipv4Mapped` only unwraps the `::ffff:a.b.c.d` / `::ffff:hi:lo` form. Other IPv6 forms that embed or tunnel an IPv4 destination are NOT screened, leaving SSRF vectors the IPv4 block-list would otherwise catch:
  - IPv4-compatible `::a.b.c.d` (deprecated but still routed by some stacks) e.g. `::7f00:1` / `::127.0.0.1` is not unwrapped → loopback escapes.
  - 6to4 `2002:7f00:0001::/48` embeds `127.0.0.1`; NAT64 `64:ff9b::7f00:1` embeds an IPv4 — neither is screened.
  - `fec0::/10` deprecated site-local is not blocked (low priority — deprecated).
  Given the plan's threat model explicitly targets cloud-metadata and loopback, the `::ffff:`-only unwrap is narrower than the IPv4 coverage it is meant to mirror. The unspecified address `::` IS handled (line 81) — good.
- fix: At minimum unwrap IPv4-compatible `::a.b.c.d` and `::<hi>:<lo>` (low 32 bits when the upper 96 are zero) the same way `::ffff:` is unwrapped, and re-check via `isBlockedV4`. Decide explicitly (and record) whether 6to4/NAT64 embedded-IPv4 screening is in scope for v1; if deferred, add it to ADR D4's TOCTOU/follow-up list rather than leaving it silently uncovered.

## [LOW] Tests assert only the happy `fe80`/`fc00` canonical forms — the broken short-forms are untested

- file: packages/sdk-tools/tests/network-guard.test.ts:42-49
- detail: `test_isBlockedIp_v6_loopback_linklocal_ula` only exercises `::1`, `fe80::1`, `fc00::1` (all canonical 4-digit first hextet), and `test_isBlockedIp_v6_public_allowed` only checks `2606:4700:4700::1111`. None of the short-form cases (`fe8::1`, `fc::1`) or boundary cases (`febf::1` in-range, `fec0::1` out-of-range) are covered, which is precisely why the MEDIUM logic defect above passes CI green. The plan's own DoD claims "exhaustive unit tests per range" (Drawbacks row 3) — the IPv6 ranges are not exhaustively tested at their boundaries the way IPv4 is (`test_isBlockedIp_172_15_and_172_32_allowed`).
- fix: Add boundary tests mirroring the IPv4 boundary test: `febf::1` → true (last of fe80::/10), `fec0::1` → false (first past it), `fdff::1` → true (last of fc00::/7), `fe00::1`/`fbff::1` → false, plus the short-form public addresses `fe8::1`/`fc::1` asserting the CORRECT expected result after the fix.

## [INFO] DIP / injection boundary is clean and correct

- file: packages/sdk-tools/src/internal/network-guard.ts:109-115, 122-140, 159-196
- detail: The injection design satisfies §2 DIP cleanly. `resolveAndScreen` takes an optional `lookup` defaulting to `node:dns/promises` lookup; `screenedFetch` takes optional `fetchImpl` (default global `fetch`) and `lookup`. Both production defaults are correct (`dnsLookup` cast to the narrowed `LookupFn` with `{all:true}`; `fetch` cast to `FetchFn`). Tests drive the boundaries deterministically via `fakeLookup`/`fakeFetchSeq` with zero real I/O. The module depends only on Node builtins (`node:dns/promises`, `node:net`) + the public `ConfigurationError` from `@theokit/sdk` — no ascending or cross-adapter import, no circular dependency. The two casts (`as unknown as LookupFn`, `fetch as FetchFn`) are a minor type-erosion smell but justified by the builtin signatures and confined to the default-resolution lines.

## [INFO] Module cohesion + SRP are sound; pure core cleanly separated from I/O

- file: packages/sdk-tools/src/internal/network-guard.ts
- detail: SRP holds at function granularity: pure classifiers (`v4ToInt`, `inV4Cidr`, `isBlockedV4`, `ipv4Mapped`, `isBlockedV6`, `isBlockedIp`) carry zero I/O and are exhaustively unit-testable; I/O lives in `resolveAndScreen`/`screenedFetch`; redirect parsing is factored into `redirectTarget`. One file, one responsibility (SSRF screening), 196 LoC (well under the plan's 500 budget). Placement in `sdk-tools/internal/` per ADR D6 is consistent with §3 (domain security primitive co-located with its sole consumer `web-fetch`). `SsrfBlockedError extends ConfigurationError` correctly reuses the existing error hierarchy (LSP-safe — adds no narrower precondition). The IPv4 block-list (lines 48-58) is complete and the CIDR math is correct — boundary verified (`172.16/12` excludes `172.15`/`172.32`, `100.64/10` CGNAT, `0/8`, `224/4`, `240/4` all present).

## [INFO] Secure-by-default wiring + fail-closed semantics are correct

- file: packages/sdk-tools/src/web-fetch.ts:34-133
- detail: `createWebFetchTool` defaults `allowPrivateHosts` to `false` (line 36, ADR D2), routes through `screenedFetch`, and maps `SsrfBlockedError` to `{ok:false,error:"ssrf_blocked"}` (line 117-119) without throwing to the model — matches the tool's error-return contract. `isBlockedIp` returns `true` for non-IP literals (fail-closed) and `resolveAndScreen` throws on zero addresses — both correct fail-closed choices per the plan's "Failure scenarios". Naming hygiene per §architecture: file kebab-case (`network-guard.ts`), class PascalCase (`SsrfBlockedError`), functions camelCase, constants UPPER_SNAKE (`V4_BLOCKED`, `REDIRECT_STATUSES`, `MAX_BODY_BYTES`); no `any`, no `console.log`, ESM-only. Barrel exports in `index.ts:32-39` are additive and correct (no orphan — wired into web-fetch + tested).

## [INFO] Scope-completeness note (outside core architecture, flagged for the consolidator)

- file: (diff scope)
- detail: The diff (`git diff main..HEAD --stat`) touches only the 5 source/test files. The plan's T2.1 + Global DoD also require `docs.md` (SSRF note), root `packages/sdk/CHANGELOG.md`, and `.changeset/m3-ssrf-guard.md`. A changeset entry `.changeset/m3-ssrf-guard.md` appears in the broader repo diff stat, but `docs.md` and CHANGELOG updates are not in the focused file set — verify these landed (Unbreakable Rule 6 / CLAUDE.md public-API checklist). Also `web-fetch.test.ts` includes a live `httpbin.org` happy-path test (flakiness/network-dependency risk) — defer to test-auditor.
