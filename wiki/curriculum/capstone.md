---
type: Curriculum
title: Capstone
description: The graded final project — eleven minimum requirements, six deliverables, a weighted rubric, and four automatic-failure conditions.
tags: [curriculum, capstone, assessment, rubric]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Capstone section, absorbed into this bundle 2026-08-06
    title: Agent AI course — capstone, final project
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# Scope

Build **one production agent** for a real problem in your context. Minimum requirements:

- [ ] ≥ 3 of your own tools, one with `outputSchema` + `toModelOutput` — [tools and ACI](/sdk/tools-and-aci.md)
- [ ] One deterministic stage implemented as a `Workflow`, not as an agent — [workflow](/sdk/workflow.md)
- [ ] Durable state with resumption proven after a process restart — [state, sessions and memory](/sdk/state-sessions-memory.md)
- [ ] A fail-closed permission policy with a test suite that uses no LLM — [permissions](/sdk/permissions.md)
- [ ] An input guardrail **and** an output guardrail — [guardrails](/sdk/guardrails.md)
- [ ] An eval suite of ≥ 30 cases (with negative cases) and a CI gate — [evaluation](/operations/evaluation.md)
- [ ] Telemetry + cost per run, attributed — [cost management](/operations/cost-management.md)
- [ ] All seven terminals handled explicitly — [loop terminals](/concepts/loop-terminals.md)
- [ ] An ADR for each of the two largest decisions, with alternatives — [architecture decisions](/operations/architecture-decisions.md)
- [ ] A limitations register with a layer classification — [the layer question](/operations/layer-question.md)
- [ ] A runbook with ≥ 5 symptoms — [governance](/operations/governance.md)

# Deliverables

| Artifact | What it proves |
| --- | --- |
| Repository | that it works |
| `EVAL.md` with numbers | that it works **measurably** |
| 2 ADRs | that you decide rather than guess |
| `LIMITATIONS.md` | that you are honest about scope |
| `RUNBOOK.md` | that someone else can operate it |
| A one-page post-mortem of your worst bug | that you learn |

# Grading rubric

| Dimension | Weight | Staff level means |
| --- | --- | --- |
| Correctness | 15% | handles the 7 terminals; no silent success |
| ACI design | 15% | tools the model gets right first time; model/app split |
| Reliability | 15% | failures classified; limits enforced; fail-closed |
| Evaluation | 20% | dataset with negatives; CI gate; calibrated judge |
| Cost | 10% | measured, attributed, budgeted |
| Architecture | 15% | correct layers; ADRs with alternatives |
| Honesty | 10% | limitations declared; real numbers, including the bad ones |

# Automatic failure

Independent of the weighted total:

* claiming something works without evidence;
* an eval with only the happy path;
* security implemented via the prompt;
* declaring something durable that is not.

Each of the four maps to a concept that explains why it is disqualifying rather than merely
weak: [evaluation](/operations/evaluation.md),
[attack surface](/concepts/attack-surface.md) and
[durability boundary](/concepts/durability-boundary.md).

The [competency rubric](/curriculum/competency-rubric.md) is the wider version of this table,
across ten dimensions and four levels.[^course]

[^course]: Agent AI course — Capstone
