# example: eval suite

Runs `Eval.create / .run` against a real LLM and prints aggregate +
per-row results.

## Run (Ollama, no API keys)

```bash
ollama serve &
ollama pull llama3.2:3b
pnpm install
pnpm run run
```

## Run (OpenRouter cloud)

```bash
export OPENROUTER_API_KEY=sk-or-...
pnpm run run
```

## What it shows

- `Eval.create({...}).run()` returns a populated `EvalRun` shape (D202, D209)
- `Scorers.containsExpected()` + `Scorers.regex()` applied to each row
- Aggregate includes `meanScore`, `passRatio`, `errorRows`, `tokensInTotal`,
  `durationMsP50`, `durationMsP95` (D211)
- v1 scale: keep datasets ≤ 10k rows (EC-11 — v1 materializes the dataset
  in memory; partition manually for larger evals or wait for streaming v2)

## LLM-as-judge

For subjective scoring, swap the second scorer:

```ts
Scorers.llmJudge({
  model: { id: "openai/gpt-4o-mini" },
  apiKey: process.env.OPENROUTER_JUDGE_KEY ?? process.env.OPENROUTER_API_KEY ?? "",
  criteria: "The answer is concise and accurate.",
  rubric: "continuous",
}),
```

**Cost note (EC-12):** `llmJudge` doubles the per-row LLM cost. For
1000 rows × `gpt-4o-mini`, expect ~$1.50 (eval) + ~$1.50 (judge) = $3.00.
The `aggregate.tokensInTotal` only reflects the EVAL agent's tokens, not
the judge's — forecast accordingly.
