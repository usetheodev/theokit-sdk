# Blueprint: M3-1 — SSRF guard for `web_fetch`

> **Version 1.0** — Synthesizes the reference web-fetch baselines (opencode `webfetch.ts` — explicitly accepts localhost; codex bare urllib — both counter-examples with zero IP screening) and the SDK's OWN security-primitive PATTERN (`path-guard` typed errors + `path-safety` public barrel) against the canonical SSRF defense, to lock a `resolveAndScreen(host)` network guard + a secure-by-default `createWebFetchTool` with `redirect:"manual"` per-hop re-screening. The references establish the GAP (the motivation) + the PATTERN (path-guard); the technique is the well-known SSRF block-list. Decisions: guard signature, blocked ranges, secure-by-default vs separate factory, redirect handling, TOCTOU mitigation, IP-encoding normalization, placement.

**Slug:** `m3-ssrf-guard`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m3-ssrf-guard-plan.md`
**Owner:** paulo
**Generated:** 2026-06-20 via discover-execute procedure
**Confidence verdict:** SHIPPABLE (100, discover-confidence 2026-06-20)

## Context

Roadmap gap M3-1 (high sev, Tema C). `packages/sdk-tools/src/web-fetch.ts:26-118` (`createWebFetchTool`) validates protocol (`:54`) but does NO host/IP screening and follows redirects (native fetch default) — a textbook SSRF hole reaching `127.0.0.1`, `169.254.169.254` (cloud metadata), and internal `10.*`/`192.168.*`. References confirm this is industry-wide: opencode `webfetch.ts:85` is protocol-only and its test (`tool-webfetch.test.ts:121-141`) ASSERTS localhost is accepted; codex uses bare urllib. The SDK's path-guard (`packages/sdk/src/internal/security/path-guard.ts:33-64,267-281` + public `path-safety.ts:16-32`) is the security-primitive pattern to mirror (typed `ConfigurationError` subclasses + deny-list + public barrel). Node builtins (`node:dns`, `node:net`) suffice — zero new deps.

## Objective

Lock the `resolveAndScreen` signature, blocked ranges, secure-by-default integration, redirect handling, TOCTOU mitigation, and placement — each backed by the path-guard pattern + the canonical defense + the reference gaps.

---

## Coverage Corner 1 — Integration Tests

### opencode (counter-example baseline)
`.claude/knowledge-base/reference/opencode/packages/core/test/tool-webfetch.test.ts:121-141` ASSERTS `http://localhost/private` succeeds (`expect(...).toEqual({type:"text",value:"hello"})`) — localhost is ACCEPTED. `:144-176` follows redirects (permission gate records only the original URL `:169`, NOT the redirect target — so a redirect to a private host is fetched unscreened). `:221-253` rejects oversized bodies (both content-length header + streamed).

### SDK path-guard (pattern baseline)
`packages/sdk/src/internal/security/path-guard.ts` — the deny-list `isForbiddenPath` (`:267-281`) + typed errors (`:33-64`) are tested by the path-guard suite; the network guard mirrors this test shape (assert each blocked range throws/returns-blocked; assert allowed hosts pass).

**SDK TDD seed (the SDK must REJECT what opencode accepts):** `resolveAndScreen`/`createWebFetchTool` must BLOCK `127.0.0.1`, `localhost`, `10.x`, `192.168.x`, `172.16-31.x`, `169.254.169.254` (metadata), `::1`, `::ffff:127.0.0.1` (IPv4-mapped), and a redirect to any of these; ALLOW an ordinary public host; honor `allowPrivateHosts:true` opt-out.

---

## Coverage Corner 2 — Dependencies

| Project | Fetch + screening deps | Citation |
|---|---|---|
| opencode webfetch | `effect/unstable/http` HttpClient + htmlparser2 + turndown; **no IP/SSRF lib** | `.claude/knowledge-base/reference/opencode/packages/core/src/tool/webfetch.ts:1-9,85` |
| sdk-tools web-fetch | `@theokit/sdk` (CustomTool/defineTool) + `zod`; native `fetch`; **no IP/SSRF lib** | `packages/sdk-tools/src/web-fetch.ts:1-16`, `packages/sdk-tools/package.json:45-66` |

**Conclusion:** no reference uses a screening library; the SDK guard uses ONLY Node builtins `node:dns` (`dns.promises.lookup(host,{all:true})`) + `node:net` (`net.isIP`/`isIPv4`/`isIPv6`). **Zero new dependencies** (Rule 9 / KISS).

---

## Coverage Corner 3 — Tools

