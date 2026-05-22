# D205 — `llmJudge` scorer requires its own apiKey, separate from the eval agent

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`Scorers.llmJudge({ model, apiKey, criteria, rubric? })` REQUIRES an `apiKey`
field (TypeScript-enforced — missing field is a compile error). The key MAY
target the same provider as the eval agent, but the configuration is
explicit.

Default judge model: `openai/gpt-4o-mini` (mirrors D119 — same default judge
that `Agent.runUntil` uses).

## Rationale

- **Evaluator bias.** Using the same LLM that produced the output to also
  judge it is a known eval anti-pattern. Forcing a separate apiKey field
  makes the bias visible at config time.
- **Provider separation by design.** Even when consumers target the same
  endpoint, they have to type the key twice — that friction is the feature.

Alternatives rejected:

- **Reuse eval agent's apiKey** — silent self-judgment; consumer is unaware.
- **`judge: Agent`** (pass an agent instance) — works but allows sloppy reuse.

## Consequences

- Enables: deliberate provider separation; auditable judge configuration.
- Constrains: callers MUST set `apiKey` even when same provider; TypeScript
  catches misconfig at compile time, Zod at runtime.
