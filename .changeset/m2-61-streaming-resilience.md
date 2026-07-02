---
"@theokit/sdk": minor
---

Harden the streaming path against stalls, truncation, and malformed tool-call JSON (#61).

- **Idle timeout:** every SSE `reader.read()` is now raced against an idle timer (default 60s, `parseSseStream(body, signal, idleTimeoutMs)`; pass `0` to disable). An upstream that handshakes then goes silent no longer hangs the agent loop forever — it rejects a typed `NetworkError` (`code: "stream_idle_timeout"`) and the body socket is cancelled. "Idle" means *no bytes at all* within the window, so a slow-but-alive stream is unaffected.
- **Truncation detection:** an OpenAI-compatible stream that ends with NEITHER a `finish_reason` NOR a `[DONE]` sentinel was truncated (dropped connection / proxy hiccup). It now throws a typed `NetworkError` (`code: "stream_truncated"`) instead of silently committing the partial turn as a clean `end_turn`, so retry/fallback can route it.
- **Tool-call JSON repair:** `parseToolArguments` now attempts `jsonrepair` (already an in-tree dependency) before the `{ raw }` fallback, so a slightly-malformed native tool call (trailing comma, unquoted key — the Kimi/K2 class) parses instead of bouncing to the model as an `invalid_request` round-trip. Genuinely unrepairable input still lands in `{ raw }`.

All stdlib + an existing dependency — no new runtime dependency.
