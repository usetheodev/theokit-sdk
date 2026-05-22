# D240 — `.parallel` and `.foreach` reuse `AsyncSemaphore` from `internal/runtime/`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Concurrency control in `.parallel` and `.foreach` uses the existing in-house `AsyncSemaphore` (D135), not a new helper. Defaults: `parallel` unbounded (all branches simultaneous; caller pre-declared the count), `foreach` bounded to 4 (matches `Agent.batch` D136).

## Rationale

`AsyncSemaphore` exists, tested with fast-check (1600 runs). Rewriting = code duplication. Default divergence is deliberate: `.parallel([a, b, c])` declares 3 statically (caller already chose the count); `.foreach` runs over runtime arrays of unknown size (must protect against fan-out blowups).

## Consequences

- Changes to `AsyncSemaphore` affect both `.parallel` and `.foreach`.
- Tests must verify concurrency caps via timing assertions or `vi.useFakeTimers`.
- Caller can override: `.foreach(step, { concurrency: N })`.
