# D281 — Block Kit formatting deferred to v1.x; plain text + simple markdown in v1

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`OutboundMessage.format: "plain" | "markdown"` (no `"blocks"`). Markdown maps to `mrkdwn: true` in `chat.postMessage`. v1.x adds `"blocks"` + Block Kit payload structure.

## Rationale

Block Kit is powerful but adds ~300 LoC of mapping (sections, dividers, buttons, etc.). Plain markdown covers 80% of initial use cases (FAQ bot, classify, summarize).

## Consequences

- Escape hatch via `adapter.getApp().client.chat.postMessage({ blocks: [...] })`.
- Documented limitation.
