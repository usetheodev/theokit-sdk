---
"@theokit/sdk": patch
---

The live-agent registry and the session cache survive a package loaded twice.

`liveAgentRegistry` and the session cache's two maps were plain module-level `const`s, which are
singletons per module INSTANCE. A package can be loaded more than once in one process — two copies in
`node_modules`, ESM and CJS side by side, a monorepo with distinct versions — and each copy then gets
its own registry. For the live-agent registry, the public one, that means two views of which agents
are running, and a caller reading the wrong one sees none.

All three now go through the same `Symbol.for`-keyed helper the rest of the SDK uses.

The session cache's docblock asserted that the instances "remain the only ones in the process, because
an ES module is a singleton". That is the claim the helper exists to refute; the docblock now says so.
