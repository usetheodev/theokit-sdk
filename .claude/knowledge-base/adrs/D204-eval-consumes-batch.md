# D204 — Internally `Eval.run` consumes `Agent.batch` for parallelism

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`Eval.run` does NOT implement its own fanout. It calls `Agent.batch(prompts,
{ concurrency, signal, agent })` and applies scorers on each batch result.

## Rationale

`Agent.batch` (D134-D140) already implements every property eval needs:

- failure isolation per-prompt (D137 → maps to D208 error isolation)
- async-semaphore in-house, no `p-limit` dep (D135)
- credential pool inheritance via ALS (D138)
- abort-pending-only signal handling (D140)
- fresh agent per prompt with shared pool (D138)

Re-implementing would create two divergent execution paths and violate DRY.

Alternatives rejected:

- **Custom semaphore** — duplicates D135.
- **`p-limit` library** — adds an external dep for behavior we already have.

## Consequences

- Enables: Eval inherits Batch correctness properties for free.
- Constrains: concurrency default = Agent.batch's default (4 per D136);
  Eval cannot do anything Batch can't (e.g. cross-row state — not needed v1).
