---
slug: m7-sdk-permissions-cost
milestone_id: M7
date: 2026-06-22
plan: .claude/knowledge-base/plans/m7-sdk-permissions-cost-plan.md
review: .claude/knowledge-base/reviews/m7-sdk-permissions-cost-review-2026-06-22.md
status: READY_TO_MERGE
---

# M7 SDK slice — Implementation Summary

| Task | Gap | Commit | What shipped |
|---|---|---|---|
| T1.1 | M7-4 | `32180fe` | `PermissionEngine` `{defaultAction}` (default allow, backward-compat) + exported `PermissionAction`/`PermissionRule`/`PermissionEngineOptions` |
| T2.1 | M7-5 | `32180fe` | `createPermissionPlugin(engine,opts?)` wires the engine into the `pre_tool_call` veto (real caller — closes exported-but-unwired) |
| T3.1 | M7-6 | `32180fe` | `formatCostUsd` honest-null render (`—`/`$0.00`) in `@theokit/sdk-budget` |
| T4.1 | integration | `32180fe` | cross-package compose test |
| review LOW | readonly | (this commit) | `PermissionEngineOptions.defaultAction` made readonly |

## Gates
- Tests: 13 sdk + 4 sdk-budget green; existing permission-engine tests green (backward-compat).
- Typecheck + biome clean; code-quality PASS (SDK languages config empty → detectors skip; supplemented with manual reachability — all new symbols public-surface with callers).
- Changesets: `@theokit/sdk` minor + `@theokit/sdk-budget` minor. Zero new runtime deps.
- Constraint: theokit-sdk never imports principal `theokit`.

## ADRs honored
- D1 (defaultAction additive), D2 (createPermissionPlugin reuses veto seam; ACP exemplar parallel by design), D3 (formatCostUsd pure leaf in sdk-budget).
