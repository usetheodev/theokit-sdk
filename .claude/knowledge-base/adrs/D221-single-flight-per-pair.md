# D221 — Single-flight per (sender, receiver) pair within one `send()` call

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Each `agent.send()` invocation tracks a `Set<string>` of `"<senderId>-><receiverId>"`
keys. Re-invoking the same pair within ONE send() throws
`HandoffPairLoopError`. Combined with D218 max-depth, gives two-layer loop
protection: depth (slow chains) + pair (direct ping-pong).

## Rationale

- Direct ping-pong (A→B→A) is caught at the THIRD hop by D218 (depth>1) but
  the symptom is "max depth exceeded" — diagnostic is unclear.
- Pair-level detection catches the ping-pong at the second occurrence with a
  clear "this pair already invoked" error.
- Mirrors Eval's name-level single-flight (D213) but at a different
  granularity (pair vs identity).

## Consequences

- Enables earlier + clearer loop detection.
- Constrains: legitimate "back-to-triage to escalate" patterns must introduce
  a 3rd party (e.g. `escalation_agent`), not loop A→B→A.
