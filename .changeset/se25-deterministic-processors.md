---
"@theokit/sdk": minor
---

**SE25 — deterministic in-tree guardrail processors (`createUnicodeNormalizer`, `createTokenLimiter`).**

Two churn-free, no-LLM processors built on the SE24 seam:

- `createUnicodeNormalizer({ stripControlChars?, collapseWhitespace? })` — an input processor: Unicode NFC normalization (stdlib `String.prototype.normalize`) plus optional C0/DEL control-char stripping (keeps tab/newline/carriage-return) and whitespace collapsing.
- `createTokenLimiter({ limit, strategy? })` — caps text to a token budget using a char-based estimate (~chars/4, no tokenizer dep; `estimateTokens` is exported). `strategy: "truncate"` (default, cut to fit) or `"block"` (abort → tripwire). Fires on whichever array it is placed in (input caps the prompt, output caps the response).

Both are OPT-IN (add to `inputProcessors`/`outputProcessors`); nothing auto-injects them; back-compat preserved.

**`BatchPartsProcessor` is intentionally DEFERRED**, not shipped: TheoKit's `run.stream()` emits full `SDKAssistantMessage`s, not token-granular deltas, so there is no SSE chunk stream to coalesce in the in-process runtime (Mastra's BatchParts cuts HTTP network overhead). It becomes meaningful only alongside a future HTTP/SSE streaming transport (the same milestone as SE24's deferred streaming-output redaction). Mirrors Mastra's deterministic guardrail processors. From the Mastra Guardrails comparison (SDK Evolution roadmap SE25).
