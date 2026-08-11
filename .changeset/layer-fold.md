---
"@theokit/sdk": minor
---

`foldLayers` / `verifyLayerOrdering` — combine configuration layers in a declared order.

Later layers win, `undefined` never overwrites, and named keys ACCUMULATE instead of being
replaced. That last rule is not a nicety: with plain last-wins a project file DISPLACES the user's
entries for a list-valued key rather than adding to them, and for a key like `hooks` — arbitrary
command execution on every tool call — that is the difference between a repository adding a hook and
a repository removing yours.

`verifyLayerOrdering` refuses a chain that is not strictly ascending, naming both layers and both
precedences. Tolerating it would make resolution depend on array order rather than on declared
precedence: two sources of truth for one decision.

The layer NAMES are the caller's, supplied as data — one product's chain is
defaults/user/project/profile/env/cli and `profile` is that product's idea. Entries may omit
`precedence` to mean "this array is already the order".

Additive. Nothing calls it yet.
