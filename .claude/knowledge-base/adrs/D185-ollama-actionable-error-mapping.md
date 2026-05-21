# D185 — Typed Ollama transport + HTTP error mapping with actionable messages

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`OpenAIClient` accepts a new optional `providerName?: string` field.
When set to `"ollama"`, two extra error mappers run BEFORE the generic
`mapOpenAICompatibleError`:

1. **`mapOllamaTransportError`** — fetch-level failures
   (`TypeError("fetch failed")` with `cause.code === "ECONNREFUSED" |
   "ENOTFOUND"`) become `ConfigurationError(code: "ollama_unreachable")`
   with the message `Run \`ollama serve\` to start the local runtime…`.
2. **`mapOllamaHttpError`** — HTTP responses get two specific patterns:
   - `HTTP 404 + body.error matches "not found"+"pull"` → `ConfigurationError(code: "ollama_model_not_pulled")` with the message `Run \`ollama pull <model>\``.
   - `HTTP 503 + body.error matches "model is loading"` → `NetworkError(code: "ollama_model_loading", isRetryable: true)` with the message `Ollama model is loading. Retry in a few seconds…`.

Both mappers return `undefined` on no-match → the generic OpenAI-compat
mapper takes over. Non-Ollama providers are never affected (the
`providerId !== "ollama"` short-circuit returns `undefined` immediately).

`buildErrorMetadata` from `mappers/shared.ts` is reused — no new
duplication.

## Rationale

- **Non-technical user persona** (CLAUDE.md): a raw `ECONNREFUSED` is
  unhelpful. The mapper turns every recoverable failure into a one-line
  command the user can run.
- **Provider-prefixed `code` fits the existing pattern.** OpenAI mapper
  emits `code: "openai_auth_failed"`; Anthropic mapper emits
  `code: "anthropic_rate_limit"`. `code: "ollama_unreachable"` slots in
  alongside.
- **Generic `metadata.code` stays generic** (`"network"`, `"model_unavailable"`,
  `"server_error"`) so existing consumers branching on the
  ErrorCode enum keep working. No public type changes required.
- **Lazy / on-demand check beats eager.** Eager probe at `Agent.create()`
  adds 30+ms to every happy-path call. On-demand means the first chat
  call surfaces the error if Ollama isn't running, with zero overhead
  otherwise.

Alternatives rejected:

- **Add `"ollama_unreachable"` to the public `ErrorCode` union.** Was
  the original D182 plan. Pollutes the generic enum with
  provider-specific values; existing OpenAI/Anthropic mappers don't do
  this. We keep the union generic; provider-prefixed codes live on
  `error.code` (free-form string).
- **Eager probe at `Agent.create()`.** Slower happy path. Doesn't
  detect transient failures (model unload + reload). On-demand wins.

## Consequences

- **Enables:** Actionable errors that non-technical users can resolve
  without grepping docs or Stack Overflow.
- **Constrains:** Mapping logic is keyed by `providerId === "ollama"`.
  If we add an Ollama-shaped runtime under a different name (e.g.
  `localai`), it needs the same dispatch hook. Mitigated by the helper
  being a pure function — adding more provider names is a one-line
  change.
- **Carries forward:** Same mapper is reused by
  `internal/catalog/local-models.ts` (T2.1 → D184) for the
  `/v1/models` discovery path. Future LM Studio / llama.cpp specific
  errors get a parallel mapper following the same shape.
