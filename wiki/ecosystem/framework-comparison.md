---
type: Comparison
title: Framework comparison
description: Six axes that actually decide a framework choice, the five architectural families, where this SDK is genuinely different, and honest recommendations to choose something else.
tags: [ecosystem, comparison, decision, langgraph, langchain, crewai, autogen, dated]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-10-30
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 9, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 9 — theokit-sdk vs the ecosystem
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: langgraph-durable
    resource: https://docs.langchain.com/oss/python/langgraph/durable-execution
    title: LangChain — durable execution (consulted July 2026, not re-checked)
  - id: comparisons
    resource: Third-party framework comparisons consulted July 2026 — speakeasy.com, medium.com/codex, trixlyai.com, fast.io, vadim.blog
    title: Ecosystem comparison articles (consulted July 2026, not re-checked)
---

> **Dating and scope.** This is a July 2026 analysis. Ecosystem comparisons age fast; the
> **axes** below age slowly and are what you should carry. Third-party API details describe
> *architectural models*, not exact versions. Verify the official documentation before
> deciding with money at stake. **The links in `sources` were not re-checked when this concept
> was written into the wiki on 2026-08-06.**
>
> **Declared bias:** this document lives in the `@theokit/sdk` repository. That is why it
> includes an explicit "when to choose something else" section, and why that section is
> sincere. A comparison that never recommends the competitor is marketing, not engineering.

# The six deciding axes

Fix the axes before looking at names. They work for any framework that appears after this
page was written:

1. **Control model** — declarative graph, imperative loop, or roles and tasks?
2. **Durability model** — what survives a crash, and at what granularity?
3. **Runtime ownership** — who executes it? Can you continue without the vendor?
4. **Typing and surface** — does the compiler protect you? How many entry points must you
   learn?
5. **Breadth vs focus** — batteries included (and coupling) or parts (and assembly work)?
6. **State format** — proprietary or open? What is the exit cost?

**No framework wins on all six.** Anyone claiming otherwise is selling.

# The architectural families

| Family | Representatives | Mental model | Real strength | Real cost |
| --- | --- | --- | --- | --- |
| **State graph** | LangGraph | nodes + edges over typed state; each transition checkpoints | granular durability, HITL, resumption | you think in graphs even when the problem is a line |
| **Chain composition** | LangChain | composed `Runnable`s; `create_agent` as the v1 pattern | an enormous integration ecosystem | thick abstraction; very large surface |
| **Roles and tasks** | CrewAI (Crews) + Flows for determinism | a team of specialists with role/goal/backstory | fast multi-agent prototyping | fine control and predictability cost |
| **Multi-agent conversation** | AutoGen | agents talking to each other | research, debate patterns | predictability and cost in production |
| **Typed imperative loop** | `@theokit/sdk`, OpenAI Agents SDK, Pydantic AI, Mastra | ordinary code, agent as an object, explicit loop | readability, debuggability, typing | you assemble the complex orchestration |

**A pattern worth noticing:** the families converged on the *shape* of an SDK — agent, tools,
event stream, handoff, guardrail. Real differentiation migrated to **where the loop runs, what
survives a failure, and whose runtime it is** — axes 2 and 3.

# Per-axis comparison

| Axis | `@theokit/sdk` | LangGraph | LangChain | CrewAI | AutoGen | OpenAI Agents SDK |
| --- | --- | --- | --- | --- | --- | --- |
| **Control** | imperative loop + optional `Workflow` | declarative graph | chains / `Runnable` | roles + Flows | conversation | imperative loop |
| **Durability** | **only at `Workflow.suspend()`** | checkpoint per transition (configurable modes) | via LangGraph | Flow state | limited | sessions |
| **Local runtime** | **Apache-2.0, end to end** | OSS + optional paid platform | OSS | OSS | OSS | OSS, but oriented around one provider |
| **Multi-provider** | 43 providers, your keys | yes | yes | yes | yes | centered on one provider |
| **Typing** | strict TS; types are the contract | Python/TS | Python/TS | Python | Python | TS/Python |
| **Session format** | **Claude Code native `.jsonl`** | checkpointer store | several | proprietary | proprietary | proprietary |
| **Mother tongue** | TypeScript | Python (TS exists) | Python (TS exists) | Python | Python | both |

# Where this SDK is genuinely different

Four items, all verifiable in the repository — not slogans:

1. **The local harness is Apache-2.0.** Many SDKs are open; fewer agent *runtimes* are.
   Abandonment cost ≈ zero: you fork and continue with your own keys.
2. **Open, interoperable session format.** Point `local.sessionDir` at `~/.claude` and the Claude Code
   CLI can `--continue` a session **your** agent wrote. State is not hostage. See
   [state, sessions and memory](/sdk/state-sessions-memory.md).
3. **Parts, not an assembled application.** Roughly 30 sub-entries (`/compaction`,
   `/persistence`, `/concurrency`, `/retry`, `/path-safety`, `/eval`, …) are usable **in
   isolation** — you can use `compactTranscript` without ever using `Agent`. That is the
   opposite of a batteries-coupled framework. See [import map](/sdk/import-map.md).
4. **Structural honesty about limits.** `ROADMAP.md` maintains a *Capability Gap Register*
   (G1–G7) declaring what the SDK does **not** do — including that the loop is not durable and
   that tool-gate HITL is ephemeral. Two of the gaps (G6/G7) are explicitly marked as *not the
   SDK's layer*. See [capability gaps](/project/capability-gaps.md).

# When to choose something else

| Choice | When | Why |
| --- | --- | --- |
| **LangGraph** | you need durable execution **of the loop**, per-transition resumption, durable typed HITL | that is its native model; here it is a declared gap (G1/G2/G4) |
| **LangChain** | you need dozens of ready integrations and do not want to write adapters | ecosystem breadth is its strength |
| **CrewAI** | fast role-based multi-agent prototype with a Python team | the crew model maps directly onto how the team thinks |
| **AutoGen** | research into conversational and debate patterns | it was built for that |
| **OpenAI Agents SDK** | you are committed to one provider and want the shortest path | tighter integration |
| **Pydantic AI / Mastra** | you want a typed loop but the team is Python-first, or wants more batteries in TS | same family, different ergonomics |
| **`@theokit/sdk`** | TypeScript, runtime ownership matters, open state format, composable parts, and you accept assembling the orchestration | that is where it is strong |

> **One-line decision rule:** *if the dominant requirement is "survive a failure in the middle
> of the loop", choose the state-graph family; if it is "I must own and debug the runtime in
> TypeScript", choose this one.*

# Migration cost

What **transfers**: context engineering, ACI and tool design, eval, budgeting, failure
taxonomy, the determinism ladder. **That is roughly 70% of the real work** — and it is exactly
what [concepts](/concepts/glossary.md) and [operations](/operations/governance.md) cover.

What **does not** transfer: orchestration syntax, state and checkpoint format, specific
integrations, telemetry format.

Conclusion: **invest in the transferable knowledge and keep the orchestration isolated behind
boundaries you own.** That is governance item 4 in [governance](/operations/governance.md).

# Mastery criterion

You lead a framework decision in a meeting: you present the axes, admit the gaps of the
candidate you prefer, and recommend a different one when the axes point elsewhere.[^course]

[^course]: Agent AI course, Module 9
[^langgraph-durable]: LangChain — durable execution, consulted July 2026
