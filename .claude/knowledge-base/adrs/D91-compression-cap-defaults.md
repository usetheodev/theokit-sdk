# D91 — Compression cap default 3, grace call default 1

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D90, D92, plan `agent-core-loop-completion-plan.md`

## Decision

`IterationBudget` defaults:

- `maxCompressions: 3` — Hermes' shipped cap.
- `allowGraceCall: true` — one final iteration after `remaining === 0`
  so the agent has a last shot at a final answer.

Caller can override (`maxCompressions: N`, `allowGraceCall: false`) for
specialized workloads.

## Rationale

3 compressions covers legitimate long conversations (each compression
collapses ~15-20 turns into a summary). A 4th is the unmistakable sign of
a spiral in formation — fail loud at that point and force operator
intervention.

The grace call (one extra iteration after budget exhausted) prevents the
"agent stops mid-tool-result without emitting a final answer" failure
mode (Hermes v0.11 #10472 + AGENTS.md:84-140 grace-call pattern).

## Consequences

- **Enables:** the 4 Hermes compression spirals are blocked at boundary.
  Grace call makes the budget feel humane instead of cliff-edge.
- **Constrains:** users with unusual workloads (10+ tool rounds per
  conversation) may need to bump `maxIterations`. Default is intentional;
  cap > 8 should be a conscious choice.
