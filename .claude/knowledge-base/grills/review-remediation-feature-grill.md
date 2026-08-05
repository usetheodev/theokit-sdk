---
slug: review-remediation
generated_by: roadmap-feature
date: 2026-07-23
status: completed
milestones_added: [SE47, SE48, SE49, SE50, SE51, SE52]
---

# Feature grill — review remediation (SE47–SE52)

## Q1 — What is this and why now?

Absorb the findings of the 2026-07-23 `/review-cycle` multi-pillar run into the roadmap. The run
surfaced the project's only BLOCKER (OAuth sign-in broken by a cookie-name mismatch) plus 29 HIGH and
261 MEDIUM agent-emitted findings across 10 pillars. Why now: the evidence is fresh and line-anchored;
the BLOCKER breaks a live auth path.

## Q2 — Dependencies

All six depend on **SE46** ([x], the most recent completed milestone). SE52 additionally depends on
**SE48** so runtime-correctness fixes land before SE52 restructures the same `internal/runtime` files.
`cycle-roadmap` selects the lowest eligible ID, so SE47 (the BLOCKER) runs first.

## Q3 — Definition of done

Per-milestone DoD written into each ROADMAP block. Common first item in all six: a **validation gate** —
a RED test must reproduce the finding before any fix; a non-reproducing item is closed as a dismissed
false positive with disproving evidence, never silently dropped.

## Q4 — New risks

1. **Findings are not jury-adjudicated.** The review was cancelled at ~50% coverage before the
   adversarial jury phase; all 291 items carry manifest status `OPEN`. Fixing an unvalidated finding can
   introduce a regression defending against a defect that does not exist. Mitigated by the validation gate.
2. **Coverage is ~50%** (945/1880 files, 13 of 30 batches). These milestones close what was found in the
   reviewed half; they do not claim to close everything that exists. Completing the review would likely
   add milestones.

## Decisions recorded

- **Base:** all 291 agent-emitted findings ≥ MEDIUM (user choice over the ≥HIGH-only option).
- **Slicing:** 6 milestones by theme, SE47–SE52 (user choice).
- **Excluded as toolchain noise:** 4,457 of 4,773 tool seeds were ESLint `no-undef` (3,320) and
  `no-unused-vars` (1,137) fired against a **Biome** project — `no-undef` is not meaningful on TypeScript.
  Not encoded as debt.
- **out_of_scope_overlap:** none. The 7 "Explicitly out of scope" items are capabilities deliberately not
  adopted (OS sandbox, built-in coding tools, subprocess model, settings engine, signal-provider framework,
  bundled Workspace, threaded-signal schedules); these milestones only remediate existing code.
- **Insertion-anchor deviation:** the skill mandates inserting before `## State-of-the-art references`,
  which does not exist in this ROADMAP. Inserted instead before the `---` that closes the SE series
  (immediately preceding `## Capability Gap Register`), keeping the new blocks inside `## SDK Evolution`.
  Deterministic and non-arbitrary; recorded here rather than silently substituted.
- **ID choice:** SE42 (reserved, extended-thinking `--continue`, #122) and SE44 (reserved, migration
  importer) are NOT reused. Next free id is SE47.

## Source

`knowledge-base/reviews/refactor/` — manifest, `review-2026-07-23.md`, `backlog.md`, and the per-pillar
findings under `.review-runs/review-refactor-2026-07-23/`.
