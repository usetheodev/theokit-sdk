# D190 — Real-LLM examples are mandatory evidence for Ollama integration DONE

**Date:** 2026-05-21
**Status:** Accepted

## Decision

The ollama-integration plan's "DONE" gate REQUIRES two examples to
exist, typecheck, AND run against a real Ollama daemon:

- **`examples/ollama-hello/`** — minimal `Agent.create + send + stream`.
- **`examples/ollama-local-rag/`** — embedding (D183) + retrieval +
  chat in a single pipeline.

These examples are not optional "nice to haves" — they are the **only**
honest proof per `.claude/rules/real-llm-validation.md` that the
integration works as a user would experience it. Fixture mode +
typechecks do NOT count.

Each example ships with:
- `package.json` with `pnpm start` script invoking `tsx`.
- `tsconfig.json` matching the existing `examples/*` convention.
- `README.md` documenting the 3-step Ollama setup (install/pull/run).
- Source under `src/`.

## Rationale

- **Past regression.** Memory plan (memory-providers-adapters) was
  declared DONE with fixture-only validation, then EC-violations
  surfaced months later. The "real LLM validates" rule was written in
  response (`feedback_real_llm_validation` memory).
- **Examples ARE the dogfood for an SDK.** Unlike a webapp where
  Playwright probes the rendered UI, an SDK's "look and feel" lives in
  the consumer code. The example IS the contract evidence.
- **Reproducible by anyone.** Future developers debugging Ollama
  integration regressions run `pnpm start` and see the same output we
  saw in 2026-05. Real-LLM tests can flake; examples are concrete.

Alternatives rejected:

- **Integration tests only, no examples.** Tests assert shape but
  don't show the ergonomics the consumer touches. New users don't
  read `tests/integration/` — they read `examples/`.
- **One omnibus example.** Mixing chat + embedding + RAG in one
  ~200-LOC file hides the "smallest possible Ollama call" surface that
  `ollama-hello` makes obvious.

## Consequences

- **Enables:** Documented, runnable evidence that survives refactors.
  Any future change to provider wiring that breaks Ollama is caught by
  re-running the examples.
- **Constrains:** Adding a new local provider (e.g. vLLM) implies
  shipping at least one example proving end-to-end works. ADR D188
  (LM Studio) and D189 (llama.cpp) are formally "done" only when their
  examples land — current scope ships the profiles only; their
  examples are tracked as follow-up.
- **Carries forward:** This pattern becomes the default for any
  high-stakes integration plan in the SDK: examples are gates, not
  garnish.
