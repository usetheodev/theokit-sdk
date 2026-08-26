---
"@theokit/sdk": patch
---

A provider that declares `authType: "none"` is no longer refused for lacking a credential it does
not use. `createLocalAgent` read the provider descriptor two lines below the `throw` that
guaranteed execution never reached it, so `ollama/llama3.2` — and every other keyless provider —
failed with `missing_api_key` before any runtime work began.

Fail-closed is preserved in both directions that matter: an unregistered provider prefix yields no
profile and is still refused, so a typo cannot become a free pass; and a provider that does
authenticate is refused exactly as before.
