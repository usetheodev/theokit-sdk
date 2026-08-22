---
"@theokit/sdk-cache": major
---

**Breaking:** `CacheEmbedderError` is removed.

Nothing ever constructed it, so `catch (e) { if (e instanceof CacheEmbedderError) … }` was a branch
that could not run. Every embedder failure — on `consult`, on `remember`, and on both plugin hooks —
degrades to a cache miss or a skipped write, warns on stderr, and increments
`CacheStats.embedderFailures`, because a cache is an optimisation and must not take the request
down with it. That counter is how a broken embedder is detected, and the README now says so.

Nothing to migrate: any handler for this class was already dead code.
