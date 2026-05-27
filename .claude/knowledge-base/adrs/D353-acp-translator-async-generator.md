# D353 — Translator uses AsyncGenerator pipeline (Run.stream → SessionUpdate)

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

ACP `prompt` is request-response with streaming notifications during the call. Our `Run.stream()` returns `AsyncGenerator<SDKMessage>`. Translation is one-to-many: one SDK message may map to multiple ACP `SessionUpdate` notifications.

## Decision

`translateStream(messages, conn, sessionId, controller, options)` consumes the SDK AsyncGenerator and pushes ACP `sessionUpdate` notifications via the connection. Switch over `SDKMessage.type` with `as never` exhaustive check.

## Rationale

Aligns with our existing AsyncGenerator-based streaming. Exhaustive check fails at compile time if a new SDK message variant is added (D45 added `object_delta` — exhaustive check would catch a missed handler).

## Consequences

- Translator is the load-bearing module (~300-500 LoC).
- Compile-time guard against missed variants — non-negotiable.
- One-to-many mapping documented in concept page (T6.1).
