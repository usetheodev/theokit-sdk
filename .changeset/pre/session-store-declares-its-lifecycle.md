---
"@theokit/sdk": minor
---

`SessionStore` declares the three lifecycle hooks the SDK was already calling.

The port declared two methods, and the SDK probed for `acquire`, `release` and `dispose` through
`as unknown` casts. They worked — but nothing in the interface mentioned them, so a store author
implementing the documented two-method contract got no writer lease, no release and no disposal, with
no way to discover that those hooks existed.

They are now optional members with their contracts written down, including the one that matters:
a rejection from `acquire` whose `name` is `SessionBusyError` **propagates to the caller**, because
another process holding the session is a decision the caller has to make. Every other rejection is
treated as "no lease here" and the turn proceeds.

Optional means optional: an existing two-method store keeps working unchanged. What changes is that
the capability is now readable in the type you implement.
