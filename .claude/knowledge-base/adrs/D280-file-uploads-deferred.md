# D280 — File uploads / attachments deferred to v1.x

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`OutboundMessage` v1 supports only `text`. No `files`, no `attachments`. v1.x adds when demand surfaces.

## Rationale

Slack `files.upload_v2` API is complex (multipart, retry, `files:write` scope). Defer simplifies v1. Telegram/Discord also lack file support in `OutboundMessage` — parity.

## Consequences

- Caller needing file upload uses `adapter.getApp().client.files.upload_v2(...)` (escape hatch).
- Tests don't cover files.
