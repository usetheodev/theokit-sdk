# Edge Case Review — m3-ssrf-guard (PLAN cycle)

Date: 2026-06-20
Plan analyzed: knowledge-base/plans/m3-ssrf-guard-plan.md
Tasks analyzed: 3 (T1.1 block-list, T1.2 resolve+screenedFetch, T2.1 wiring)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 3, DOCUMENT: 1)

> Supersedes the discover-cycle edge-case review (EC-1 TOCTOU + EC-2 encoding — both absorbed into blueprint ADRs D4/D5 + the plan). This is the plan-scoped review for `/plan-confidence`.

## Boundary map

The guard's boundary is network I/O: DNS resolution (`resolveAndScreen`) + HTTP fetch with redirects (`screenedFetch`). Live edge families: IP-range/encoding correctness, dual-stack resolution, and redirect-target shape. Both primitives take injectable `lookup`/`fetchImpl` → edges are deterministically testable.

## MUST FIX

(none — the design fails closed: `isBlockedIp` returns `true` for non-IP literals, `resolveAndScreen` throws on any blocked record + on empty results, `screenedFetch` re-screens each hop. The discovery EC-1/EC-2 are absorbed into ADRs D4/D5.)

## SHOULD TEST

### EC-1: redirect `Location` to a non-http(s) scheme
- **Affected task:** T1.2
- **Family:** Format
- **Scenario:** a 3xx response whose `Location` is `file://…`, `gopher://…`, or `data:…`. `screenedFetch` resolves `new URL(Location, current)` and re-screens the HOST, but a non-http scheme has no meaningful host to screen and must not be followed.
- **Suggested test:** `test_screenedFetch_blocks_non_http_redirect` — fakeFetch returns 302 `Location: file:///etc/passwd` → `screenedFetch` throws `SsrfBlockedError` (reject non-http(s) redirect target). Add a protocol check on each hop's target in `screenedFetch`.

### EC-2: dual-stack host — IPv4 public but IPv6 private (or vice-versa)
- **Affected task:** T1.2
- **Family:** Boundary
- **Scenario:** `lookup(host,{all:true})` returns `[{8.8.8.8},{::1}]` — one public, one blocked. The resolve-ALL contract must block if ANY family is blocked.
- **Suggested test:** `test_resolveAndScreen_blocks_dual_stack_when_any_family_blocked` — injected lookup → `[{address:"8.8.8.8"},{address:"::1"}]` → throws (covers the v6-record-blocked path explicitly).

### EC-3: alternate-encoding IP that resolves to a private address
- **Affected task:** T1.2
- **Family:** Format
- **Scenario:** `http://2130706433/` (decimal 127.0.0.1) — `new URL(...).hostname` = "2130706433", `net.isIP` = 0 → treated as a NAME → `lookup("2130706433")` canonicalizes to `127.0.0.1` → `isBlockedIp` blocks. The resolve-then-screen path defends it; pin the behavior.
- **Suggested test:** `test_resolveAndScreen_blocks_decimal_encoded_localhost` — injected lookup for "2130706433" → `[{address:"127.0.0.1"}]` → throws. Confirms the resolve path catches alternate encodings (D5).

## DOCUMENT

### EC-4: 3xx response with no `Location` header
- **Accepted risk:** `screenedFetch` only follows when `res.headers.Location` is truthy; a 3xx without `Location` is returned as-is (the web-fetch handler treats it like any response). No loop, no crash. Documented; no action.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 3 | 0 | EC-1, EC-2, EC-3 | EC-4 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK

3 SHOULD TEST (non-http redirect, dual-stack, decimal-encoding) — fold into T1.2 TDD (plan bump v1.0 → v1.1); EC-1 also adds a redirect-target protocol check to `screenedFetch`. No MUST FIX.
