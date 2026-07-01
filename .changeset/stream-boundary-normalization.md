---
"@theokit/sdk": patch
---

Suppress the leaked-dialect tool-call from the visible stream (R7). When `extractToolCallsFromContent` is enabled and a model leaks a `<function=NAME>` tool call as assistant text, the OpenAI-compat streaming now HOLDS that text back at the stream boundary (a small suspicion-buffer FSM that reuses the request-scoped allowlist from R5) instead of emitting it as `text_delta` events — so the raw dialect no longer flashes by in the live stream or lands in the final assistant text. `finish()` still recovers the call (unchanged). Fail-open: a never-closing marker or un-suppressable input is flushed as visible text (never held forever). Flag-off streaming is byte-for-byte unchanged. Grounded in peer-project's stream-normalizer FSM.
