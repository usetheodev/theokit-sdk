# D188 — LM Studio ships as a builtin sibling profile

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`@theokit/sdk` registers LM Studio (`name: "lmstudio"`,
aliases `["lm-studio", "lm_studio"]`) as a sixth builtin provider
profile alongside Ollama. The shape mirrors `OLLAMA`:

- `apiMode: "chat_completions"` — reuses `OpenAIClient`.
- `authType: "none"` — no API key required.
- `baseUrl: "http://localhost:1234"` (LM Studio default port).
- Override via `LMSTUDIO_HOST` env var.

Router's `resolveBaseUrlEnvOverride` is extended to honor
`LMSTUDIO_HOST` alongside the existing `OPENAI_API_BASE_URL` /
`OPENROUTER_API_BASE_URL` / `OLLAMA_HOST`.

## Rationale

- **Second-most-adopted local LLM runtime** after Ollama. Same OpenAI-
  compatible HTTP surface; the only differences are the port (1234) and
  the UX (LM Studio loads one model at a time via the desktop UI).
- **D182 primitive reuses for free.** `authType: "none"` + sentinel +
  baseUrl override solve every wiring concern with zero new
  abstractions.
- **Aliases match the install command UX.** LM Studio docs say "use
  LM Studio's local server" — handling `lm-studio` and `lm_studio`
  spellings avoids friction.

Alternatives rejected:

- **Ship as a separate `@theokit/provider-lmstudio` plugin.** Extra
  install step for the most common local-LLM-after-Ollama story.
  Friction kills adoption (same rationale as D182).
- **Special-case the discovery flow.** LM Studio's `/v1/models`
  endpoint returns the single currently-loaded model. Same shape as
  Ollama's `/v1/models` — `listLocalModelsViaOpenAiCompat` works as-is.

## Consequences

- **Enables:** `Agent.create({ model: "lmstudio/some-model" })`
  works zero-config when LM Studio is running on the default port.
- **Constrains:** The `model` field in requests is informational only —
  LM Studio serves whatever model the user loaded via the desktop UI.
  Documented in the profile comment.
- **Carries forward:** Sibling D189 (llama.cpp) follows the same shape
  with a different default port (8080).
