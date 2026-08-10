---
type: Rubric
title: Competency rubric
description: Ten dimensions of Agent AI competence across four levels, Junior to Staff, with the self-assessment rule that a dimension without evidence is an aspiration.
tags: [curriculum, rubric, career, assessment, leveling]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), competency rubric section, absorbed into this bundle 2026-08-06
    title: Agent AI course — competency rubric, Junior to Staff
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# The rubric

| Dimension | Junior | Mid | Senior | **Staff** |
| --- | --- | --- | --- | --- |
| **Agents** | uses an agent for everything | distinguishes workflow from agent | chooses by the determinism ladder | **argues against building the agent** |
| **Loop** | knows success and error | knows the iteration ceiling | handles all 7 terminals | **designs the continuation policy** |
| **Context** | stacks history | uses compaction | budgets per source | **designs the system's context architecture** |
| **Tools** | works on the happy path | typed schema, useful errors | model/app split; ACI reviewed | **establishes ACI review as a process** |
| **Failures** | generic try/catch | retries on transient | complete taxonomy, fail-closed | **designs failure governance** |
| **Security** | trusts the prompt | uses permissions | covers the 6 vectors | **runs red team and data policy** |
| **Evaluation** | tests by hand | has a dataset | CI gate; calibrated judge | **defines the organization's eval strategy** |
| **Cost** | does not measure | measures | attributes and budgets | **prioritizes levers by impact** |
| **Architecture** | follows the tutorial | follows conventions | writes ADRs | **decides layers; says what is not ours** |
| **Honesty** | reports what worked | reports failures | declares uncertainty | **institutionalizes the limitations register** |

# Where each dimension is developed

| Dimension | Concept |
| --- | --- |
| Agents | [determinism ladder](/concepts/determinism-ladder.md) |
| Loop | [loop terminals](/concepts/loop-terminals.md), [control cadence](/concepts/control-cadence.md) |
| Context | [context engineering](/concepts/context-engineering.md) |
| Tools | [tools and ACI](/sdk/tools-and-aci.md) |
| Failures | [failure taxonomy](/sdk/failure-taxonomy.md) |
| Security | [attack surface](/concepts/attack-surface.md), [permissions](/sdk/permissions.md) |
| Evaluation | [evaluation](/operations/evaluation.md) |
| Cost | [cost management](/operations/cost-management.md) |
| Architecture | [the layer question](/operations/layer-question.md), [architecture decisions](/operations/architecture-decisions.md) |
| Honesty | [governance](/operations/governance.md), [capability gaps](/project/capability-gaps.md) |

# Self-assessment

For each dimension, mark your level and write **one concrete piece of evidence**.

> **A dimension without evidence is an aspiration, not a competence.**

That rule is the rubric's own application of the honesty dimension it grades — which is why
the [capstone](/curriculum/capstone.md) fails automatically on "claiming something works
without evidence", regardless of the weighted total.[^course]

[^course]: Agent AI course — competency rubric
