# D184 — `Theokit.models.list({ provider })` reads locally for `authType: "none"`

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`Theokit.models.list({ provider: "ollama" | "lmstudio" | "llamacpp" })`
fetches from the targeted provider's `/v1/models` endpoint over HTTP
instead of hitting the TheoCloud catalog. The branch fires when
`options.provider !== undefined` AND the resolved profile carries
`authType: "none"`. All other call shapes (`Theokit.models.list()`,
`Theokit.models.list({ apiKey })`) keep the original cloud-only path
unchanged — full backward compat.

`TheokitRequestOptions` gains an optional `provider?: string` field
(non-breaking) and a dedicated helper `maybeListLocalModels(providerName)`
encapsulates the local branch in `internal/catalog/local-models.ts`.

The local helper:
- Honors `OLLAMA_HOST` (and future `LMSTUDIO_HOST` / `LLAMACPP_HOST`)
  for baseUrl override.
- Reuses the Ollama HTTP error mappers (ECONNREFUSED → `ollama_unreachable`)
  so the failure mode mirrors the chat-completion path.
- Returns `[]` on malformed bodies (defensive — non-standard local
  runtimes shouldn't crash callers).

## Rationale

- **One method, two surfaces.** Forcing developers to learn separate
  `Theokit.localModels.list()` API would balloon the surface area for
  marginal benefit. The cloud/local routing is purely an implementation
  detail.
- **Generic over Ollama-specific.** Any future profile declaring
  `authType: "none"` exposes `/v1/models` for free — LM Studio (single
  loaded model) and llama.cpp server (single GGUF) both fit.
- **Mirrors OpenClaw's provider-discovery flow.** Their
  `ollamaProviderDiscovery.catalog.run` reads the same endpoint shape.

Alternatives rejected:

- **Always probe both sources and merge.** Adds latency to every cloud
  call. Cloud catalog is the source of truth for what's available *to
  buy*; local catalog is the source of truth for what's installed *on
  this machine*. They're not interchangeable.
- **Add a `local: true` boolean option.** Less precise than
  `provider: "ollama"` — the latter also signals which baseUrl to read.

## Consequences

- **Enables:** Developers can build "pick a model from this dropdown"
  UIs against local Ollama with zero cloud round-trips.
- **Constrains:** The local `/v1/models` response shape is locked to
  the OpenAI-compatible `{ data: [{id, ...}] }` envelope. Providers
  that diverge (e.g. llama.cpp's single-model semantics) still work
  because the helper just maps the `id` field — the server can return
  whatever model name is loaded.
- **Carries forward:** Sibling profiles in D188 + D189 (LM Studio,
  llama.cpp) inherit this behavior for free. Future addition of
  `LMSTUDIO_HOST` / `LLAMACPP_HOST` env overrides should be added to
  `resolveLocalProviderBaseUrl`.
