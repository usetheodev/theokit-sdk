# D302 — Bedrock streaming deferred to v1.x (EC-5 absorbed)

**Date:** 2026-05-23
**Status:** Accepted

## Decision

v1 `BedrockAnthropicClient` implements only `POST /model/{id}/invoke` (non-streaming). `/invoke-with-response-stream` (AWS Event Stream binary format) is deferred to v1.x. When the caller requests `request.stream === true`, the client makes the non-streaming call and emits the result as a single event to preserve the `AsyncGenerator<LlmEvent, LlmFinish>` interface.

## Rationale

AWS Event Stream is a binary format (prelude + type-encoded headers + payload + CRC32 trailer) — not SSE. Reusing the existing SSE parser doesn't work. Implementing correctly requires either (a) the `@aws-sdk/util-stream-node` peer dep (~50KB + transitives) or (b) reimplementing from spec (200+ LoC, bug-prone in CRC validation). Avoid scope creep masquerading as "50 LoC".

## Consequences

- v1 Bedrock latency is higher than true streaming (waits for full response).
- For real-time chat UX, the caller can (a) use Anthropic-on-Vertex (native SSE) or (b) reach for the escape hatch via `@aws-sdk/client-bedrock-runtime` directly.
- Documented limitation in README + docs.md.
- Forward-compat: `stream` parameter is already part of the interface; only the implementation changes in v1.x.
