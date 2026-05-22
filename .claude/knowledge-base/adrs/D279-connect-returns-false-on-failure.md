# D279 — `connect()` returns `false` on failure, NEVER throws (EC-I pattern)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Token invalid, network down, Slack outage — all result in `connect()` returning `false` + stderr log. Never propagates exception. EC-1: failure path also calls `app.stop()` to clean up orphan listening App if `app.start()` succeeded before the failure point.

## Rationale

Matches Telegram/Discord. SessionRouter may try fallback adapters; throwing breaks that orchestration.

## Consequences

- Tests with invalid tokens verify `false` return.
- Catch block ensures no orphan App remains.
- Documented.
