---
"@theokit/sdk-tools": minor
---

M3-7 — Brave web-search provider adapter (plan `m3-websearch-adapter`).

`createWebSearchTool` is provider-agnostic; `@theokit/sdk-tools` now ships one concrete env-driven adapter:

- `createBraveWebSearchAdapter({ apiKey?, fetchImpl?, endpoint? })` — a `WebSearchCallback` backed by the Brave Search API. The key defaults to `process.env.BRAVE_API_KEY` (throws a typed `ConfigurationError` code `no_api_key` at creation if absent — fail-early). `fetchImpl` is injectable (default `globalThis.fetch`) for offline testing. Maps Brave's `web.results[]` to `{ title, url, snippet }` (empty-safe); a non-ok HTTP response throws, which `createWebSearchTool` surfaces as `{ ok:false, error:"search_failed" }`.

Plug it in with `createWebSearchTool({ search: createBraveWebSearchAdapter() })` — the tool stays provider-agnostic (additional providers like Tavily are a follow-up). Uses a plain `fetch` (the endpoint host is fixed; no SSRF surface). Zero new dependencies.
