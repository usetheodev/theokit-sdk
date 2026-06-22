# Review — m4-todo-plan-nodes (M4-5)

**Date:** 2026-06-21
**Verdict:** READY_TO_MERGE
**Commits:** 0d07f29 (fix+adapter) + 9d02b80 (review-hardening)
**Plan:** knowledge-base/plans/m4-todo-plan-nodes-plan.md (plan-confidence SHIPPABLE 98.8)
**Code-quality:** PASS

## Method

Two independent FAANG-level reviewers (read-only), in parallel — bug-fix correctness/adapter + tests/wiring/edge-cases. BOTH returned **READY_TO_MERGE** (0 BLOCKER, 0 HIGH). Reviewer A **empirically confirmed the regression** fails on the pre-fix code (`git`-swapped `0d07f29~1` → 3 M4-5 tests fail).

## Findings adjudicated

| # | Sev | Source | Finding | Resolution |
|---|---|---|---|---|
| 1 | MEDIUM | B | `clear_completed`/`remove`/`in_progress` items emission untested — a future split off the shared `listResult` helper could silently regress those paths. | **HARDENED** (9d02b80): added a test asserting `remove` and `clear_completed` results carry structured `items` reflecting post-op state. |
| 2 | MEDIUM | B | JSON-special-char title round-trip untested (titles flow through `JSON.stringify`→`parse`). | **HARDENED** (9d02b80): added a test with a title containing `"`, `\`, newline → `result.items[0].title` equals the original. |
| 3 | LOW | B | `complete` items test narrower than peers; adapter extra-field drop only implicitly covered. | Accepted — the exact-projection EC-1 test covers the adapter; the new coverage above subsumes the concern. |
| 4 | INFO | A | `items: [...items]` is a shallow copy but the result is JSON-serialized → consumer gets a deep-detached snapshot (correct at the tool contract). `items` adds minor timestamp noise alongside `items_summary` (D1: summary is LLM-facing, items programmatic). No realistic back-compat break (additive field). | No action. |
| 5 | INFO | B | `todoItemsToPlanNodes` has no in-repo production caller (the consumer is theocode, separate repo) — barrel wiring test is the correct proxy (no-stubs rule's plug-in-interface carve-out). | No action. |

## Verdict rationale

Both reviewers confirmed: the bug fix is correct (all 5 list-bearing paths route through the centralized `listResult`, `items_summary`/`getItems()`/error shapes unchanged), the regression genuinely fails RED on pre-fix code (empirically verified), the adapter projects exactly `{id,label,status}` (no timestamp leak, order preserved), DIP clean, barrel wiring real. The two MEDIUMs were test-coverage gaps (the code was already correct via the shared helper + JSON round-tripping) — both now hardened with tests.

## Validation (post-hardening)

- typecheck: clean (0 errors)
- todolist + todo-plan-nodes tests: 23 passed
- full sdk-tools suite: 291+ passed (no regression — bug fix is additive; +11 M4-5 tests)
- biome clean; code-quality PASS; Coverage Matrix 7/7.

**Verdict:** READY_TO_MERGE
