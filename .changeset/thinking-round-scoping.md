---
"@theokit/sdk": patch
---

Fixes four defects in the extended-thinking support shipped moments earlier (theokit#122).

A `/review` of that change found it created, on the most common thinking shape, the exact failure it
was meant to remove. A round that reasons and then calls a tool **without preamble text** never
consumed its thinking block: the block survived onto the next round and was persisted against the
wrong text, carrying a signature that no longer matched its body. And the replayed assistant turn
never carried the block at all, so the round after a thinking + tool_use turn reached the provider
missing it.

The block is now a value on the round's own output rather than state on the loop context, which
makes that class of leak unrepresentable, and it is recorded on whichever path closes the round —
assistant text or tool call. The replayed assistant message leads with it, as the provider requires.

Two smaller corrections in the same area: redacting the thinking text now drops the signature
instead of persisting a pair that cannot verify (the block survives as display-only history, which
loses one block of context rather than the whole turn), and the provider's own reported block is now
what the loop consumes — previously it was produced and read by nobody, the same dead-channel shape
this release deletes elsewhere.
