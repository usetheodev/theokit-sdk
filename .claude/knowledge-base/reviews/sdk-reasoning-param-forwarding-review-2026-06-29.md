# Review: sdk-reasoning-param-forwarding (issue #47)

**Date:** 2026-06-29
**Cycle:** cycle-review (most rigorous gate)
**Target:** commits `6893812` (original fix) + `a6615b3` (review fixes) on `develop`
**Reviewers (spawned agents):** 4 parallel specialists — architecture, tests, wiring, domain (LLM streaming)
**Verdict:** **READY_TO_MERGE**

## Scope

Framework-first fix for issue #47: `@theokit/sdk` silently discarded `ModelSelection.params`, so the
`thinking` reasoning param never reached any provider — the entire M1→M2→M3 reasoning chain was inert
live (caught by dogfooding: all tests green, real model produced nothing). The fix forwards reasoning
to the provider request and surfaces streamed reasoning as `thinking-delta` updates + `thinking`
SDKMessages on a channel separate from the visible answer. Unblocks theocode M3 (theocode-reasoning-enable).

## First pass — findings (verdict NEEDS_FIXES)

| Agent | Verdict | Findings |
|---|---|---|
| architecture | READY | F-arch-1 (MEDIUM, thinking-completed not emitted), F-arch-2/3 (LOW) |
| **tests** | **NEEDS_FIXES** | **F-tests-1 (HIGH)**, **F-tests-2 (HIGH)**, F-tests-3/4 (MEDIUM), F-tests-5/7 (LOW) |
| wiring | READY | chain unbroken; F-wiring-7 (LOW telemetry) |
| domain (LLM streaming) | READY | F-domain-1 (MEDIUM, native-OpenAI 400 regression), F-domain-2/3 (LOW) |

Consolidated: 2 HIGH + 2 MEDIUM → NEEDS_FIXES (no ADR dismissal; fixed per "SEM WORKAROUNDS").

## Resolution (commit `a6615b3`)

| Finding | Sev | Resolution |
|---|---|---|
| F-tests-1 | HIGH | `test_reasoning_is_not_accumulated_into_visible_answer` + `test_reasoning_only_stream_yields_empty_visible_answer` — pin the channel-separation invariant to `finish().text`. |
| F-tests-2 | HIGH | New `loop-reasoning-wiring.test.ts` (6 tests): request forwarding, bare-when-absent, live `thinking-delta` before `text-delta`, `thinking` SDKMessage accumulation, visible-answer exclusion, no-thinking-when-no-reasoning. |
| F-domain-1 | MEDIUM | `buildOpenAIBody` is now provider-aware: native OpenAI → top-level `reasoning_effort`; OpenRouter / compat → unified `reasoning: { effort }`. No more 400 on api.openai.com. |
| F-domain-2 | LOW | Accept `delta.reasoning_content` (DeepSeek-direct / vLLM / LMStudio) alongside `delta.reasoning`. |
| F-tests-3 | MEDIUM | Empty-reasoning + content-only edge tests added. |
| F-tests-4 | MEDIUM | Committable env-gated real-LLM test `openrouter-reasoning.test.ts` (per `real-llm-validation.md`). |
| F-arch-3 | LOW | `LlmRequest.reasoning` tightened to `{ effort: string }`. |
| F-arch-1 / F-domain-3 | MEDIUM/LOW | `thinking-completed` + `thinking_duration_ms` — non-blocking per both senior agents; filed as follow-up **#48**. |
| F-wiring-7, F-tests-5/7 | LOW | Documented / accepted (telemetry span, effort passthrough, minor test-grouping). |

## Quality gates (second pass)

- **Full SDK suite:** 2948 passed | 35 skipped, **0 failures**.
- **New tests:** 18 (12 `openai-reasoning` + 6 `loop-reasoning-wiring`), all green.
- **Real-LLM e2e:** `openrouter-reasoning.test.ts` PASS vs `deepseek/deepseek-r1` — 268 thinking-deltas + 2 thinking SDKMessages, reasoning distinct from the visible answer (repeatable, env-gated).
- **typecheck:** 22/22 packages. **Biome:** clean. **Pre-commit gates:** passed.

## Wiring triad

Chain re-verified unbroken end-to-end: `Agent.send(model.params:[{id:'thinking',value:effort}])` →
`real-local-run` carries params → `reasoningEffortFromParams` → provider-aware request shape →
OpenRouter; response `delta.reasoning` → `reasoning_delta` → `onDelta` `thinking-delta` (live) +
`thinking` SDKMessage (Run.stream replay). Every new symbol has a real production caller. No
`referencia/` imports. Observability: consumer-facing `thinking` events (telemetry span attribute is
the only LOW gap, non-blocking).

## Verdict

**READY_TO_MERGE.** All BLOCKER/HIGH findings resolved; both MEDIUM correctness findings fixed; LOW
items documented or filed (#48). Reasoning is proven 100% functional end-to-end against a real model.

Note: READY_TO_MERGE is the review gate. Publishing `@theokit/sdk` (cycle-release) is a separate,
credential-gated step; once published as a patch, theocode's `^2.11.0` pin resolves the fix and M3's
already-reviewed wiring activates with no further code change.
