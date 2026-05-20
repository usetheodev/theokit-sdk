# D144 — Background prefetch is opt-in

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`MemoryAdapterCapabilities.prefetch` is currently informational (no
prefetch wiring lives in the SDK in this release). When prefetch
ships, it will be opt-in via `enablePrefetch: false` on adapter
options. Default OFF.

## Rationale

Hermes defaults prefetch ON. Risk: a 2-second background recall blocks
turn N+1 silently — caller has no visibility into the latency. Defaulting
OFF makes turn latency predictable; consumers who measure and want the
win opt in deliberately.

## Consequences

- **Enables:** predictable latency by default; no hidden network calls
  warming up between turns.
- **Constrains:** consumers wanting prefetch must set the option
  explicitly. Documented in each adapter's README.
