---
"@theokit/sdk": major
---

Carve the non-Harness surface out of `@theokit/sdk` (plan `monorepo-cohesion-split`). The SDK now ships only the Agent-AI Harness.

BREAKING (no retro-compat, authorized):
- Removed the `@theokit/sdk/rag` sub-path export and the embedded `voice` module — they moved to standalone `@theokit/rag` / `@theokit/voice` packages (repos `theokit-rag` / `theokit-voice`). Import those packages instead.
- Decorator-first DX is no longer required of Harness features (ADR D431). `@theokit/di` / `@theokit/di-agent` / `@theokit/orm` moved to `theokit-di`, the gateway packages to `theokit-gateways`, `@theokit/react` to `theokit-react`, and `@theokit/skills-google-workspace` to the Skills pillar. Decorators remain available as an optional layer via the externally-published `@theokit/di`.

The surviving `@theokit/sdk-*` extension peer specifiers stay as semver ranges (`>=1.7.0`), satisfying the publish-readiness gate.
