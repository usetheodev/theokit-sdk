---
"@theokit/sdk": patch
---

Fix (#61) — the Anthropic streaming client now detects a truncated stream. A stream that closes cleanly-but-early (server FIN / proxy hiccup before the terminal `message_delta` carrying `stop_reason`) previously committed silently as a clean `end_turn`; it now throws a typed `NetworkError{code:"stream_truncated"}`, matching the OpenAI client's guard.
