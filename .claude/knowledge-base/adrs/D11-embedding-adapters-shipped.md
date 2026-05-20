---
id: D11
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D11 — Embedding adapters shipped in v1.0; LMStudio/Google/Bedrock deferred

## Context
OpenClaw catalog has 7 embedding providers: openai, mistral, voyage, deepinfra, lmstudio, google, bedrock. The previous SDK iteration shipped 5 as throwing stubs (`adapter_not_implemented`). Under the no-stubs rule (`.claude/rules/no-stubs-no-mocks-no-wired.md`), all stubs were removed; only `openai`, `mistral`, and `openrouter` survived.

## Decision
v1.0 catalog: `{openai, mistral, openrouter, voyage, deepinfra}`. Three remaining (`lmstudio`, `google`, `bedrock`) deferred to v1.1 with deferral ADRs.

## Rationale
- **Voyage + DeepInfra are 80/20**: both OpenAI-compatible REST, both have free tiers / cheap pay-per-token, both have real demand. ~30 LoC each via `createOpenAiCompatibleRuntime`.
- **LMStudio** — requires user-side server (no remote validation, no automated dogfood).
- **Google Generative AI** — non-OpenAI request shape; needs its own factory.
- **Bedrock** — AWS SigV4 signing + IAM; entirely different auth model.

Each deferred one is its own ~2-day task with a distinct auth/transport story. Shipping the 80/20 now is honest; shipping half-broken adapters violates the no-stubs rule.

## Consequences
- `MEMORY_EMBEDDING_ADAPTERS` catalog has exactly 5 entries.
- `MemorySettings.index.embedding.provider` union is `"openai" | "mistral" | "openrouter" | "voyage" | "deepinfra"`.
- The 3 deferred ones never appear in the catalog or the type union until shipped.
- Deferral tracking: separate ADRs (or one rolled-up "v1.1 catalog growth" ADR) document the remaining providers.

## Alternatives Considered
- **Ship all 7 again as stubs** — rejected; violates no-stubs rule.
- **Ship none, BYO via runtime injection** — rejected; removes the convenience of provider-by-id resolution.
