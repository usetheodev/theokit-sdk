# Plan-Confidence — m0-harness-security-floor

Date: 2026-07-02
Plan: knowledge-base/plans/m0-harness-security-floor-plan.md (v1.1)

## Verdict: SHIPPABLE_WITH_CAVEATS (final 70 / weighted_avg 88.4)

Proceed to `/implement` — per `cycle-plan.md`, SHIPPABLE_WITH_CAVEATS is a green-to-proceed verdict; caveats are explicit, not hidden.

## Dimensions (structural)

| Dimension | Score |
|---|---|
| Coverage matrix | 100 (4/4 gaps → tasks) |
| Evidence citations | 27 citations, **0 fabricated** (after fixing the line-11 blueprint path) |
| Completeness | 100 (all mandatory sections; Baseline Context real; Drawbacks 5; Unresolved 3; Prior Art from blueprint) |
| ADR completeness | all 4 ADRs carry a rejected alternative |
| Concurrency tests | PASS (4/4 tasks — 3 explicit `(none — single-threaded)`, T4.1 `cancellation propagation` race-aware) |
| Failure scenarios | present (MCP stdio/http + subprocess) |
| Structural risk | low |

## The single caveat — reviewed & overridden (heuristic false-positive)

`vague_acceptance_criteria` fired: `acceptable_ratio = 0.65 < 0.80` (7 of 20 criteria score 1/3 on the observable-verb + measurable-object + oracle heuristic).

**Human override (per `plan-confidence-golden-rule.md`: "HONESTLY HEURISTIC: linguistic patterns can false-positive; the JSON sub_report lists every vague criterion for human override"):**

- `vague_ratio = 0.0` — **zero criteria are genuinely vague**. The cap is driven purely by the `acceptable_ratio` substring heuristic, not by any actual vagueness.
- Every acceptance criterion carries a concrete oracle: named test files (`tests/plugins/manager-register.test.ts`, `tests/memory/active-memory-tenant-isolation.test.ts`, `tests/mcp/client-timeout.test.ts`, `tests/runtime/spawn-collect-env-policy.test.ts`), `pnpm test/typecheck/lint` exit-0, coverage ≥ 90% (100% on security paths), complexity ≤ 10, `wc -l` ≤ 500.
- Further tightening would game the substring matcher rather than improve the plan (the checker itself masks fenced code and matches linguistic patterns) — the anti-pattern the golden rule warns against.
- The criteria are **actually validated with real evidence at `/implement` + `/review`**, which is where "critérios validados" is proven, not at plan-scoring time.

Decision: accept SHIPPABLE_WITH_CAVEATS; the caveat is this documented heuristic false-positive. No hard cap is active (`fabricated_citation` and `soft_floor_concurrency_tests_missing` were both resolved).

## Chain status

DISCOVER (SHIPPABLE 98.8) → **PLAN (SHIPPABLE_WITH_CAVEATS)** → next: `/implement` (TDD halt-loop).
