---
"@theokit/sdk-handoff": patch
---

The rule that turns an agent's name into a tool-safe slug existed twice — once in `handoff.ts`,
once in `tool-injector.ts` — byte-identical apart from a parameter name, and covered by no test at
all. Two copies of one rule drift the moment either is adjusted, and nothing would have reported
it: a handoff tool named one way and a dispatcher expecting another.

It is now one function with tests describing the behaviour it already had: the `agent-` prefix
stripped case-insensitively, runs of unsafe characters collapsed to one underscore, underscores
trimmed from both ends, `"anonymous"` when nothing survives, and a 64-character cap. No result
changes.

The input is now bounded before the slug rules run. CodeQL flags one of those expressions as
polynomial backtracking; stated plainly, the quadratic cost **could not be reproduced** — V8
resolves 100,000 characters of the worst-case shape in under a millisecond. The bound is defence
in depth against an engine that does not optimise it, not a fix for a demonstrated exploit, and
nothing beyond the bound could have reached the 64-character result anyway.
