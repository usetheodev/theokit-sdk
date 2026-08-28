---
"@theokit/sdk": patch
---

Corrects a security figure published with 4.61.0, and adds the rule that produced the error.

The 4.61.0 notes said a planted memory entry made the agent perform the action it described in
**2 of 6 runs**. Re-measured against the published 4.61.0 itself, it is **6 of 6**. Registering
the permission engine still blocks it — 6 of 6, with zero errors.

The old figure was not a smaller version of the same risk; it was a measurement of a different
thing. It was taken against a retrieval path that did not recall the planted entry at all: on
4.60.0 the agent answered "Done." and never saw it, while on 4.61.0 it recites the entry
verbatim. Nothing about the attack changed between those runs — the recall path did.

**A poisoning rate measured against a retrieval path that does not recall the plant is a
measurement of how often the attack reached the model, not of how often the model resisted it.**
Any such figure has to record whether the plant was recalled, or it cannot be compared across
versions.

The consequence for anyone depending on this: improving recall is a change to the threat model,
not something orthogonal to it. The property that makes a planted memory work is the property
that makes a real one useful. **If anything other than your agent's own deliberate writes can
reach the memory directory, register the permission engine.**

Separately, the original proof constructed the engine as `new PermissionEngine({ rules: [] })`.
The constructor takes the rules positionally, so that was never a rule list, and nothing checked
because the script was JavaScript. A crash inside the engine and a gated call produce the same
observation. Re-run in TypeScript with `new PermissionEngine([])`, it gates: 6 of 6 blocked, 0
runs threw.
