# D208 — Error isolation per-row; one failed row NEVER aborts the run

**Date:** 2026-05-22
**Status:** Accepted

## Decision

If a row's agent.send throws OR a scorer throws OR any per-row processing
fails, the row's `EvalRowResult.error` is populated and the row's
`meanScore` is forced to 0. The run CONTINUES processing remaining rows.

`EvalAggregate.errorRows` counts these failures explicitly.

CRITICAL errors (malformed dataset, invalid concurrency, unknown name
collision) STILL throw before any row runs.

## Rationale

- **Eval datasets are noisy.** 1 bad row out of 1000 is information, not
  a blocker. Aborting throws away 999 rows of signal.
- **Mirror Agent.batch D137.** Same failure-isolation contract; consumers
  who know `Agent.batch` know what to expect.

Alternatives rejected:

- **Abort on first error** — destroys partial signal.
- **Skip errored rows (count as 0/0)** — inflates pass ratio; treating
  errored rows as `score: 0` is the honest baseline.

## Consequences

- Enables: noisy datasets produce useful aggregates.
- Constrains: caller MUST check `aggregate.errorRows` to interpret quality;
  configuration errors still throw (a `concurrency: 0` doesn't get isolated).
