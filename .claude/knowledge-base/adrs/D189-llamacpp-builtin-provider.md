# D189 — llama.cpp server ships as a builtin sibling profile

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`@usetheo/sdk` registers llama.cpp server (`name: "llamacpp"`,
aliases `["llama-cpp", "llama.cpp"]`) as a seventh builtin provider
profile alongside Ollama and LM Studio. Shape mirrors `OLLAMA`:

- `apiMode: "chat_completions"` — reuses `OpenAIClient`.
- `authType: "none"` — no API key required.
- `baseUrl: "http://localhost:8080"` (llama.cpp `./server` default port).
- Override via `LLAMACPP_HOST` env var.

Router's `resolveBaseUrlEnvOverride` is extended to honor
`LLAMACPP_HOST`.

## Rationale

- **Power-user runtime.** Developers running quantized GGUF models
  directly via `llama.cpp/server` skip Ollama's runtime overhead and
  control model load parameters explicitly via CLI flags.
- **D182 primitive reuses for free.** `authType: "none"` + sentinel +
  baseUrl override solve every wiring concern with zero new
  abstractions.
- **Aliases match upstream casing.** llama.cpp uses `llama-cpp`,
  `llama.cpp`, `llamacpp` interchangeably in docs — handling all three
  removes friction.

Alternatives rejected:

- **Ship as a separate plugin.** Same rationale as D182, D188 —
  friction kills adoption for the OSS-funnel persona.
- **Add model name validation.** llama.cpp's `./server` is loaded with
  a SINGLE GGUF model at startup. The `model` field in
  `/v1/chat/completions` requests is cosmetic — any string works, the
  response comes from the loaded model. Edge-case review EC-O flagged
  this; documented in the profile source.

## Consequences

- **Enables:** `Agent.create({ model: "llamacpp/anything" })` works
  zero-config when `./server` is running on the default port.
- **Constrains:** Same single-model-per-server semantics as LM Studio.
  Documented in profile comments and the upstream `llama.cpp/server`
  README.
- **Carries forward:** Future support for additional OpenAI-compatible
  local runtimes (vLLM, mlx-server, etc.) follows the same shape —
  declare `authType: "none"`, add a `<NAME>_HOST` env override, done.
