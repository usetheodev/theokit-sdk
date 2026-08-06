---
type: Checklist
title: Production readiness checklist
description: Fifteen items to clear before the first deploy of an agent, each one a real failure of a real system, with the concept that explains it.
tags: [operations, checklist, production, reliability]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 11.5, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 11.5 — production readiness checklist
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# Before the first deploy

Each line is a real failure of a real system, not a hypothetical.

- [ ] `dispose()` guaranteed on every exit path, **including the error path** — [agent, run and SDKMessage](/sdk/agent-run-sdkmessage.md)
- [ ] Iteration ceiling **and** budget configured; not the defaults by accident — [limits and budgets](/sdk/limits-and-budgets.md)
- [ ] `stoppedAtIterationLimit` and `stoppedByDoomLoop` **read and handled** — [loop terminals](/concepts/loop-terminals.md)
- [ ] Errors classified; retry only on transient — [failure taxonomy](/sdk/failure-taxonomy.md)
- [ ] `cancelled` and `tripwire` do not alert as errors — [run signals](/sdk/run-signals.md)
- [ ] Permissions fail-closed; explicit `deny` on the destructive tools — [permissions](/sdk/permissions.md)
- [ ] Per-tool timeout — [tools and ACI](/sdk/tools-and-aci.md)
- [ ] Output guardrail if there is PII — [guardrails](/sdk/guardrails.md)
- [ ] Network via `screenedFetch`; shell via the catastrophic screen; paths via `path-safety` — [attack surface](/concepts/attack-surface.md)
- [ ] Telemetry on, `includeContent: false` (or a reviewed sanitization) — [observability](/operations/observability.md)
- [ ] Cost per run recorded and attributed to a tenant or user — [cost management](/operations/cost-management.md)
- [ ] Concurrency behind a bounded pool — [concurrency and scheduling](/operations/concurrency-and-scheduling.md)
- [ ] Eval in CI with a gate — [evaluation](/operations/evaluation.md)
- [ ] Durable state in the right place (an external `SessionStore` if serverless) — [state, sessions and memory](/sdk/state-sessions-memory.md)
- [ ] Runbook: how to cancel a stuck run, how to investigate anomalous cost — [governance](/operations/governance.md)

# If the agent runs a closed loop

Three additional preconditions, none optional, from
[control cadence](/concepts/control-cadence.md):

- [ ] A completion criterion **you can measure**
- [ ] A budget with a hard ceiling, not an alert
- [ ] Fail-closed permissions

And one calibration: if an LLM judges completion, its agreement with human labels has been
measured — because in a closed loop the judge is the only witness. See
[evaluation](/operations/evaluation.md).

# What this checklist deliberately does not do

It does not certify the agent works. It certifies the *failure paths* are handled. Proving it
works is [evaluation](/operations/evaluation.md), and the two are not substitutes: a green
checklist with a happy-path-only dataset is a well-instrumented system with unknown quality.
