---
"@theokit/sdk": patch
---

Fix a cross-tenant active-recall cache leak (#56). Active Memory recall results were cached keyed only by `(queryMode, userText)`, so two callers in the same process issuing the same query text — but belonging to different tenants (namespace / userId / scope) — could receive each other's recall results. The cache key infrastructure already supported a tenant tuple; `runActiveMemory` now threads `{namespace, userId, scope}` into both `cache.get` and `cache.set`, so recall entries are isolated per tenant. Same-tenant cache hits are preserved (no over-keying). No public API change.
