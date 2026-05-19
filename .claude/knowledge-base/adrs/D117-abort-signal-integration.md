# D117 — `runUntil` integrates `AbortSignal` at turn boundaries

**Date:** 2026-05-19
**Status:** Accepted

## Decision

`GoalOptions.signal?: AbortSignal`. The runUntil loop checks
`isAborted()` (helper, see ADR D111 comment) at the start of each turn
boundary — including BEFORE the first `status_change: active` event
(EC-C fix). When abort is observed, yields `status_change: paused` and
returns `GoalResult { status: "paused", turnsUsed, finalResponse }`.

## Rationale

Idiomatic JS. Caller passes `signal: controller.signal`; calls
`controller.abort()` from elsewhere (timeout, user click, sibling
cancellation). Custom event listeners are not idiomatic in modern TS;
periodic-check at turn boundaries is the standard pattern for cancellable
generators.

EC-C edge-case review: pre-aborted signals would have yielded `[active,
paused]` if the check ran after the first yield. The fix is to check
BEFORE the first yield, so pre-aborted signals yield `[paused]` only —
matches consumer mental model of "abort before start".

## Consequences

- **Enables:** AbortController integration with timeout patterns
  (`setTimeout(() => controller.abort(), 30_000)`).
- **Constrains:** abort is observed only at turn boundaries — not
  mid-`agent.send()`. A tool call that takes 2 minutes is uninterruptible.
  Documented as known limitation.
