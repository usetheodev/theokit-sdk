# D289 — Bedrock uses InvokeModel (not Converse)

**Date:** 2026-05-23
**Status:** Accepted

## Decision

`BedrockAnthropicClient` calls `POST /model/{modelId}/invoke`. Body is Anthropic Messages shape with `anthropic_version: "bedrock-2023-05-31"` injected; `model` stripped (the AWS model id goes in the URL).

## Rationale

Converse API normalizes payloads across providers but **loses Anthropic-specific features**: prompt caching extension fields, extended thinking detail, advanced tool use. InvokeModel preserves 100% of Anthropic Messages features.

## Consequences

- Only Claude on Bedrock supported in v1 (no Llama/Cohere/Mistral via Converse).
- Adding more Bedrock providers = adding more transports (1 per provider) — deferred to v1.x.
