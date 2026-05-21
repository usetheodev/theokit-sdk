# D186 — Provider name inferred from `model.id` prefix when not declared

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`buildLoopInputs` in `internal/runtime/real-local-run.ts` resolves the
primary provider with the following priority (first wins):

1. **Explicit caller config** — `agentOptions.providers.routes[0].provider`.
2. **Prefix inference** — if `model.id` matches `^<provider>/(.+)$` AND
   `<provider>` resolves via `getProviderProfile`, use it. The model
   string passed to the LLM body is the STRIPPED form (everything after
   the first `/`).
3. **Env-var heuristics** — `detectPrimaryProvider()` (existing path,
   checks ANTHROPIC/OPENAI/OPENROUTER env keys, defaults to "openai").

`parseModelId` lives in `internal/llm/model-identifier.ts` as a pure
sync helper. It preserves embedded slashes (e.g.
`openrouter/meta-llama/llama-3.2` → provider="openrouter",
name="meta-llama/llama-3.2") and tag suffixes (e.g.
`ollama/llama3.2:3b` → name="llama3.2:3b"). Aliases mirror Hermes's
ALIASES table — `llama-cpp`, `llama.cpp`, `lm-studio`, `lm_studio`
canonicalize to the registered profile names.

`registerBuiltins()` is invoked before the `getProviderProfile` lookup
to avoid the registry-empty-on-first-call race condition.

## Rationale

- **Zero-config UX.** `Agent.create({ model: "ollama/llama3.2:3b" })`
  is the form developers actually want. Forcing
  `providers: { routes: [{ provider: "ollama" }] }` AND `model: { id: "llama3.2:3b" }`
  duplicates information.
- **Pattern parity with industry.** OpenRouter, LiteLLM, Vercel AI SDK,
  Mastra all accept `provider/model` shaped strings.
- **Explicit still wins.** Callers who need to mix providers
  (e.g. fallback chain with model rewrite) keep full control via
  `providers.routes`.
- **Aligned with Hermes ALIASES.** Their `normalize_provider` table
  treats `llama-cpp` / `llama.cpp` as `llamacpp` aliases — the same
  canonicalization happens here at parse time.

Alternatives rejected:

- **Strict mode — require explicit provider always.** Doubles the
  example boilerplate for the most common case (local Ollama).
- **Infer provider from env vars only.** What we had pre-D186. Couldn't
  distinguish `ollama/llama3.2` from `anthropic/claude-3-5-sonnet` when
  user had neither env set (the new authType: "none" Ollama).

## Consequences

- **Enables:** All Ollama examples now work with bare
  `model: "ollama/<name>"` — no router config required.
- **Constrains:** Model names containing `/` at position 0 (e.g.
  `"/path/to/model"`) parse as no-prefix. Acceptable — that's not a
  valid provider identifier anyway.
- **Carries forward:** LM Studio and llama.cpp inherit this behavior
  via their registered profiles (D188, D189). Future
  third-party-plugin providers register their profile name and
  immediately get prefix inference for free.
