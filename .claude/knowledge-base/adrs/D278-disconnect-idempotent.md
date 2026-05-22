# D278 — `disconnect()` is idempotent + safe to call when never connected

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`if (!this.connected || this.app === undefined) return;` at the top. Otherwise, `await app.stop()` + clear references. Errors logged to stderr but never propagated.

## Rationale

Matches Telegram/Discord. SessionRouter + lifecycle managers may call disconnect from many paths (graceful shutdown, error recovery, test cleanup) — all must be safe.

## Consequences

- Test "disconnect-before-connect" verifies no throw.
- Tests cover disconnect-after-connect path.
