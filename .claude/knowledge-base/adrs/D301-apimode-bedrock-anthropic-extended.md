# D301 — `ApiMode` extended: `"bedrock_anthropic"` (new); Vertex reuses `"chat_completions"` and `"anthropic_messages"`

**Date:** 2026-05-23
**Status:** Accepted

## Decision

- Add `"bedrock_anthropic"` to the `ApiMode` union for the InvokeModel + body massage path.
- Vertex Gemini reuses `apiMode: "chat_completions"` (reuses `OpenAIClient`) with a baseUrl + auth override.
- Vertex Claude uses `apiMode: "anthropic_messages"` but `selectTransport` checks `profile.name === "vertex"` to dispatch to `VertexAnthropicClient` instead of `AnthropicClient`.

## Rationale

Bedrock body shape diverges enough from native Anthropic (URL routing + `anthropic_version` differences) to warrant its own apiMode. Vertex Gemini OpenAI-compat is literally OpenAI body — reuse. Vertex Claude is Anthropic-shape with small diffs — a sub-discriminator on `profile.name` is cleaner than adding yet another apiMode.

## Consequences

- `selectTransport` switch gains 2 cases (one new apiMode + one sub-branch).
- Forward-compat: other profiles needing "Anthropic body with different auth" reuse the pattern.
