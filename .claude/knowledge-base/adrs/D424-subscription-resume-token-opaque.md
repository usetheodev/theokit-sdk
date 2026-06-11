# D424 — Subscription resume token (`lastEventId`) is opaque, server-defined semantics

- **Status:** Accepted
- **Date:** 2026-06-04
- **Plan:** `g8-streaming-websocket-sse-resume-plan`

## Decision

`SubscriptionCtx.lastEventId?: string` is opaque to the SDK. Server handler defines the semantics: monotonic integer, ULID, timestamp, encrypted cursor, anything. SDK ships `tracked(id, payload)` helper to mint envelopes; client mirrors the most recent `id` back in `input.lastEventId` on reconnect.

## Rationale

Matches trpc's `inputWithTrackedEventId` pattern (`references/trpc/packages/client/src/internals/inputWithTrackedEventId.ts:1-15`) — keeps SDK transport-agnostic + consumer-flexible.

- **Adapter-managed buffering** (Socket.IO pattern, rejected): would force SDK to own a pluggable replay adapter (Redis/Postgres). Significant scope bloat.
- **Force monotonic int** (rejected): too prescriptive; distributed systems prefer ULIDs.
- **Encrypted resume token built-in** (rejected): consumer responsibility v1; documented in security threats table.

## Consequences

Handler MUST implement replay logic when `ctx.lastEventId !== undefined` (e.g., query DB for events with `id > lastEventId`). SDK does NOT buffer outgoing events server-side. Consumer can layer adapter-backed buffering when needed (deferred to P#9 plugin-realtime).
