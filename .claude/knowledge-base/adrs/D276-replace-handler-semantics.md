# D276 — `onInbound(handler)` replaces the previous handler (EC-H pattern)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Second call to `onInbound` replaces the active handler. Returns `() => void` for unsubscribe. Matches Telegram/Discord EC-H behavior.

## Rationale

Consistency across adapters. Stacking handlers is confusing in multi-handler scenarios; `SessionRouter` already composes internally when multi-target dispatch is needed.

## Consequences

- Tests verify replace + unsubscribe.
- Documented in adapter API.
