---
user-invocable: false
paths:
  - "**/*eval*"
  - "**/*Eval*"
  - "**/*scorer*"
description: TheoKit SDK Eval suite API reference — Eval.create, scorers, datasets, EvalRun
---

# TheoKit Eval Suite

Eval-as-code primitive for production deploy gates. Run evals against real LLM
providers to measure quality, latency, and cost before shipping.

## Quick start

```typescript
import { Eval, Scorers } from "@theokit/sdk/eval";

const run = await Eval.create({
  name: "qa-smoke",
  dataset: [
    { input: "Reply with the word: ok.", expected: "ok" },
    { input: "Say jazz in one word.", expected: "jazz" },
  ],
  scorers: [
    Scorers.containsExpected({ caseSensitive: false }),
    Scorers.regex(/[a-zA-Z]/),
  ],
  agent: {
    apiKey: process.env.OPENROUTER_API_KEY,
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
  },
  concurrency: 4,
}).run();

console.log(run.aggregate.meanScore);     // 0.95
console.log(run.aggregate.passRatio);     // 1.0
console.log(run.aggregate.tokensInTotal); // 142
console.log(run.aggregate.durationMsP95); // 1830
```

## Built-in scorers (`Scorers`)

| Scorer | What it checks |
|---|---|
| `Scorers.exactMatch({ caseSensitive? })` | `output.trim() === expected.trim()` — refuses empty `expected` |
| `Scorers.containsExpected({ caseSensitive? })` | `output.includes(expected)` — refuses empty `expected` |
| `Scorers.regex(pattern)` | `pattern.test(output)` — test patterns against adversarial output to avoid ReDoS |
| `Scorers.jsonShape(zodSchema, { strict? })` | `JSON.parse(output)` + Zod validation — caps output at 1 MB before parse |
| `Scorers.llmJudge({ model, apiKey, criteria, rubric? })` | Second LLM scores against criteria — requires SEPARATE `apiKey` |
| `Scorers.levenshtein({ threshold?, caseSensitive? })` | Normalized edit-distance similarity `1 - dist/max(len)` — deterministic (no LLM); `threshold` binarizes |
| `Scorers.numericDiff({ tolerance? })` | Relative numeric closeness `1 - |o-e|/max(|o|,|e|)` — deterministic; `tolerance` binarizes |
| `Scorers.embeddingSimilarity({ apiKey?, model?, threshold?, embed? })` | Cosine of output vs expected embeddings (OpenRouter by default; inject `embed` for another provider). One embeddings call per row |
| `Scorers.verifyGate({ sandbox?, repoDir, failToPass, passToPass, command })` | Runs the project's tests in a sandbox; scores 1 iff exit 0 (SWE-bench style) |

### Custom scorer

A scorer is an async function returning a number between 0 and 1:

```typescript
const myScorer = async (row: { input: string; output: string; expected?: string }) => {
  return row.output.length < 100 ? 1.0 : 0.5;
};
```

## Dataset

The `dataset` field accepts an array of objects with `input` and optional `expected`:

```typescript
interface EvalDatasetRow {
  input: string;
  expected?: string;
}
```

Recommended ceiling: ~10k rows (v1 materializes in memory). For larger evals,
partition into multiple `Eval.create` calls.

## `EvalRun` shape

```typescript
interface EvalRun {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  aggregate: EvalAggregate;
  rows: ReadonlyArray<EvalRowResult>;
  metadata?: Record<string, unknown>;
}

interface EvalAggregate {
  meanScore: number;
  medianScore: number;
  passRatio: number;          // rows where meanScore >= 0.5
  perScorer: Record<string, { mean; median; min; max }>;
  totalRows: number;
  errorRows: number;
  durationMsP50: number;
  durationMsP95: number;
  tokensInTotal: number;
  tokensOutTotal: number;
}
```

`EvalRun` is plain JSON — `JSON.stringify(run)` works directly.

## CI gate — `assertEval`

Turn a run into a pass/fail gate. `assertEval` reads only `run.aggregate`,
collects EVERY unmet threshold, and throws `EvalThresholdError` (with a
`.failures` list) when any is missed — otherwise returns `void`. Drop it into a
Vitest `it(...)` or a standalone script whose non-zero exit fails the CI job.

```typescript
import { Eval, Scorers, assertEval, EvalThresholdError } from "@theokit/sdk/eval";

const run = await Eval.create({ name: "qa", dataset, scorers, agent }).run();

assertEval(run, {
  minMeanScore: 0.8,     // aggregate.meanScore >= 0.8
  minPassRatio: 0.9,     // aggregate.passRatio  >= 0.9
  maxErrorRatio: 0,      // errorRows / totalRows <= 0
  perScorer: { "contains-expected": 0.7 }, // per-scorer mean floor (absent scorer = failure)
});
```

## Trials (smooth non-determinism)

`trials: N` runs each dataset row N times and collapses to ONE row whose
per-scorer score is the mean over the trials (an errored trial contributes 0).
`EvalRowResult.trialCount` records the collapse. Range `[1, 100]`.

```typescript
const run = await Eval.create({ name: "qa", dataset, scorers, agent, trials: 3 }).run();
```

## Concurrency

`concurrency` defaults to 4. Allowed range: `[1, 64]` (integer). 0 and
Infinity are rejected at `Eval.create` time.

## Concurrent runs

Per-process single-flight per `name`. Two `Eval.run` calls with the same
`name` running simultaneously throw `EvalAlreadyRunningError`. Include model
id in the name for matrix runs.

## CLI integration

The `theokit eval` CLI invokes `Eval.run` internally. User-authored
`eval.config.{ts,mjs}` files are forward-compatible.

## Telemetry

When `agent.telemetry.enabled === true`, `Eval.run` emits a parent `eval.run`
OTel span; `agent.send` / `llm.call` spans nest under it.

## Cost forecasting

```
aggregate.tokensInTotal  x provider_input_price
+ aggregate.tokensOutTotal x provider_output_price
```

With `llmJudge`, add ~1 judge call per row. 1000 rows with `gpt-4o-mini`
costs roughly $3.00 total (base + judge).

## Errors

| Error | When |
|---|---|
| `EvalAlreadyRunningError` | Same `name` already running in this process |
| `EvalThresholdError` | `assertEval` found one or more unmet thresholds (see `.failures`) |
| `ConfigurationError` | Invalid concurrency, missing required fields |
