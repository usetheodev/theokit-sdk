# D282 — Reactions / modals / slash commands / interactive components deferred to v1.x

**Date:** 2026-05-22
**Status:** Accepted

## Decision

v1 does NOT expose APIs for `reactions.add`, `views.open` (modals), `app.command(...)` (slash commands), or `app.action(...)` (block actions). v1.x adds via hook system + escape-hatch.

## Rationale

Each requires new hook semantics on `BasePlatformAdapter` (which affects Telegram/Discord too). Focus v1: ship Slack core feature parity.

## Consequences

- Apps needing these features use `adapter.getApp().command(...)` directly (escape hatch, not recommended for production).
- Documented.
