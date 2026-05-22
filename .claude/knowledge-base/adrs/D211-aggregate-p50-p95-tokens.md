# D211 — `EvalAggregate` includes p50/p95 row duration + tokens-in/out totals

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`EvalAggregate` shape (subset shown):

```ts
{
  meanScore, medianScore, passRatio, totalRows, errorRows,
  perScorer: Record<string, { mean, median, min, max }>,
  durationMsP50, durationMsP95,
  tokensInTotal, tokensOutTotal,
}
```

p50/p95 are row-duration percentiles, computed via in-house quickselect (no
`simple-statistics` dep).

## Rationale

- **Cost + latency are the two production gates.** Every consumer needs both
  before deploying. p50 alone misses long-tail; p95 captures bad-row case.
- **Token totals enable spend forecasting.** "1000 rows × this prompt = $40
  on gpt-4o" is a sentence consumers need.
- **In-house quickselect ~30 LOC.** External dep unjustified for one
  computation.

Alternatives rejected:

- **Only meanScore + passRatio** — Braintrust / LangSmith all ship p50/p95;
  table-stakes.
- **`simple-statistics` dep** — adds dep for one function.

## Consequences

- Enables: cost + latency dashboards directly from `EvalRun.aggregate`.
- Constrains: runner must capture `usage.inputTokens` / `usage.outputTokens`
  from each batch result (already populated by SDK); rows that error before
  LLM contribute 0 tokens (no penalty).
