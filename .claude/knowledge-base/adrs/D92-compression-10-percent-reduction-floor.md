# D92 — Compression must reduce ≥10% tokens or throw

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D91, plan `agent-core-loop-completion-plan.md`

## Decision

`assertCompressionReduced(before, after, minPct = 10)` returns
`{ reduced: false, reason: "Spiral likely." }` when the compression
result is not at least 10% smaller than the input.

Caller is expected to throw `CompressionIneffectiveError` on a `reduced:
false` result, preventing the loop from triggering compression again on a
context that didn't shrink.

## Rationale

Compression LLMs sometimes echo more content than they consume (chatty
summarizer model, schema bug, partial completion). Without a reduction
floor, the loop:

1. Triggers compression at 95% of limit.
2. Compression returns 95% of limit still.
3. Loop retriggers compression.
4. Infinite loop, costs spike (`compression-death-spiral.md:32-49`).

10% is arbitrary but matches Hermes' threshold. Empirically separates
"compression real" from "compression placebo".

## Consequences

- **Enables:** early-detection of spiral formation.
- **Constrains:** workloads where compression marginally shrinks are
  blocked. Caller can lower `minPct` for those cases.
