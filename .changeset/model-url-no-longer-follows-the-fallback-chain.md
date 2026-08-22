---
"@theokit/sdk": patch
---

`ModelSelection.url` names the endpoint a specific model lives at, and it was handed to every
provider in a fallback chain. A fallback therefore inherited the primary's host and could never
reach its own — so a configured failover silently retried the same dead endpoint instead of moving
on.

Measured against two servers with the primary refusing every request: with `model.url` set, the
primary received 6 requests and the fallback 0. Pointing each provider with its own
`*_API_BASE_URL` instead gave 3 and 1.

The per-call URL now reaches only the provider the model id names. Each fallback resolves its own
endpoint from its profile and its own `*_API_BASE_URL`, which is what makes a fallback a different
destination rather than a retry.
