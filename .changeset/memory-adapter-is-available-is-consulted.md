---
"@theokit/sdk": minor
---

`MemoryAdapter.isAvailable()` now disables an adapter that returns `false`, as its mandatory
presence always implied.

Nothing called it. Every third-party adapter implements it as "is there a non-empty apiKey", so an
implementer reasonably read `false` as "disable me" — and it disabled nothing: the client is built
lazily, so `mem0Memory({ apiKey: "" })` started normally and surfaced mid-conversation as
`auth_failed`, at the point where a memory write is happening rather than where the operator could
still fix it.

An unavailable adapter is now skipped with a diagnostic naming it, so a missing key degrades to
no-memory and a multi-adapter setup falls back to the ones that work. When every registered adapter
declines, `write` and `recall` fail with a message saying exactly that — distinct from the message
for no adapter registered at all.
