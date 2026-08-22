---
"@theokit/sdk": patch
---

The model catalog was fetched with `res.text()` and written to the cache with no size limit. The
default source is trusted, but `THEOKIT_MODELS_URL` lets an operator point the fetch anywhere, and
a host serving a multi-gigabyte document would have been materialised in memory and then written
to disk.

The fetch now refuses anything over 32 MiB — roughly 40x the real catalog. The declared
`content-length` is checked before the body is read, and the received size is checked after,
because a server that omits or misstates the header is exactly the one worth bounding.

A refused catalog is handled the way every other refresh failure already is: the SDK keeps serving
the data it had, and says so.
