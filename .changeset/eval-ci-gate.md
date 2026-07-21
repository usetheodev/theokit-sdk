---
"@theokit/sdk": minor
---

feat(eval): eval-as-CI-test primitives (SE41). Adds the pieces that turn `@theokit/sdk/eval` into a regression gate you can drop into a pipeline:

- **`assertEval(run, thresholds)`** — a pure gate over an `EvalRun` that throws `EvalThresholdError` (carrying the full list of unmet thresholds) when a run misses `minMeanScore`, `minPassRatio`, `maxErrorRatio`, or any `perScorer` floor. Passing returns `void`, so it drops straight into a Vitest `it(...)` or a standalone eval script whose non-zero exit fails CI.
- **Three new scorers** — `Scorers.levenshtein()` (normalized edit-distance similarity, deterministic), `Scorers.numericDiff()` (relative numeric closeness, deterministic), and `Scorers.embeddingSimilarity()` (cosine of output vs expected embeddings via OpenRouter, or an injected `embed` for other providers/tests). The two deterministic scorers always run in CI with zero token spend.
- **`EvalOptions.trials`** — repeat each dataset row N times and collapse to one row whose per-scorer score is the mean over the trials (an errored trial contributes 0), smoothing single-model non-determinism. `EvalRowResult.trialCount` records the collapse.
- A `pnpm eval` script + an OpenRouter-gated `eval` CI workflow run the new `tests/eval/suites/**` eval suites; the deterministic gate also runs on every `pnpm test`.
