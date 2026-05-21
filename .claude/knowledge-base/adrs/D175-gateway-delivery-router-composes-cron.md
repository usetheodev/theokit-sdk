# D175 — `DeliveryRouter` composes `Cron`; never reimplements scheduling

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`DeliveryRouter.send({ platform, channel, content })` is a pure dispatcher (platform → adapter → `sendMessage`). Scheduled delivery uses the existing `Cron` (ADR D7) with a callback that calls `DeliveryRouter.send(...)`.

## Rationale

Same logic as D174 — Cron is mature (`croner` D7, JSON persistence D8, timezone-aware, retry-capable). Building a parallel scheduler is YAGNI.

## Consequences

- **Enables:** all scheduled delivery features (timezone, retry, jitter) come from Cron for free.
- **Constrains:** delivery latency is bounded by Cron's tick resolution (~1s). Acceptable for the use cases (reminders, dream sweeps, batch reports).
