---
"@theokit/sdk": minor
---

Carve the non-Harness surface out of `@theokit/sdk` (plan `monorepo-cohesion-split`).

BREAKING (no retro-compat, authorized): the `@theokit/sdk/rag` sub-path export and the embedded `voice` module are removed — they moved to standalone `@theokit/rag` / `@theokit/voice` packages (repos `theokit-rag` / `theokit-voice`). Decorator-first DX is no longer required of Harness features (ADR D431); `@theokit/di` / `@theokit/di-agent` / `@theokit/orm` moved to `theokit-backend-dx`, the gateway packages to `theokit-gateways`, `@theokit/react` to `theokit-react`, and `@theokit/skills-google-workspace` to the Skills pillar. The SDK now ships only the Agent-AI Harness. Remaining `@theokit/sdk-*` peer specifiers normalized to `workspace:^`.

Tagged `minor`; the release owner may elect `major` given the public sub-path removal.
