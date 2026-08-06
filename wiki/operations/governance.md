---
type: Practice
title: Governance
description: The seven things a Staff engineer establishes for a team running agentic systems at scale, none of them optional.
tags: [leadership, governance, process, scale, ownership]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 12.5, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 12.5 — governance of an agentic system
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# The seven

None of these is optional at scale.

1. **A limitations register** — a file where "we do not do X" is official, with a layer
   classification. See [the layer question](/operations/layer-question.md) and
   [capability gaps](/project/capability-gaps.md) for a working example.
2. **An eval gate in CI** — a prompt change without an eval does not merge. See
   [evaluation](/operations/evaluation.md).
3. **A per-tenant budget that blocks**, not merely alerts. See
   [cost management](/operations/cost-management.md).
4. **A framework boundary** — only N files import the orchestration SDK. Measure it: count
   the files that would have to change in a migration; the target is 1.
5. **ACI review** — a new tool passes an interface review, like a public API. See
   [tools and ACI](/sdk/tools-and-aci.md).
6. **Runbook and ownership** — who gets called when the agent acts wrongly at 3 a.m.
7. **A data policy** — what enters the prompt, what goes to telemetry, what is retained. See
   [observability](/operations/observability.md).

# Why the framework boundary is worth measuring

What **transfers** between frameworks is context engineering, ACI design, eval, budgeting,
failure taxonomy and the determinism ladder — roughly 70% of the real work, and exactly what
the [concepts](/concepts/glossary.md) folder covers.

What **does not** transfer is orchestration syntax, state and checkpoint format, specific
integrations and telemetry format.

The conclusion for a Staff engineer: **invest in the transferable knowledge and keep the
orchestration isolated behind boundaries you own.** A team that treats the framework as a
replaceable detail migrates in weeks; a team that sprays `framework.*` across the domain
migrates in quarters. The axes behind that judgment are in
[framework comparison](/ecosystem/framework-comparison.md).

# The honesty items

Three of the seven exist specifically to make dishonesty structurally harder:

* The limitations register makes "we do not do X" a record rather than a conversation.
* The eval gate makes "it got better" a number rather than an impression.
* The runbook makes "someone will handle it" a name.

That is the same discipline this repository applies to itself — see
[review: issue-sweep 2026-08](/project/review-issue-sweep-2026-08.md), which includes a
section retracting three claims its own author had published on public issues, and a closure
record that states the fixes shipped *before* the evidence was written rather than
reconstructing the timeline more favourably.

# Mastery criterion

You lead the design of an agentic system from zero: you decide layers, write ADRs with
alternatives, declare limitations, establish governance, and say **no** to what should not be
built.[^course]

[^course]: Agent AI course, Module 12.5
