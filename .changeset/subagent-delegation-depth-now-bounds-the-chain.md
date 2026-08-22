---
"@theokit/sdk": patch
---

`maxDelegationDepth` now bounds the delegation chain it always claimed to.

The check ran once at tool-construction time against a `parentDepth` argument nothing in the SDK
incremented, so under the documented `SubAgent.create(spec)` call it could never fire and a
subagent whose tools include another subagent recursed unbounded. Depth is now counted at dispatch
and travels with the run, so nesting is bounded without threading a counter by hand.

A caller that does thread `parentDepth` keeps its existing behaviour — the threaded value offsets
the chain depth, and an already-impossible spec is still refused at construction.
