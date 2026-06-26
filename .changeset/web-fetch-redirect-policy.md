---
"@theokit/sdk-tools": minor
---

`createWebFetchTool` gains a redirect policy + injection seam.

- **`maxRedirects?: number`** — caps redirect hops (each SSRF-screened). Default 5 (unchanged). Set `0` to BLOCK ALL redirects (strict no-redirect policy for untrusted, model-chosen URLs).
- **Distinct `redirect_blocked` error** — a refused redirect now returns `{ ok:false, error:'redirect_blocked' }`, split from `ssrf_blocked` (a blocked private/reserved host). New exported `RedirectBlockedError`; `screenedFetch` throws it on redirect-limit exhaustion (was `SsrfBlockedError("too many redirects")` — a minor, more-precise error refinement).
- **Injectable `fetchImpl?` / `lookup?`** — drive the tool's redirect + SSRF paths deterministically in tests with no real network/DNS (the seam `screenedFetch` already had, now on the tool surface).

Additive + backward-compatible: absent options ⇒ today's behavior; `ssrf_blocked`/`invalid_url`/`timeout`/`too_large` codes + return shape unchanged. Lets a consumer (theocode) replace an app-side SSRF/redirect wrapper with `createWebFetchTool({ maxRedirects: 0 })`.
