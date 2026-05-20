# D119 — Judge default model is `openai/gpt-4o-mini` via `OPENROUTER_API_KEY`

**Date:** 2026-05-19
**Status:** Accepted

## Decision

`judgeCallImpl` defaults:
- `model: { id: "openai/gpt-4o-mini" }`
- `apiKey: process.env.OPENROUTER_API_KEY`
- `tools: []`

Caller override via `JudgeOptions.judgeModel` + `JudgeOptions.apiKey`.

No multi-provider env detection (no fallback to `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`). Single source of truth = `OPENROUTER_API_KEY`. Callers
in Anthropic-only or direct-OpenAI environments pass the key explicitly.

## Rationale

EC-A edge-case review: the original plan tried to detect Anthropic or
OpenAI keys as fallback. The user opted for a simpler design — judge
runs through OpenRouter, which is the development environment standard
(`.env` of telegram-pro, examples, dogfood scripts already configures
`OPENROUTER_API_KEY`). Multi-provider auto-detect introduces silent
behavior changes when env vars are added/removed.

`openai/gpt-4o-mini` was chosen over Haiku for: (a) 1/30 of GPT-4 cost,
(b) 5× faster turnaround than Sonnet, (c) universally available via
OpenRouter without a separate Anthropic billing account.

## Consequences

- **Enables:** judge works out-of-box for `OPENROUTER_API_KEY` users
  (the common dev environment).
- **Constrains:** environments without OpenRouter access (enterprise,
  privacy-isolated) must pass `judgeApiKey` explicitly. Documented in
  JSDoc.
