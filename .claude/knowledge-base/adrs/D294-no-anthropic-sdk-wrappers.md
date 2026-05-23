# D294 — Don't use Anthropic SDK wrappers (`@anthropic-ai/bedrock-sdk`, `@anthropic-ai/vertex-sdk`)

**Date:** 2026-05-23
**Status:** Accepted

## Decision

Direct `fetch`-based implementation in both `BedrockAnthropicClient` and `VertexAnthropicClient`. Anthropic wrappers are not used.

## Rationale

- `@anthropic-ai/bedrock-sdk` in TS does **not** support Bearer auth — forces SigV4. Using it would block D286.
- `@anthropic-ai/vertex-sdk` adds 567KB + transitive `google-auth-library` 572KB = ~1.1MB. Direct fetch saves bundle and keeps the implementation under our control.
- Total custom code is ~200 LoC across both clients — manageable.

## Consequences

- We must track Bedrock and Vertex API changes directly. Mitigation: API stability is high; Anthropic Messages is stable.
- Tests use mock `fetch` for deterministic behavior.
