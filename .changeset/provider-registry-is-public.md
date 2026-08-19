---
"@theokit/sdk": minor
---

Exposes the provider registry: `listProviders()` and `getProviderProfile(name)`.

The registry was `@internal`, so the SDK was the only thing that could answer "which providers
exist, and what does each one need?". `theokit` consequently kept its own hand-written list of
three — against the 46 registered here — and an agent declaring `ollama/qwen2.5:3b` routed to
whichever API key happened to be set rather than to Ollama (usetheokit/theokit#326).

A second table that nothing forces to agree with the first is not a cache, it is a future bug.
These two functions exist so there is one table, and the framework can stop guessing.

Both register the builtins before answering. Registration is lazy — it happens when an agent is
created, a run is routed, or a provider is defined — so a caller asking early would otherwise get
an empty registry and reasonably conclude the SDK knows nothing. Local providers (`ollama`,
`lmstudio`, `llamacpp`) come back with `authType: "none"`, which is what lets a consumer tell "no
credential needed" apart from "credential missing" without hardcoding names.
