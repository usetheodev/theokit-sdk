# D182 — Ollama ships as a builtin provider with `authType: "none"`

**Date:** 2026-05-21
**Status:** Accepted

## Decision

Ollama is registered as a builtin `ProviderProfile` alongside `anthropic`,
`openai`, `openrouter`, and `gemini`. The profile declares:

- `name: "ollama"`
- `apiMode: "chat_completions"` (reuses the existing `OpenAIClient`
  transport — Ollama exposes an OpenAI-compatible endpoint at
  `http://localhost:11434/v1/chat/completions`)
- `authType: "none"` (new value added to the `AuthType` union)
- `baseUrl: "http://localhost:11434"`
- `envVars: ["OLLAMA_API_KEY"]` (optional — used only when Ollama Cloud or
  a reverse-proxy with auth is in play)

The router treats `authType: "none"` profiles as resolvable without any
env var: when neither a credential-pool key nor `OLLAMA_API_KEY` is set,
a sentinel placeholder (`profile.name`) is used as the bearer token.
Local Ollama installs ignore the `Authorization` header, so the
placeholder is harmless. `OLLAMA_HOST` (when present) overrides the
default localhost baseUrl, mirroring the existing
`OPENAI_API_BASE_URL` / `OPENROUTER_API_BASE_URL` overrides.

## Rationale

The 2026-05-21 Adoption Roadmap row 12 ("Local provider profiles
first-class") starts with Ollama because:

1. **Zero-config UX matters most for non-technical users.** Today an
   OpenAI-compat workaround requires the user to invent a fake
   `OPENAI_API_KEY` and remember to set `OPENAI_API_BASE_URL`. Builtin
   Ollama means `Agent.create({ model: "ollama/llama3.2" })` just works
   after `ollama serve`.
2. **Reuses the existing transport — no new dialect.** Ollama implements
   the OpenAI `/v1/chat/completions` shape verbatim, so the `OpenAIClient`
   already handles streaming, tool calls, and finish reasons.
3. **`authType: "none"` is a general primitive, not an Ollama special-case.**
   LM Studio, llama.cpp server, vLLM, and other local OpenAI-compat
   servers all need the same "no auth" affordance. Future profiles
   (D183+) inherit it for free.
4. **`OLLAMA_HOST` matches Ollama's own convention.** The Ollama CLI and
   official client libraries already read this env var; mirroring it is
   less surprising than introducing `OLLAMA_API_BASE_URL`.

Alternatives rejected:

- **Standalone package `@theokit/provider-ollama`** — extra install for
  the most common local-LLM runtime. Friction kills adoption.
- **Special-case `profile.name === "ollama"` without `authType: "none"`** —
  works but locks the affordance to a single profile; LM Studio and
  llama.cpp would each need their own special-case branch.

## Consequences

- **Enables:** zero-config local development with Ollama; same pattern
  is reusable for other no-auth providers (LM Studio, llama.cpp, vLLM,
  Together's free tier, etc.) by declaring `authType: "none"`.
- **Constrains:** the placeholder credential is sent in the
  `Authorization` header. Local runtimes ignore it; any future
  provider with `authType: "none"` MUST tolerate a non-empty bearer
  token without rejecting the request. Documented in the profile
  comment in `builtin/ollama.ts`.
- **Carries forward:** Adoption Roadmap row 12 partially closed — LM
  Studio and llama.cpp still need dedicated profiles for their
  idiosyncrasies (model listing endpoints, tool-calling caveats),
  tracked under future ADRs D183-D185.
