---
'@theokit/sdk': patch
---

Fail-loud on in-stream provider errors. OpenRouter (and some OpenAI-compatible proxies) report auth / quota / rate-limit failures as an HTTP 200 SSE body carrying `data: {"error":{"message":"...","code":401}}` rather than a non-2xx status. The stream accumulator only reads `choices`, so such an error-only chunk produced zero events and the turn finished empty — the failure was silently swallowed (a dead API key looked like an empty model response). The OpenAI client now detects an in-stream `error` chunk and throws the same typed error a non-2xx HTTP status would (`AuthenticationError` / `RateLimitError` / `ConfigurationError` / …), so callers surface it instead of a blank turn. Fixes usetheodev/theocode#31.
