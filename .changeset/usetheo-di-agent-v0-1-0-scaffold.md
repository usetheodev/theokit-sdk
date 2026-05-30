---
"@usetheo/di-agent": minor
---

Initial release of `@usetheo/di-agent` — agent-first DI integration for `@usetheo/di`.

Ships `@InjectAgent()` parameter decorator + `createAgentProvider()` factory helper that produces a REQUEST-scoped `Agent` (from `@usetheo/sdk`) factory provider. Each HTTP request handled inside `container.runInRequest(...)` gets an isolated Agent instance automatically — the wedge that differentiates `@usetheo/di` from generic DI containers.

Peer deps: `@usetheo/di`, `@usetheo/sdk`, `reflect-metadata`.
