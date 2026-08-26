---
"@theokit/sdk": minor
---

A memory fact's `kind` can now actually be written. `Remember (feedback): prefer tabs` types the
fact; a bare `Remember:` leaves it untyped, as before.

The field was added so the local memory store would converge with the format Claude Code uses, and
it worked in one direction only: the SDK read a kind off an existing memory and honoured it, but no
path could ever produce one. `appendMemoryFact` rebuilt the fact as `{ text }` alone, so a kind was
severed at the single chokepoint every write passes through — the round-trip through the file format
was real and unreachable.

Only the four kinds the store accepts (`user`, `feedback`, `project`, `reference`) are recognised, so
an arbitrary parenthetical is never mistaken for one and no fact is silently typed wrong. `modified`
is still stamped by the SDK and ignored when supplied: a timestamp the caller controls can lie about
when something was learned, which defeats weighing a note from this morning against one from four
months ago.
