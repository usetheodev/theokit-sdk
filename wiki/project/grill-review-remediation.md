---
type: Decision Record
title: "Grill: review remediation"
description: How the 2026-07-23 multi-pillar review findings became milestones SE47-SE52 — the slicing, the validation gate, and the two risks recorded against them.
tags: [project, planning, milestones, decision, risk]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: grill
    resource: .claude/knowledge-base/grills/review-remediation-feature-grill.md, absorbed into this bundle 2026-08-06
    title: Feature grill — review remediation (SE47-SE52)
    author: process:roadmap-feature
    last_modified: 2026-07-23
---

# What and why now

Absorb the findings of the 2026-07-23 multi-pillar review run into the roadmap. The run
surfaced the project's only BLOCKER (OAuth sign-in broken by a cookie-name mismatch) plus 29
HIGH and 261 MEDIUM agent-emitted findings across 10 pillars. Why then: the evidence was fresh
and line-anchored, and the BLOCKER broke a live auth path.

# Dependencies

All six milestones depend on SE46, the most recently completed one. SE52 additionally depends
on SE48, so runtime-correctness fixes land before SE52 restructures the same runtime files.
The roadmap loop selects the lowest eligible id, so SE47 — the BLOCKER — runs first.

# Definition of done

Per-milestone, written into each roadmap block. The common first item in all six is a
**validation gate**: a RED test must reproduce the finding before any fix; a non-reproducing
item is closed as a dismissed false positive **with disproving evidence**, never silently
dropped.

That gate is the interesting part. It is the mechanism that keeps a large pile of
machine-generated findings from turning into a large pile of speculative changes.

# Risks recorded

1. **The findings are not jury-adjudicated.** The review was cancelled at ~50% coverage before
   the adversarial jury phase, so all 291 items carry status `OPEN`. Fixing an unvalidated
   finding can introduce a regression defending against a defect that does not exist. Mitigated
   by the validation gate above.
2. **Coverage is ~50%** (945/1880 files, 13 of 30 batches). These milestones close what was
   found in the reviewed half; they do not claim to close everything that exists. Completing
   the review would likely add milestones.

Both risks are the same shape as the honesty in
[audit: code quality 2026-08](/project/audit-code-quality-2026-08.md): saying what was *not*
covered is what keeps partial work from being read as complete.

# Decisions

* **Base:** all 291 agent-emitted findings at MEDIUM or above, chosen over the HIGH-only option.
* **Slicing:** six milestones by theme, SE47–SE52.
* **Excluded as toolchain noise:** 4,457 of 4,773 tool seeds were ESLint `no-undef` (3,320) and
  `no-unused-vars` (1,137) fired against a **Biome** project — `no-undef` is not meaningful on
  TypeScript. Not encoded as debt.
* **Out-of-scope overlap:** none. The seven explicitly out-of-scope items are capabilities
  deliberately not adopted; these milestones only remediate existing code. That is
  [the layer question](/operations/layer-question.md) applied at planning time.
* **Insertion-anchor deviation:** the skill mandates inserting before a section that does not
  exist in this roadmap. Inserted instead before the delimiter closing the series —
  deterministic and non-arbitrary, and **recorded here rather than silently substituted**.
* **Id choice:** two reserved ids were not reused; the next free id was SE47.

# Why it is in the wiki

It is a worked example of the ADR discipline in
[architecture decisions](/operations/architecture-decisions.md): every decision carries the
alternative it beat, the deviation from the process is written down rather than absorbed, and
the two risks are stated with their mitigation rather than omitted because the plan was already
approved.[^grill]

[^grill]: Feature grill — review remediation, 2026-07-23
