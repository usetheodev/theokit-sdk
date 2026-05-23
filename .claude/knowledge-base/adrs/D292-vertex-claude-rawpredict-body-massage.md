# D292 — Vertex Claude uses `:rawPredict` with body massage

**Date:** 2026-05-23
**Status:** Accepted

## Decision

For model IDs `vertex/anthropic/claude-*`, the profile maps to `apiMode: "anthropic_messages"` but with baseUrl + body customization. `VertexAnthropicClient` calls `:rawPredict` / `:streamRawPredict`, injects `anthropic_version: "vertex-2023-10-16"` in the body, removes `model` from body (it goes in the URL).

## Rationale

Anthropic-on-Vertex has its own shape (model in URL, `anthropic_version` in body as a specific string). It's not OpenAI-compat. Using `@anthropic-ai/vertex-sdk` would add ~1.1MB (567KB SDK + 572KB google-auth-library) and double the abstraction layer.

## Consequences

- New `VertexAnthropicClient` (~150 LoC).
- Reuses the SSE parser from `AnthropicClient` (response body shape is identical to Anthropic native).
