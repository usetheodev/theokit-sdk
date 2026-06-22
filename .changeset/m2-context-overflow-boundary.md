---
"@theokit/sdk": patch
---

M2-3 — `context_too_long` reaches the run boundary (plan `m2-context-overflow-boundary`).

Fixes a code-at-boundary bug: the loop captured the error code from the error's top-level `.code`, which the provider mappers set to a PROVIDER-PREFIXED string (`anthropic_context_too_long` / `${providerId}_context_too_long`), while the CANONICAL `ErrorCode` (`context_too_long`) lives on `metadata.code`. So `RunResult.error.code` surfaced the prefixed form and a consumer checking `result.error.code === "context_too_long"` missed it.

`registerLoopError` now prefers `cause.metadata?.code` over the top-level `.code`, so the canonical code reaches the boundary for every provider (verified by a 400-context-overflow contract test through the real `mapAnthropicError`/`mapOpenAICompatibleError`). The prefixed form remains on the thrown `TheokitAgentError.code` for telemetry. Set-once invariant preserved; top-level `.code` fallback unchanged when there is no `metadata.code`.
