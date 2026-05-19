# D106 — Transport is orthogonal to Profile via `apiMode`

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D105, D107

## Decision

`ProviderProfile.apiMode` selects the HTTP dialect transport at runtime:
- `chat_completions` → `OpenAIClient` (covers OpenAI, OpenRouter, Mistral, DeepSeek)
- `anthropic_messages` → `AnthropicClient`
- `responses_api`, `bedrock` → not yet implemented; throws clear error (EC-3)

A provider switching from chat_completions to a custom dialect ships
the new transport AS a plugin (`@theokit-transport-X`) without touching
SDK core.

## Rationale

Profile = WHAT (data); Transport = HOW (HTTP dialect). Separating them
lets new providers using existing dialects ship zero new code in SDK.

EC-3: `selectTransport` throws `ConfigurationError("transport_unavailable")`
with actionable message when apiMode is not supported.

## Consequences

- **Enables:** 22 providers Hermes supports work with 4 transports.
- **Constrains:** novel dialect → new Transport. Plan ships 2 builtins
  (chat_completions, anthropic_messages); responses_api + bedrock are
  follow-up. EC-3 covers the unsupported case with clear errors.
