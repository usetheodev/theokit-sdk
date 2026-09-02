---
"@theokit/sdk": minor
---

`MemoryProvider.buildTools(handle, agent)` now declares its second parameter as
`MemoryProviderAgentRef` — `{ agentId, model }` — which is all the SDK has ever
passed it.

It declared `SDKAgent`, a 33-member interface, and satisfied that with a cast over
a two-field object. Any implementation reaching for one of the other 31 members —
`send()`, `fork()`, `dispose()` — got `undefined is not a function` at runtime, with
no compile-time warning, because the cast removed exactly that check.

Non-breaking in both directions: an `SDKAgent` still satisfies the new type, and an
existing implementation typed `agent: SDKAgent` still compiles. `MemoryProviderAgentRef`
is exported from the package root so you can name it.