### Module/export shapes
- opencode webfetch: an Effect-style tool module (`.claude/knowledge-base/reference/opencode/packages/core/src/tool/webfetch.ts:1-100`) — protocol-checks then fetches.
- sdk-tools web-fetch: `createWebFetchTool(opts?: CreateWebFetchToolOptions): CustomTool` (`packages/sdk-tools/src/web-fetch.ts:26`), `CreateWebFetchToolOptions { defaultTimeoutMs? }` (`:21-24`); handler returns a JSON string `{ok:true,...}` / `{ok:false,error,...}` (error-RETURN style, does NOT throw to the model).
- SDK path-safety barrel: `packages/sdk/src/path-safety.ts:16-32` re-exports typed errors + guard fns from `internal/security/path-guard.js`.

**SDK placement decision (Q4 + ADR D6):** the network guard is tool-specific → lives in `packages/sdk-tools/src/internal/network-guard.ts` (`resolveAndScreen` + `SsrfBlockedError`), exported from the sdk-tools barrel (`packages/sdk-tools/src/index.ts`). `SsrfBlockedError extends ConfigurationError` (from `@theokit/sdk`, already a sdk-tools peer dep). The web-fetch handler catches `SsrfBlockedError` and returns `{ok:false, error:"ssrf_blocked", reason}` — consistent with the tool's existing error-return contract.

---

## Coverage Corner 4 — Techniques

### Technique 1 — The canonical SSRF block-list (the references have NONE)

