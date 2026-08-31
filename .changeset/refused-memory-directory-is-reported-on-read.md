---
"@theokit/sdk": patch
---

A refused `memory.directory` is now reported on the read path, not only on the write path.

A relative `directory` is refused by contract, and the write path has said so since the near-miss
diagnostic landed. The read path did not: `readMemoryForSend` wrapped everything in `safeCall`, which
reports on `diag` — dropped entirely when the host installed no sink. An app that only CONSUMES
memory, which is the served case the option exists for, answered every turn normally with an empty
store and never learned why.

Measured against the published package with no sink installed: `Agent.create` did not throw, the turn
answered normally, nothing was written to either the configured path or the default store, and
stderr said nothing at all.

`safeCall` stays where it was added for, and that trade is unchanged: a corrupt memory file must not
abort the turn, and reporting it quietly is right because it is transient and local to one entry. A
`ConfigurationError` from the resolver is the opposite — permanent, repeating on every turn forever,
and fixable in one line by the person being kept in the dark — so it goes on the channel a failure
cannot be dropped from.

Reported **once per configuration per process**, not per turn. A warning that arrives every turn is a
warning somebody turns off.
