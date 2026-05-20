# D38 — SSE wire format = Vercel AI SDK Data Stream v1

**Status:** Decided
**Date:** 2026-05-17

## Decision

The `@usetheo/react` SSE endpoint emits messages in the **Vercel AI SDK
Data Stream v1** format. Each event is a single line prefixed by a
type code and followed by a JSON payload:

- `0:<json-string>` — text delta (append to assistant message content)
- `9:<json-object>` — tool call started (`{ toolCallId, toolName, args }`)
- `a:<json-object>` — tool call completed (`{ toolCallId, result }`)
- `d:<json-object>` — finish event (`{ finishReason, usage }`)
- `3:<json-string>` — error message (stream-level error)

The response is sent with `Content-Type: text/event-stream`,
`Cache-Control: no-cache`, `X-Vercel-AI-Data-Stream: v1`.

A copy of the spec lives inline at `packages/react/src/wire-format.md`
so the fingerprint is captured at our release time, independent of
upstream Vercel doc drift.

## Rationale

Following an established protocol means:

- Consumers migrating from `useChat` can swap to `useTheoChat` without
  rewriting their UI parsers.
- Any chat UI library that consumes Vercel's protocol works against
  our SDK out of the box (the ecosystem includes `@ai-sdk/ui-utils`
  and several third-party UI kits).
- We don't reinvent a wire format and don't have to document /
  evangelize a unique protocol.

Alternatives considered:

- **Custom format**: cleaner SDK ownership but zero ecosystem
  compatibility; consumers migrating from Vercel AI would need to
  rewrite parsers.
- **Server-Sent Events native** (`event:` + `data:` fields): tooling
  is less universal than Vercel's line-prefixed format; harder to
  parse incrementally.

## Consequences

- We commit to following Vercel Data Stream updates. If they ship v2
  with a breaking change, we either follow (and document the migration
  for our consumers) or fork (and accept the divergence cost).
- We do NOT depend on the `ai` npm package at runtime — we only
  implement the wire format ourselves. This keeps `@usetheo/react`
  light and avoids transitive deps from the Vercel package.
- The inline spec at `packages/react/src/wire-format.md` is the
  source of truth at our release version. If Vercel changes the
  protocol, we update the inline copy in a subsequent release.