| Family | Blocked ranges |
|---|---|
| IPv4 loopback | `127.0.0.0/8` |
| IPv4 private (RFC1918) | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` |
| IPv4 link-local (incl. metadata `169.254.169.254`) | `169.254.0.0/16` |
| IPv4 CGNAT (RFC6598) | `100.64.0.0/10` |
| IPv4 "this host" / reserved / multicast | `0.0.0.0/8`, `240.0.0.0/4`, `224.0.0.0/4` |
| IPv6 loopback / link-local / ULA | `::1`, `fe80::/10`, `fc00::/7` |
| IPv4-mapped IPv6 | `::ffff:0:0/96` → UNWRAP to IPv4 + re-check |

Node APIs: `net.isIP(s)` (0/4/6), CIDR via bitwise on the parsed address. Source: opencode/codex confirm the gap (`webfetch.ts:85` protocol-only); the ranges are IETF-standard SSRF defense.

### Technique 2 — Resolve-all-A-records + TOCTOU

`dns.promises.lookup(host, { all: true })` returns EVERY resolved address; screen ALL (block if ANY is blocked) — not just the first. **TOCTOU/DNS-rebinding (EC-1):** the v1 mitigation screens all A-records AND re-screens every redirect hop; full IP-pinning (connect to the screened IP via an undici `dispatcher` with a custom `connect.lookup`) is a documented hardening follow-up (the residual rebinding window between screen and fetch is narrow and explicitly accepted for v1 — ADR D4).

### Technique 3 — Redirect:"manual" per-hop re-screen

Native `fetch` follows redirects to unscreened targets (opencode `:144-176` proves it). The guard sets `redirect:"manual"` and follows up to N hops (default 5) MANUALLY, calling `resolveAndScreen` on each `Location` host before following. A redirect to a blocked host → `{ok:false,error:"ssrf_blocked"}`.

### Technique 4 — IP-encoding normalization (EC-2)

Screen the PARSED address, not the raw host string. `new URL(url).hostname` normalizes most forms; `net.isIP` validates dotted-quad/IPv6; for a literal IP host, parse to canonical bytes before range-check; unwrap `::ffff:a.b.c.d`. Hosts that are non-IP names go through `dns.promises.lookup` (which yields canonical IPs). Reject ambiguous/alternate encodings that don't parse via `net.isIP` + URL.

---

## Cross-cutting Comparison

| Dimension | opencode | codex | SDK path-guard (pattern) | SDK decision |
|---|---|---|---|---|
| Host/IP screening | none (accepts localhost) | none (urllib) | deny-list (paths) | deny-list of IP ranges via `resolveAndScreen` |
| Redirects | followed unscreened | followed | n/a | `redirect:"manual"` + re-screen per hop |
| Typed error | ToolFailure | none | `ConfigurationError` subclass + `code` | `SsrfBlockedError extends ConfigurationError`, `code:"ssrf_blocked"` |
| Default posture | open | open | deny-by-default | **secure-by-default** (guard on; opt-out `allowPrivateHosts`) |
| Deps | htmlparser2/turndown | urllib | none | node:dns + node:net only (0 new) |

## ADRs

### D1 — `resolveAndScreen(host)` resolves all A-records + throws on any blocked
**Decision:** `resolveAndScreen(host: string): Promise<string[]>` — resolves ALL addresses (`dns.promises.lookup(host,{all:true})`; if `host` is already an IP literal, screens it directly), checks each against the canonical block-list, throws `SsrfBlockedError` if ANY is blocked, else returns the resolved IPs.
**Rationale:** mirrors path-guard's single-purpose guard primitive; resolve-all defeats multi-record evasion. Reusable by any future network tool.
**Alternatives considered:** screen only the first A-record (rejected — multi-record bypass); return boolean (rejected — typed error carries the reason, matches path-guard).

### D2 — Secure-by-default in `createWebFetchTool` (not a separate opt-in factory)
**Decision:** bake the guard into `createWebFetchTool` DEFAULT-ON; add `allowPrivateHosts?: boolean` (default `false`) to `CreateWebFetchToolOptions` for explicit local-dev opt-out. (Satisfies the roadmap's "default-on `createGuardedWebFetchTool`" intent — the tool IS guarded by default; no separate unguarded public factory to misuse.)
**Rationale:** secure-by-default beats an opt-in `createGuardedWebFetchTool` that consumers forget to use (the no-stubs/secure philosophy). The opt-out preserves the escape hatch.
**Alternatives considered:** a separate `createGuardedWebFetchTool` leaving `createWebFetchTool` open (rejected — leaves a footgun public unguarded tool); guard always-on no opt-out (rejected — breaks legitimate localhost dev tools).
**Consequences:** behavior change — localhost/private fetches now blocked by default (the security fix; documented in CHANGELOG as the intended hardening; opt-out available).

### D3 — `redirect:"manual"` + bounded per-hop re-screen
**Decision:** set `redirect:"manual"`; follow up to `maxRedirects` (default 5) manually, calling `resolveAndScreen` on each hop's `Location` host before following.
**Rationale:** native redirect-following reaches unscreened internal targets (opencode `:144-176`). Per-hop re-screen closes it.
**Alternatives considered:** `redirect:"error"` (rejected — breaks legitimate redirects); follow without re-screen (rejected — the hole).

### D4 — TOCTOU v1 mitigation = screen-all + re-screen-hops; IP-pinning deferred
**Decision:** v1 screens all A-records + re-screens redirect hops. Full IP-pinning (undici dispatcher `connect.lookup` to the screened IP) is a documented hardening follow-up; the narrow screen→fetch rebinding window is explicitly accepted for v1.
**Rationale:** screen-all + redirect re-screen blocks the common SSRF vectors; IP-pinning adds undici-dispatcher complexity disproportionate to the residual narrow window for a first iteration (KISS/YAGNI), recorded honestly (EC-1).
**Alternatives considered:** full IP-pin now (rejected — complex, deferrable); ignore TOCTOU (rejected — must state the decision).

### D5 — Normalize before range-check; reject alternate encodings
**Decision:** range-check the PARSED address (`net.isIP` + URL-normalized hostname + DNS-resolved canonical IPs); unwrap IPv4-mapped IPv6; reject hosts that don't parse cleanly.
**Rationale:** decimal/octal/hex/short IP encodings bypass naive string checks (EC-2).
**Alternatives considered:** raw-string prefix match (rejected — trivially bypassed).

### D6 — Placement: `sdk-tools/internal/network-guard.ts`, exported from the sdk-tools barrel
**Decision:** `resolveAndScreen` + `SsrfBlockedError` in `packages/sdk-tools/src/internal/network-guard.ts`, exported from `packages/sdk-tools/src/index.ts`. `SsrfBlockedError extends ConfigurationError` (from `@theokit/sdk`). Web-fetch handler catches it → `{ok:false,error:"ssrf_blocked"}`.
**Rationale:** the guard is tool-specific (web-fetch lives in sdk-tools); reuses the existing sdk-tools→sdk peer dep; matches the tool's error-return contract.
**Alternatives considered:** put it in sdk core `network-safety.ts` (rejected — adds an sdk public surface for a tool-layer concern; sdk-tools is the right home; can promote later if a 2nd consumer appears — YAGNI).

## Recommendations for the project

- **Q1/tests:** ship RED tests asserting the SDK BLOCKS what opencode accepts (localhost/127.0.0.1/private/metadata/::1/IPv4-mapped + a redirect-to-private), ALLOWS a public host, and honors `allowPrivateHosts:true`.
- **Q2/pattern:** `SsrfBlockedError extends ConfigurationError` (`code:"ssrf_blocked"`), mirroring path-guard.
- **Q3/deps:** Node builtins only — zero new deps.
- **Q4/tools:** guard in `sdk-tools/internal/network-guard.ts`, exported from the barrel; secure-by-default in `createWebFetchTool`.
- **Q5/technique:** implement the full IPv4+IPv6 block-list, resolve-all-A-records, `redirect:"manual"` per-hop re-screen, IPv4-mapped unwrap; document TOCTOU IP-pinning as a follow-up.

## Blocked questions (if any)

(none — all 5 research questions answered with verified citations + the canonical-defense standard.)
