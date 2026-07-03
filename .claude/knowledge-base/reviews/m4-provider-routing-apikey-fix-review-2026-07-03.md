# Review: m4-provider-routing-apikey-fix

**Date:** 2026-07-03
**Reviewers:** focused single-pass (architecture + wiring + tests + cross-validation + honesty) — proportionate to a ~50-LoC, real-LLM-validated bug fix (`loop-engine-convention` — don't over-tool).
**Findings:** 0 BLOCKER · 0 HIGH · 1 MEDIUM · 1 LOW — all resolved or documented
**Verdict:** READY_TO_MERGE

## Scope

M4 (Skills↔Harness). Root cause (DISCOVER): the SDK's `resolveRunProvider` inferred `primary` from the model's vendor prefix (`openai/gpt-4o-mini` → `openai`) and ignored the explicitly-passed `sk-or-` OpenRouter key, so `buildLoopInputs` failed with a swallowed `ConfigurationError` and the run ended `status: "error"` with zero events — the LLM was never called. Fix: apiKey-prefix inference outranks model-prefix inference for `primary`; the single `apiKey` is threaded into the router pool for the resolved provider.

Commit: `997ae59`. Files: `real-local-run.ts` (+`inferProviderFromApiKey`, +`mergeExplicitApiKey`, precedence + strip fix), `api-key-validator.ts` (export `LOCAL_RUNTIME_MOCK_KEY`), `resolve-run-provider.test.ts` (+7 unit tests), `docs.md`, changeset, plan, evidence.

## Findings & resolutions

### MEDIUM
- **M1 — `mergeExplicitApiKey` flagged as an unused export by knip.** It IS wired in production (`real-local-run.ts:221`, called by `buildLoopInputs`) — not dead code; knip flags the `export` keyword as redundant because production use is same-file, and the `export` exists for the direct unit test. → **Resolved as accepted pattern**: identical to the codebase's established `@internal` test-seam exports (`resolveRunProvider`, the `_reset*` family) which knip lists but the project tolerates. The pre-commit `quality` gate (which runs knip) PASSED on commit `997ae59`, confirming this is advisory here, not blocking. The function is genuinely wired (wiring triad pillar (a) satisfied).

### LOW
- **L1 — vague_acceptance_criteria soft cap on the plan (score 70).** A linguistic heuristic the rule itself flags as false-positive-prone; the plan's criteria carry concrete commands + numeric thresholds. SHIPPABLE_WITH_CAVEATS is a valid proceed state per `cycle-plan`. Documented, not blocking.

### INFO — verified OK
- Precedence: explicit `providers.routes[0]` still wins (pinned test); legacy no-key path unchanged (pinned test); anthropic-key strip unchanged (pinned test).
- Longest-prefix order (`sk-or-`/`sk-ant-` before `sk-`) correct + tested.
- Sentinel guard: `theo_test_*` and `local` never threaded as credentials (negative test).
- No stubs/mocks/TODOs in touched production files; typecheck clean; Biome clean; SLOC 357 ≤ 400; complexity within cap (helpers extracted).

## Cross-validation (plan task → test → evidence)

| Plan task | Test | Real-LLM evidence |
|---|---|---|
| T1.1 primary + effectiveModelId | 4 unit (openrouter/anthropic/route-override/no-key) | — |
| T2.1 apiKey threading | 3 unit (mergeExplicitApiKey) | — |
| T3.1 fix | all 10 GREEN | — |
| T4.1 SDK real-LLM | openrouter-stream/tools/structured | **3 passed** (was 1 failed) |
| T5.1 Skills↔Harness seam (DoD #1) | theokit smoke text test | **text_delta+done, 7.3s real round-trip** |

## Wiring triad

(a) caller: `inferProviderFromApiKey` @144, `mergeExplicitApiKey` @221 in production. (b) integration test: `openrouter-stream.test.ts` real boundary (green with live key). (c) runtime observable: run transitions `error`→`finished` with real token usage (evidence file).

## Quality gates

- Pre-commit gate (turbo build/typecheck/test + quality/knip + publint/attw + bundle) PASSED on `997ae59`.
- Touched-area regression: 33 tests GREEN (resolve-run-provider + router + models-wiring + model-option).
- SDK real-LLM OpenRouter suite: 3/3 GREEN with a live key.

## DoD status (ROADMAP M4)

- **#1** theokit route invokes `Agent.create()+send()` against real LLM (OpenRouter), evidence recorded → **MET** (text seam green end-to-end; evidence recorded).
- **#2** import path real → MET (grep-proven, DISCOVER blueprint).
- **#3** documented example → MET (fixture route + smoke test).

## Out of scope (filed)

The theokit bridge's **tool** path crashes on JSON-schema tool inputs (it routes all compiled tools through the SDK's Zod-only `defineTool`). Independent `@theokit/agents` bridge defect, not the Harness routing bug, outside M4 DoD #1 (chat seam). Filed as **usetheodev/theokit#61** with repro + root cause + fix direction.

## Handoff decision

**READY_TO_MERGE** — 0 BLOCKER/HIGH; the routing bug is fixed with TDD and validated against a real LLM at three levels (SDK unit, SDK integration, theokit bridge seam); M4 DoD met; the one out-of-scope defect is filed. Open the `develop → main` release PR (`/release`).
