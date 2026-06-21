---
agent: review-m3-ssrf-guard-wiring
review_target: M3-1 SSRF guard for @theokit/sdk-tools
plan: .claude/knowledge-base/plans/m3-ssrf-guard-plan.md
date: 2026-06-20
verdict: WIRING_PASS
---

# Wiring Review — M3-1 SSRF guard

## Verdict: WIRING_PASS — 0 BLOCKER / 0 HIGH / 0 MEDIUM / 1 INFO

The wiring triad is HONEST and DEEP. The raw `fetch` was REPLACED (not left
alongside) by `screenedFetch`; the four primitives are exported from the
sdk-tools barrel and not flagged orphan by knip; the guard is DEFAULT-ON
(`allowPrivateHosts ?? false`); the handler maps `SsrfBlockedError → ssrf_blocked`.
Build passes, knip clean, integration tests (33/33) exercise the symbols
through the tool. No leftover unguarded public fetch path in sdk-tools src.

## Triad re-validation (depth)

| Symbol | Pillar (a) caller | Pillar (b) integration test | Pillar (c) metric |
|---|---|---|---|
| `screenedFetch` | `createWebFetchTool` handler `web-fetch.ts:77` (real, on the only egress path) | `web-fetch.test.ts:51-75` (loopback/metadata/ipv6/opt-out via `tool.handler`) + `network-guard.test.ts:116-162` | N/A — pure/fails-closed (observable via `ssrf_blocked` error result) |
| `resolveAndScreen` | `screenedFetch` `network-guard.ts:188` | `network-guard.test.ts:70-103` (6 cases) | N/A |
| `isBlockedIp` | `resolveAndScreen` `network-guard.ts:130,137` | `network-guard.test.ts:16-62` (11 cases) | N/A |
| `SsrfBlockedError` | thrown by guard; caught at `web-fetch.ts:117` → `ssrf_blocked` | asserted in both test files | N/A |

- pillar_a_honest_pass: 4/4 — every symbol has a real, non-no-op caller reachable from `createWebFetchTool`.
- pillar_b_honest_pass: 4/4 — symbols are CALLED in the Act phase, not merely imported; `web-fetch.test.ts` drives them through `tool.handler(...)`, the production entry point.
- pillar_c_observed: N/A (4/4) — guard is pure + fails-closed; runtime metric correctly declared N/A per the review brief. The `ssrf_blocked` JSON result is the observable signal.

## Checks run

### Triad (a) — raw fetch REPLACED, not aliased
- `grep 'fetch(' packages/sdk-tools/src/web-fetch.ts` → zero raw `fetch(` calls. Only `screenedFetch` at line 77. Remaining matches are doc-comment prose (lines 2,4,9), the schema description (45), the biome-ignore comment (53), and the `fetch_failed` error string (126) — none is a call site.
- Sole network egress in the tool flows through `screenedFetch`.

### Triad (a) — exports present
- `src/index.ts:32-39` re-exports `isBlockedIp`, `ResolveAndScreenOptions`, `resolveAndScreen`, `ScreenedFetchOptions`, `SsrfBlockedError`, `screenedFetch`.
- Confirmed in built `dist/index.d.ts` (declares `SsrfBlockedError`, `isBlockedIp`, `resolveAndScreen`, plus `screenedFetch`).

### Default-on guard
- `web-fetch.ts:36` → `const allowPrivateHosts = opts?.allowPrivateHosts ?? false;` (default false = guard ON).
- `network-guard.ts:187` → `if (!options.allowPrivateHosts) { await resolveAndScreen(...) }` (default-undefined → screens).
- Opt-out is explicit and documented (`web-fetch.ts:26-31` JSDoc + `network-guard.ts:167`).

### Handler maps SsrfBlockedError → ssrf_blocked
- `web-fetch.ts:117-119`: `if (err instanceof SsrfBlockedError) return JSON.stringify({ ok:false, error:"ssrf_blocked", ... })`. Verified by integration tests at `web-fetch.test.ts:51-66`.

### Build + knip
- `pnpm --filter @theokit/sdk-tools build` → tsup ESM+CJS+DTS success; `dist/index.{js,cjs,d.ts,d.cts}` emitted.
- `pnpm quality:dead` (knip) → exit 0, no output → the 4 new exports are NOT flagged orphan.

### No leftover unguarded public fetch path
- `grep -rn 'fetch(' packages/sdk-tools/src/` (excluding guard + comments) → none.
- `web-search.ts` performs no `fetch` (uses an injected callback, no direct egress).

### Tests through the tool
- `vitest run tests/web-fetch.test.ts tests/network-guard.test.ts` → 33/33 pass (web-fetch 11 + network-guard 22). Pillar (b) symbols exercised in the Act phase.

## Findings

- id: F-wire-1
  severity: INFO
  file: packages/sdk-tools/tests/web-fetch.test.ts:85-99
  detail: The "happy path (live)" test hits httpbin.org and the SSRF-guard suite uses real loopback/metadata literals. These pass deterministically because screening happens BEFORE any socket (literal IPs blocked pre-DNS) and the live test tolerates network failure. Not a wiring defect — flagged only as an environmental coupling note.
  fix: None required. If offline-CI flakiness ever appears, gate the single live happy-path test behind an env flag; the guard tests themselves need no network.

## Notes on honesty (anti-gaming)
- No no-op callers, dead branches, or `if(false)` wrappers found in the caller chain.
- No hand-edited `.wiring-evidence.json` (none exists; pillar c is legitimately N/A, not fabricated).
- Default-ON verified at BOTH layers (tool factory + guard internal) — defense in depth; opt-out cannot be reached accidentally.
