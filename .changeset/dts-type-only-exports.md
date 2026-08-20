---
"@theokit/sdk": patch
---

`LiveAgentRegistry` is no longer offered as a constructible value by the published
declaration. The source exports it type-only — the runtime singleton is reached
via `Agent.registry` — but the DTS rollup emitted `declare class` and re-exported
it as a value, while `dist/index.js` never exported it at all. A consumer writing
`new LiveAgentRegistry()` typechecked and failed at runtime.
