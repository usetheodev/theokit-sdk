# D180 — Platform-portable features are first-class; platform-specific features are opt-in extensions

**Date:** 2026-05-21
**Status:** Accepted

## Decision

The `GatewayContext` + `MessageEvent` core exposes text + threads + reply-target as portable capabilities that work identically on every adapter. Platform-specific features (Telegram voice transcription, Discord embeds, photo OCR, stickers) are accessed via `event.{telegram,discord}?.raw` — the consumer feature-detects and casts.

## Rationale

The 80/20 rule for messaging bots: text in / text out + slash commands cover ~80% of real usage. Forcing every adapter to implement voice transcription would block Discord (which has voice channels but not voice-as-message-attachment). Opt-in extensions via `raw` keep the core lean while not blocking advanced use cases.

## Consequences

- **Enables:** Discord adapter ships without needing to invent a voice-message concept that doesn't exist on Discord; Telegram retains full feature access via the escape hatch.
- **Constrains:** consumers writing cross-platform bots must feature-detect (`if (event.platform === "telegram") { ... }`). Standard TypeScript discriminated-union pattern.
