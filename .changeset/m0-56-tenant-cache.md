---
"@theokit/sdk": patch
"@theokit/sdk-memory": patch
---

Security (#56) — close two residual cross-tenant active-recall cache leaks found by adversarial review.

- `@theokit/sdk-memory` (publishable) called `cache.get`/`cache.set` with no tenant context, so two callers with the same query text but different identity shared a cached recall — a cross-tenant leak for every consumer of the package. The cache read/write are now keyed by the `{namespace, userId, scope}` tenant tuple (the primitive already supported it).
- In `@theokit/sdk` the production caller hardcoded `namespace: "default"` and dropped `memoryContext.tenantId`, so two tenants sharing a `userId` collided on one cache entry. The caller now threads `memoryContext.tenantId` into the tenant partition (`namespace`). `sessionId` is intentionally not a key dimension — recall is cross-session by design.
