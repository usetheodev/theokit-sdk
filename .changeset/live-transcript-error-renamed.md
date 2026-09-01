---
"@theokit/sdk": patch
---

`LiveSessionError` from `@theokit/sdk/persistence` is renamed to `LiveTranscriptError`. The old name
still works and is deprecated.

Two different classes were called `LiveSessionError`, exported from two declared subpaths that one
consumer can hold at once. They have incompatible shapes: the root barrel's is
`new LiveSessionError(sessionId, reason)` with a `reason` field and no `code`; the persistence one
was `new LiveSessionError(path)` with a `path` field and `code: "live_session_protected"`.

The failure was quiet in the way that costs most. `instanceof` is class identity, so a `catch`
checking the class imported from the root silently did not match the one thrown from persistence, and
the fallback ran for a condition the code believed it had handled. A `name` check looked like it
worked — `err.name === "LiveSessionError"` matched *both* — and then read `err.reason`, which only
one of them has.

The names now say what each refusal is about: refusing to destroy a **session**, and refusing to
overwrite a **transcript** file. `LiveSessionError` remains exported from `@theokit/sdk/persistence`
as a deprecated alias so existing imports keep working; it will be removed in the next major.
