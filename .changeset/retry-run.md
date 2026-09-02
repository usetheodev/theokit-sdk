---
"@theokit/sdk": minor
---

`Retry.run(fn, options)` is the new name for `Retry.create(fn, options)`.

`create` never created anything — it runs `fn` with retry and resolves to `fn`'s
result — and the name said otherwise. It is deprecated, still honoured, and
removed in the next major.
