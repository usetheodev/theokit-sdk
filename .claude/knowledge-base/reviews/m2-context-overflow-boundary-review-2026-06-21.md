# Review: m2-context-overflow-boundary

**Date:** 2026-06-21
**Reviewers (spawned agents):** 2 — behavior+test-auditor, cross-validation+architecture (general-purpose, opus-class)
**Findings:** 0 BLOCKER, 0 HIGH, 3 LOW (1 fixed, 2 advisory), INFO
**Verdict:** READY_TO_MERGE

> Per-agent finding files: `.claude/agents/review-m2-context-overflow-boundary-2026-06-21/findings/*.md`.

## Scope reviewed

Commits `2b386c5` (T1.1 fix + tests) + `1abda16` (T2.1 changeset/CHANGELOG) + `c8dba81` (review hardening) + code-quality audit, on `develop` vs `main`. Files: `packages/sdk/src/internal/agent-loop/loop-llm-stream.ts`, `tests/internal/agent-loop/loop-error-code.test.ts` (NEW), root + package `CHANGELOG.md`, `.changeset/m2-context-overflow-boundary.md`.

## BLOCKER / HIGH findings

_None._ Both reviewers independently reached 0 BLOCKER, 0 HIGH.

- **The fix is correct:** `registerLoopError` now derives the code as `metaCode ?? rawCode` — the canonical `cause.metadata?.code` (`context_too_long`) wins over the provider-prefixed top-level `.code` (`anthropic_context_too_long`). Top-level fallback intact (no regression); non-string `metadata.code` falls back; set-once + message derivation unchanged; non-throwing for any cause shape (optional chaining).
- **The end-to-end boundary claim is VERIFIED** (the crux): the cross-validation agent traced all 4 hops — `registerLoopError` → `output.error` (loop.ts:129) → `errorDetail.code` (real-local-run.ts:385-391, verbatim copy) → `RunResult.error` (buildResult). No hop drops or re-wraps `.code`. The canonical code genuinely reaches `RunResult.error.code`.
- **Provider-agnostic + contract-tested:** the fix keys off the structural `metadata.code` convention, so every mapper using `buildErrorMetadata` benefits. Tests feed the REAL `mapAnthropicError` (400, message-text body) and `mapOpenAICompatibleError` (400, structured `error.code`) — non-vacuous (the pre-fix `.code`-only code would fail both).

## LOW findings

- **[FIXED] no non-object-cause test** (behavior): added `test_non_object_cause_does_not_throw` (`null`/`"boom"`) locking the non-throwing edge.
- **[advisory] changeset patch-vs-minor**: it changes a surfaced VALUE (`RunResult.error.code` now canonical, not prefixed) with no API shape change; `patch` is defensible (the prefixed boundary value was the bug). No action.
- **[advisory] test location**: `tests/internal/agent-loop/` (mirror-tree) is correct for a unit/contract test of the `@internal` `registerLoopError`; `tests/contract/error-codes.test.ts` is type-level-only (orthogonal). No action.

## INFO confirmations

ADRs D1 (prefer metadata.code) / D2 (set-once + message unchanged) / D3 (the `{type:"error"}` SDKMessage variant explicitly DEFERRED — the union is unchanged, deferral documented in the plan, Coverage Matrix, changeset, and in-code) all honored; Coverage Matrix 7/8 resolved + 1 honest deferral; surgical one-function change, no public type change (`RunErrorDetail.code` pre-existed), `docs.md` correctly untouched; changeset/CHANGELOG accurate with NO stream-event overclaim; scope = exactly the planned files (no creep); 8 tests cover edge cases (non-string code, neither present, non-object cause, set-once) not just happy path.

## Quality gate re-validation

- sdk suite: **2781 passed, 35 skipped** (no regression; the dedicated `error-packaging.test.ts` boundary gate stays green). typecheck exit 0; Biome clean (892 files); knip exit 0; code-quality PASS.

## Verdict rationale

0 BLOCKER, 0 HIGH from two independent reviewers; the end-to-end boundary fix is verified hop-by-hop, provider-agnostic, contract-tested, and regression-free. The one actionable LOW (non-object-cause test) is fixed; the rest advisory. Per `cycle-review.md § Verdicts`: **READY_TO_MERGE.** This is the last M2 item — M2 (Tema B) is now complete.

## Recommended next step

`/release` (a `@theokit/sdk` minor — bundling M2-2/M2-3/M2-4). The roadmap's next waves are M4 (skills/memória/projeto) and M6 (eval harness).
