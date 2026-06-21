---
"@theokit/sdk-tools": minor
---

M3-1 — SSRF guard for `web_fetch` (secure by default; plan `m3-ssrf-guard`).

`createWebFetchTool()` now screens every request and every redirect hop against an SSRF block-list **by default**. A URL whose host resolves to a private/loopback/link-local/CGNAT/cloud-metadata/reserved address (IPv4 or IPv6, including IPv4-mapped `::ffff:` and DNS names resolving to such) returns `{ ok: false, error: "ssrf_blocked" }`. Redirects use `redirect:"manual"` with per-hop re-screening (a redirect to `127.0.0.1`/`169.254.169.254` is blocked, not followed); non-http(s) redirect targets are rejected. Resolves ALL A-records (multi-record evasion) and unwraps IPv4-mapped IPv6.

**Behavior change:** requests to localhost/private hosts are now blocked. Opt out for trusted local-dev tooling with `createWebFetchTool({ allowPrivateHosts: true })`.

Also exports the reusable screening primitives `resolveAndScreen`, `isBlockedIp`, `screenedFetch`, and `SsrfBlockedError`. Node `dns`/`net` builtins only — zero new dependencies.
