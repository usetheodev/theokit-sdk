# Implementation: M3-1 — SSRF guard for web_fetch

**Slug:** `m3-ssrf-guard` · **Plan:** SHIPPABLE 98.8 · **Blueprint:** SHIPPABLE 100 · **Promise:** IMPLEMENTATION_COMPLETE

| # | Plan ref | Status | Commit |
|---|---|---|---|
| T1.1 | block-list + SsrfBlockedError | committed | `06e7b1c` |
| T1.2 | resolveAndScreen + screenedFetch | committed | `06e7b1c` |
| T2.1 | wire into web_fetch + export + docs | committed | `f7f67d0` |

## What shipped
`packages/sdk-tools/src/internal/network-guard.ts` — `isBlockedIp` (canonical IPv4+IPv6 ranges + IPv4-mapped unwrap), `resolveAndScreen` (resolve-all + throw on any blocked, strips IPv6 brackets), `screenedFetch` (`redirect:"manual"` + per-hop re-screen, rejects non-http redirect), `SsrfBlockedError`. Wired secure-by-default into `createWebFetchTool` (`allowPrivateHosts` opt-out). Exported from the sdk-tools barrel. Node builtins only (D1-D6).

## Validation gate: PASS
- network-guard 27/27 + web-fetch 11/11 = 38; full sdk-tools suite 169 passed (incl. 5 review regression tests) / 0 failed.
- typecheck exit 0; Biome clean; knip clean; dep-cruiser clean; build emits dist (index.d.ts/.d.cts).
- code-quality PASS.

## Wiring triad
(a) `createWebFetchTool` calls `screenedFetch` (production caller) + barrel exports; (b) integration tests block loopback/metadata/ipv6 + opt-out; (c) metric N/A — observable via the `ssrf_blocked` error result (fails closed).
