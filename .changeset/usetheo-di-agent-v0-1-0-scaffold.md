---
"@theokit/di-agent": minor
---

Initial release of `@theokit/di-agent` — agent-first DI integration for `@theokit/di`.

Ships `@InjectAgent()` parameter decorator + `createAgentProvider()` factory helper that produces a REQUEST-scoped `Agent` (from `@theokit/sdk`) factory provider. Each HTTP request handled inside `container.runInRequest(...)` gets an isolated Agent instance automatically — the wedge that differentiates `@theokit/di` from generic DI containers.

Peer deps: `@theokit/di`, `@theokit/sdk`, `reflect-metadata`.
