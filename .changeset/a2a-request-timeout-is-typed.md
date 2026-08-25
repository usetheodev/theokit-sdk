---
"@theokit/sdk": minor
---

`MessageBus.request` now rejects a timeout with `A2ARequestTimeoutError`, carrying
`code: "a2a_request_timeout"` plus the peer's address and the limit as fields.

It used to reject with a plain `Error` and no code, so the only way to identify a timeout was to
match the message — the practice `docs/error-codes.md` tells consumers never to rely on, and that
message embeds the address and the limit, so it changes with context exactly as the document warns.

The distinction this restores is what a retry policy is built on: a peer that did not answer is
transient and worth retrying, a peer whose handler threw is likely deterministic. A handler's own
error still propagates unchanged and is not this type.
