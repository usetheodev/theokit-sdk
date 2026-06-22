# Review — M7 SDK slice (PermissionEngine default-deny + plugin + cost formatter)

**Date:** 2026-06-22
**Slug:** m7-sdk-permissions-cost
**Milestone:** M7 (SDK slice — M7-4/5/6)
**Verdict:** READY_TO_MERGE
**Diff:** `32180fe~1..HEAD` (packages/sdk + packages/sdk-budget)
**Agents:** architecture+wiring+cross-validation; api-design+security+test-audit (2 parallel)

## Verdict rationale
Both agents SUBVERDICT: READY. 0 BLOCKER/HIGH/MEDIUM. Only LOW/INFO.

## Findings → resolution
| Sev | Finding | Resolution |
|---|---|---|
| LOW | `PermissionEngineOptions.defaultAction` not `readonly` (breaks the slice's own convention) | **Fixed** — `readonly defaultAction?` |
| LOW | integration test imports sdk-budget via relative path (test-only, mild fragility) | Accepted — test-only, green; production packages stay decoupled (no `@theokit/sdk`→`@theokit/sdk-budget` runtime dep) |
| LOW | `captureHandler`/`handlerOf` test-stub duplicated (2 files) | Accepted (Rule of 3 — hoist on 3rd) |

## Verified
- M7-4: additive + backward-compatible (`new PermissionEngine(rules)` unchanged; existing `permission-engine.test.ts` green); first-match-wins preserved.
- M7-5: `createPermissionPlugin` gives `PermissionEngine` a real caller (closes exported-but-unwired §3); fail-closed on `ask` w/o resolver; no deny-bypass (`PreToolCallDecision.block` is literal `true`); correct internal import path (no barrel self-cycle).
- M7-6: pure leaf; honest-null (`undefined`→`—`, `0`→`$0.00`); does NOT import principal `theokit`.
- Coverage 4/4; changesets present (both minor); zero new runtime deps; theokit-sdk never imports `theokit`.
- Tests: 13 (sdk) + 4 (sdk-budget) green; deterministic.

**READY_TO_MERGE.**
