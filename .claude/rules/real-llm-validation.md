# Rule: Validation MUST Use Real LLM (Inviolable)

> **Status:** Inviolable. Established 2026-05-16. Applies to all dogfood, examples, and plan acceptance criteria.

## What this rule requires

Any claim that an example, plan, or feature is **"validated"**, **"dogfood-tested"**, or **"works end-to-end"** REQUIRES execution against a real LLM provider (Anthropic, OpenAI, OpenRouter, Mistral, Voyage, DeepInfra, etc).

The following do NOT count as validation:

- **Fixture mode** (`theo_test_*` API key) — this is a product feature for SDK consumers' tests, not validation evidence. The SDK's `fixture-responder` emits pre-baked responses; no LLM is called.
- **Typecheck alone** (`tsc --noEmit`) — proves the code compiles, not that it runs.
- **Unit tests with mocked fetch** — they prove protocol handling, not end-to-end behavior.

## When this rule applies

Every example whose code path includes ANY of these operations:

- `agent.send(...)` (the LLM is called)
- `agent.prompt(...)`
- `Memory.runDreamingSweep({ embedding: { provider } })` (real embedding API is called)
- `Theokit.models.list()` against a real PaaS endpoint
- Any flow that exercises Active Memory recall

MUST be executed with a real provider API key set in `.env` (e.g. `OPENROUTER_API_KEY`) before declaring "validated".

## Examples that don't need real LLM

Config-only or guard-only examples — the surface they demonstrate never reaches an LLM call:

- Examples that only print `agent.cloudPayload` and dispose (e.g., `cloud-with-skills`, `cloud-with-subagents`)
- Examples that only catch typed errors (`cloud-prerelease-guard`, parts of `error-handling-full`)
- Examples that only test `dispose()` semantics (`cloud-await-using`)
- Examples that only list plugins/skills/providers without sending a message

For these, fixture mode IS the appropriate test. Report them honestly: **"fixture mode only — no LLM required for the surface demonstrated"**.

## How to apply this rule

### Before declaring "dogfood passes"

1. Identify every example that calls `agent.send()`, embedding APIs, or Active Memory.
2. Confirm each one was executed with a real provider key set.
3. Capture the actual output (model name, response text, status) in the report.
4. Distinguish in writing: **"real LLM validated"** vs **"fixture mode only"**.

### When the user authorized only one provider env

If only `OPENROUTER_API_KEY` is available, examples can be validated using it (the SDK auto-detects). Document which provider was used for the validation. Examples requiring a SPECIFIC provider (e.g. Voyage adapter) that isn't available must be marked "typecheck only — pending real-key validation" — NEVER as "validated".

### When a real-LLM example fails

Treat it like any test failure: investigate the root cause, fix it, re-run with the real key. Do not "downgrade" the validation to fixture mode to make it pass.

## Anti-patterns this rule forbids

1. **"All 8 fixture examples pass" framed as dogfood completion** — fixture passing is not dogfood.
2. **"Typecheck clean" framed as runtime validation** — typecheck is necessary but insufficient.
3. **"`status=finished` came back, so it works"** — in fixture mode, every send returns `status=finished`. The status alone is not evidence of LLM execution.
4. **Silent omission of which examples actually hit real LLM** — every dogfood report must enumerate the modes per-example.

## Why this rule exists

A previous iteration declared "10 new examples shipped, 8/8 fixture examples pass, 2/2 typecheck clean" as if it were complete dogfood. Five of those examples (`local-force-expire`, `send-mcp-override`, `remember-prefix`, `active-memory-query-modes`, `embedding-providers`) materially exercise LLM-driven paths and were never tested against a real LLM. Five others (`mcp-http`, `plugins-walkthrough`, `cloud-prerelease-guard`, `error-handling-full`, `cloud-await-using`) are config-only and fixture mode WAS the right test.

The rule eliminates the ambiguity: tests against real LLM are required when the example actually drives LLM behavior; fixture mode is documented honestly when the surface doesn't.

## Relation to other rules

- **`.claude/rules/no-stubs-no-mocks-no-wired.md`** — that rule governs the *code* (no stubs in production). This rule governs *evidence* (no fixture-as-proof). Both are inviolable.
- **`feedback-real-llm-validation` memory** — the persistent version of this rule for future sessions.
