# Reasoning (`reasoning: true`)

SE37 — `reasoning: true` turns a non-reasoning model into a reason→act→observe loop: it prepends a
chain-of-thought preamble and auto-attaches the `think`/`analyze` scratchpad tools (same model).

This example proves it against a **real LLM** on the classic "9.11 vs 9.9" trap (a non-reasoning model
often answers 9.11). With `reasoning: true` the model calls `think` and answers 9.9 correctly.

Guard: on a native reasoning model (`model.params: [{ id: "thinking" }]`), `reasoning: true` is inert
(warns) — native reasoning wins.

## Run

```bash
export OPENROUTER_API_KEY=sk-or-...   # or repo-root .env
pnpm install && pnpm run run
```
