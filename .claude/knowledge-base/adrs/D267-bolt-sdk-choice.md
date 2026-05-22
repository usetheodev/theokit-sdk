# D267 — Use `@slack/bolt` as the canonical Slack SDK (not `@slack/web-api` raw)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`SlackAdapter` uses `@slack/bolt` (v3.20+) which internally combines `@slack/web-api` + `@slack/socket-mode` + event routing.

## Rationale

Bolt is the official Slack-recommended SDK for JS/TS bots. Using `web-api` raw would require reimplementing Socket Mode, event dedup, retry logic that Bolt already provides.

## Consequences

- Peer dep `@slack/bolt` adds ~3MB to adapter (not the SDK core).
- Tests mock Bolt via `vi.mock`.
- Future migration to slack-edge or similar is localized.
